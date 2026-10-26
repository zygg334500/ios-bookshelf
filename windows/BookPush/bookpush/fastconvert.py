"""In-process DRM-free AZW3 / MOBI → EPUB.

This is BookPush's own reader, the same PalmDOC and published KF8 skeleton
layout the phone already uses. It is not Calibre source. Encryption other than
0, DRMION, and KFX are refused before any text is turned into an EPUB.
Huff/CDIC (17480) is not decoded; the caller may fall back to official Calibre.
"""

from __future__ import annotations

import base64
import io
import os
import re
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path

from bookpush.kindle import DRM_MESSAGE, KFX_MESSAGE, is_kfx, palm_encryption


class FastDrm(Exception):
    pass


class FastKfx(Exception):
    pass


class FastFallback(Exception):
    """Unprotected, but this parser cannot build an EPUB. Official Calibre may."""


@dataclass
class FastChapter:
    title: str
    html: str
    styles: str


@dataclass
class FastBook:
    title: str
    author: str
    chapters: list[FastChapter]
    cover: tuple[str, bytes] | None = None


@dataclass
class _Section:
    record_index: int
    encryption: int
    compression: int
    is_kf8: bool
    raw_text: bytes
    encoding: int
    title: str
    author: str
    images: list[tuple[str, bytes]]
    cover: tuple[str, bytes] | None
    kf8_record: int | None
    skel_index: int | None
    frag_index: int | None
    fdst_index: int | None
    fdst_count: int


def fast_convert_path(path_str: str) -> dict:
    """Process-pool entry. Always returns a dict so one bad file cannot kill the pool."""
    _maybe_test_delay(path_str)
    try:
        book = convert_bytes(Path(path_str).read_bytes())
        epub = build_epub(book)
    except FastDrm as error:
        return {"status": "drm", "message": str(error), "epub": b"", "title": ""}
    except FastKfx as error:
        return {"status": "kfx", "message": str(error), "epub": b"", "title": ""}
    except FastFallback as error:
        return {"status": "fallback", "message": str(error), "epub": b"", "title": ""}
    except Exception as error:
        return {"status": "fallback", "message": f"本机转换没有完成：{error}", "epub": b"", "title": ""}
    return {"status": "ok", "message": "", "epub": epub, "title": book.title}


def convert_bytes(data: bytes) -> FastBook:
    if b"DRMION" in data[:4096]:
        raise FastDrm(DRM_MESSAGE)
    if is_kfx(data):
        raise FastKfx(KFX_MESSAGE)
    if data[:2] == b"PK":
        raise FastFallback("文件头是 ZIP，不是需要在本机拆开的 AZW3。")
    if len(data) < 80 or data[60:68] != b"BOOKMOBI":
        raise FastFallback("文件头不是 BOOKMOBI。")
    encryption = palm_encryption(data)
    if encryption not in (None, 0):
        raise FastDrm(DRM_MESSAGE)
    try:
        records = _record_slices(data)
    except FastFallback:
        raise
    except Exception as error:
        raise FastFallback(str(error)) from error
    if len(records) < 2:
        raise FastFallback("AZW3 记录不完整。")
    try:
        primary = _parse_section(records, 0)
    except FastDrm:
        raise
    except FastFallback:
        raise
    except Exception as error:
        raise FastFallback(str(error)) from error
    if primary.encryption != 0:
        raise FastDrm(DRM_MESSAGE)
    sections = []
    if not primary.is_kf8 and primary.kf8_record is not None:
        boundary = primary.kf8_record
        record = records[boundary] if boundary < len(records) else b""
        start = boundary + 1 if record.startswith(b"BOUNDARY") else boundary
        kf8 = _try_section(records, start)
        if kf8 is not None:
            if kf8.encryption != 0:
                raise FastDrm(DRM_MESSAGE)
            sections.append(kf8)
    sections.append(primary)
    saw_huff = False
    for section in sections:
        if section.compression == 17480:
            saw_huff = True
            continue
        book = _render_section(section, records)
        if book is not None:
            return book
    if saw_huff:
        raise FastFallback("这本书使用 Huff/CDIC 压缩，本机快路径不解码。")
    raise FastFallback("没能从这本无 DRM 的 AZW3 里取出可排版的正文。")


def build_epub(book: FastBook) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        mime = zipfile.ZipInfo("mimetype")
        mime.compress_type = zipfile.ZIP_STORED
        archive.writestr(mime, "application/epub+zip")
        archive.writestr("META-INF/container.xml", _CONTAINER)
        manifest = [
            '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
            '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        ]
        spine = []
        nav_items = []
        for index, chapter in enumerate(book.chapters, start=1):
            name = f"c{index}.xhtml"
            ident = f"c{index}"
            manifest.append(
                f'<item id="{ident}" href="{name}" media-type="application/xhtml+xml"/>'
            )
            spine.append(f'<itemref idref="{ident}"/>')
            nav_items.append(f'<li><a href="{name}">{_xml(chapter.title)}</a></li>')
            archive.writestr(f"OEBPS/{name}", _chapter_xhtml(chapter))
        cover_meta = ""
        if book.cover is not None:
            mime_type, blob = book.cover
            ext = "png" if "png" in mime_type else "jpg" if "jpeg" in mime_type or "jpg" in mime_type else "gif"
            manifest.insert(
                0,
                f'<item id="cover-img" href="cover.{ext}" media-type="{mime_type}" properties="cover-image"/>',
            )
            cover_meta = '<meta name="cover" content="cover-img"/>'
            archive.writestr(f"OEBPS/cover.{ext}", blob)
        title = _xml(book.title or "未命名")
        author = _xml(book.author or "佚名")
        opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">bookpush-azw3</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:creator>{author}</dc:creator>
    <dc:language>zh</dc:language>
    {cover_meta}
  </metadata>
  <manifest>
    {''.join(manifest)}
  </manifest>
  <spine toc="ncx">
    {''.join(spine)}
  </spine>
</package>
"""
        archive.writestr("OEBPS/content.opf", opf)
        labels = "".join(nav_items)
        archive.writestr(
            "OEBPS/nav.xhtml",
            f"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>目录</title></head>
  <body><nav epub:type="toc"><ol>{labels}</ol></nav></body>
</html>
""",
        )
        points = []
        for index, chapter in enumerate(book.chapters, start=1):
            points.append(
                "<navPoint>"
                f"<navLabel><text>{_xml(chapter.title)}</text></navLabel>"
                f'<content src="c{index}.xhtml"/>'
                "</navPoint>"
            )
        archive.writestr(
            "OEBPS/toc.ncx",
            f"""<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <navMap>{''.join(points)}</navMap>
</ncx>
""",
        )
    return buffer.getvalue()


_CONTAINER = """<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""


def _chapter_xhtml(chapter: FastChapter) -> str:
    style = f"<style>{chapter.styles}</style>" if chapter.styles else ""
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml"><head>'
        f"<title>{_xml(chapter.title)}</title>{style}</head><body>{chapter.html}</body></html>"
    )


def _xml(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _maybe_test_delay(path_str: str) -> None:
    raw = os.environ.get("BOOKPUSH_FAST_DELAY", "").strip()
    if not raw:
        return
    log = os.environ.get("BOOKPUSH_CONVERT_LOG", "")
    if log:
        with open(log, "a", encoding="utf-8") as handle:
            handle.write(f"start {time.time():.4f} {path_str}\n")
    time.sleep(float(raw))
    if log:
        with open(log, "a", encoding="utf-8") as handle:
            handle.write(f"end {time.time():.4f} {path_str}\n")


def _u16(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset : offset + 2], "big")


def _u32(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset : offset + 4], "big")


def _read_u32(data: bytes, offset: int, end: int) -> int | None:
    if offset < 0 or offset + 4 > len(data) or offset + 4 > end:
        return None
    return _u32(data, offset)


def _read_u16(data: bytes, offset: int, end: int) -> int | None:
    if offset < 0 or offset + 2 > len(data) or offset + 2 > end:
        return None
    return _u16(data, offset)


def _record_slices(data: bytes) -> list[bytes]:
    count = _u16(data, 76)
    slices: list[bytes] = []
    for index in range(count):
        at = 78 + index * 8
        if at + 4 > len(data):
            raise FastFallback("AZW3 记录偏移损坏。")
        start = _u32(data, at)
        end = _u32(data, 78 + (index + 1) * 8) if index + 1 < count else len(data)
        if start > len(data) or end < start or end > len(data):
            raise FastFallback("AZW3 记录偏移损坏。")
        slices.append(data[start:end])
    return slices


def _try_section(records: list[bytes], record_index: int) -> _Section | None:
    if record_index < 0 or record_index >= len(records):
        return None
    rec0 = records[record_index]
    if len(rec0) < 20 or rec0[16:20] != b"MOBI":
        return None
    try:
        return _parse_section(records, record_index)
    except FastDrm:
        raise
    except Exception:
        return None


def _parse_section(records: list[bytes], record_index: int) -> _Section:
    rec0 = records[record_index]
    if len(rec0) < 16 or rec0[16:20] != b"MOBI":
        raise FastFallback("AZW3 缺少 MOBI 头。")
    compression = _u16(rec0, 0)
    text_length = _u32(rec0, 4)
    text_records = _u16(rec0, 8)
    encryption = _u16(rec0, 12)
    header_length = _u32(rec0, 20) if len(rec0) >= 24 else 0
    header_end = min(len(rec0), 16 + header_length)
    mobi_type = _read_u32(rec0, 0x18, header_end) or 0
    encoding = _read_u32(rec0, 0x1C, header_end) or 65001
    version = _read_u32(rec0, 0x24, header_end) or 0
    min_version = _read_u32(rec0, 0x68, header_end) or 0
    full_name_offset = _read_u32(rec0, 0x54, header_end) or 0
    full_name_length = _read_u32(rec0, 0x58, header_end) or 0
    first_image_raw = _read_u32(rec0, 0x6C, header_end)
    exth_flags = _read_u32(rec0, 0x80, header_end) or 0
    exth = _read_exth(rec0, 16 + header_length) if exth_flags & 0x40 else {}
    title = _utf8(exth.get(503, [b""])[0]) or (
        _utf8(rec0[full_name_offset : full_name_offset + full_name_length])
        if full_name_offset > 0
        and full_name_length > 0
        and full_name_offset + full_name_length <= len(rec0)
        else ""
    )
    author = _utf8(exth.get(100, [b""])[0])
    kf8_raw = exth.get(121, [b""])[0]
    kf8_record = _u32(kf8_raw, 0) if len(kf8_raw) >= 4 else None
    is_kf8 = version >= 8 or mobi_type == 248
    trail_flags = _read_u16(rec0, 0xF2, header_end) or 0 if header_length >= 0xE4 and min_version >= 5 else 0
    fdst_count = _read_u32(rec0, 0xC4, header_end) or 0
    fdst_index = _absolute_index(record_index, _read_u32(rec0, 0xC0, header_end)) if fdst_count > 1 else None
    skel_index = _absolute_index(record_index, _read_u32(rec0, 0xFC, header_end)) if is_kf8 else None
    frag_index = _absolute_index(record_index, _read_u32(rec0, 0xF8, header_end)) if is_kf8 else None
    first_image = _absolute_index(record_index, first_image_raw)
    images = _collect_images(records, first_image)
    cover_offset = exth.get(201, [b""])[0]
    cover = images[_u32(cover_offset, 0)] if len(cover_offset) >= 4 and _u32(cover_offset, 0) < len(images) else None
    if cover is None:
        cover = next((image for image in images if image[0] in {"image/jpeg", "image/png"}), None)
    if encryption != 0:
        return _Section(
            record_index, encryption, compression, is_kf8, b"", encoding, title, author, [], None,
            kf8_record, skel_index, frag_index, fdst_index, fdst_count,
        )
    if compression not in {1, 2, 17480}:
        raise FastFallback(f"不支持的 AZW3 压缩类型（{compression}）。")
    raw = b"" if compression == 17480 else _decode_text_records(
        records, record_index, text_records, text_length, compression, trail_flags
    )
    return _Section(
        record_index, encryption, compression, is_kf8, raw, encoding, title, author, images, cover,
        kf8_record, skel_index, frag_index, fdst_index, fdst_count,
    )


def _render_section(section: _Section, records: list[bytes]) -> FastBook | None:
    if not section.raw_text or section.raw_text.startswith(b"%MOP"):
        return None
    fdst = records[section.fdst_index] if section.fdst_index is not None and section.fdst_index < len(records) else None
    flows = _split_flows(section.raw_text, fdst, section.fdst_count)
    text_flow = flows[0] if flows else section.raw_text
    assembled = _assemble_kf8(text_flow, records, section)
    pieces: list[bytes] = []
    for piece in assembled or [text_flow]:
        pieces.extend(_split_page_breaks(piece))
    styles = _collect_css(flows[1:], section.encoding, section.images)
    chapters: list[FastChapter] = []
    for piece in pieces:
        html = _extract_body(_rewrite_kindle(_decode_bytes(piece, section.encoding), section.images))
        if not _visible_text(html):
            continue
        heading = _heading_of(html)
        chapters.append(
            FastChapter(
                title=heading or (section.title or "正文" if not chapters else f"第 {len(chapters) + 1} 章"),
                html=html,
                styles=styles,
            )
        )
    if not chapters:
        return None
    title = section.title or chapters[0].title or "未命名 AZW3"
    if len(chapters) == 1 and not _heading_of(chapters[0].html):
        chapters[0].title = title
    return FastBook(title=title, author=section.author or "佚名", chapters=chapters, cover=section.cover)


def _assemble_kf8(flow: bytes, records: list[bytes], section: _Section) -> list[bytes] | None:
    if section.skel_index is None:
        return None
    skel_entries = _read_index(records, section.skel_index)
    if not skel_entries:
        return None
    frag_entries = _read_index(records, section.frag_index) if section.frag_index is not None else []
    frags = []
    for order, entry in enumerate(frag_entries):
        pair = entry["tags"].get(6, [])
        length = pair[1] if len(pair) >= 2 else (pair[0] if pair else 0)
        try:
            insert_pos = int(entry["label"])
        except ValueError:
            insert_pos = 0
        frags.append((insert_pos, length, order))
    parts: list[bytes] = []
    frag_index = 0
    for entry in skel_entries:
        pair = entry["tags"].get(6, [])
        pos = pair[0] if pair else 0
        length = pair[1] if len(pair) >= 2 else 0
        frag_count = entry["tags"].get(1, [0])[0] if entry["tags"].get(1) else 0
        if pos < 0 or length < 0 or pos + length > len(flow):
            return None
        inserts = []
        read_at = pos + length
        for _ in range(frag_count):
            if frag_index >= len(frags):
                break
            insert_pos, frag_len, order = frags[frag_index]
            frag_index += 1
            if frag_len < 0 or read_at + frag_len > len(flow):
                return None
            inserts.append((insert_pos - pos, flow[read_at : read_at + frag_len], order))
            read_at += frag_len
        inserts.sort(key=lambda item: (item[0], item[2]), reverse=True)
        merged = flow[pos : pos + length]
        for at, blob, _order in inserts:
            at = max(0, min(len(merged), at))
            merged = merged[:at] + blob + merged[at:]
        parts.append(merged)
    return parts or None


def _split_flows(raw: bytes, fdst: bytes | None, count: int) -> list[bytes]:
    if not fdst or count <= 1 or len(fdst) < 16 or fdst[:4] != b"FDST":
        return [raw]
    number = _u32(fdst, 8)
    if number <= 1 or 12 + number * 8 > len(fdst):
        return [raw]
    starts = [_u32(fdst, 12 + index * 8) for index in range(number)]
    starts.append(len(raw))
    flows = []
    for index in range(len(starts) - 1):
        begin = max(0, min(len(raw), starts[index]))
        end = max(begin, min(len(raw), starts[index + 1]))
        flows.append(raw[begin:end])
    return flows or [raw]


def _split_page_breaks(piece: bytes) -> list[bytes]:
    text = piece.decode("utf-8", "replace")
    if not re.search(r"<mbp:pagebreak\b", text, re.I):
        return [piece]
    parts = [part for part in re.split(r"<mbp:pagebreak\b[^>]*\/?>", text, flags=re.I) if _visible_text(part)]
    if len(parts) <= 1:
        return [piece]
    return [part.encode("utf-8") for part in parts]


def _read_index(records: list[bytes], index: int) -> list[dict]:
    if index < 0 or index >= len(records):
        return []
    main = records[index]
    if main[:4] != b"INDX":
        return []
    header = _parse_indx_header(main)
    tags = _read_tag_section(main, header["len"]) if header else None
    if not header or not tags or tags["control"] > 32:
        return []
    entries: list[dict] = []
    child_count = min(header["count"], len(records))
    if child_count <= 0:
        entries.extend(_read_index_entries(main, tags["control"], tags["tags"]))
    else:
        for offset in range(1, child_count + 1):
            child_at = index + offset
            if child_at >= len(records) or records[child_at][:4] != b"INDX":
                break
            entries.extend(_read_index_entries(records[child_at], tags["control"], tags["tags"]))
    return entries


def _parse_indx_header(data: bytes) -> dict | None:
    if len(data) < 56 or data[:4] != b"INDX":
        return None
    return {"len": _u32(data, 4), "start": _u32(data, 20), "count": _u32(data, 24)}


def _read_tag_section(data: bytes, start: int) -> dict | None:
    offset = start
    if data[offset : offset + 4] != b"TAGX":
        found = data.find(b"TAGX")
        if found < 0:
            return None
        offset = found
    if offset + 12 > len(data):
        return None
    first = _u32(data, offset + 4)
    control = _u32(data, offset + 8)
    if first < 12 or offset + first > len(data):
        return None
    tags = []
    for cursor in range(12, first - 3, 4):
        pos = offset + cursor
        tags.append(
            {"tag": data[pos], "values": data[pos + 1], "mask": data[pos + 2], "end": data[pos + 3]}
        )
    return {"control": control, "tags": tags}


def _read_index_entries(record: bytes, control: int, tag_table: list[dict]) -> list[dict]:
    header = _parse_indx_header(record)
    if not header or header["start"] + 4 > len(record) or record[header["start"] : header["start"] + 4] != b"IDXT":
        return []
    positions = []
    for index in range(header["count"]):
        at = header["start"] + 4 + index * 2
        if at + 2 > len(record):
            return []
        positions.append(_u16(record, at))
    positions.append(header["start"])
    entries = []
    for index in range(header["count"]):
        start = positions[index]
        end = positions[index + 1]
        if start < 0 or end < start or end > len(record) or start >= len(record):
            continue
        text_length = record[start]
        if start + 1 + text_length > end:
            continue
        label = record[start + 1 : start + 1 + text_length].decode("utf-8", "replace")
        tags = _tag_map(control, tag_table, record, start + 1 + text_length, end)
        if tags is None:
            continue
        entries.append({"label": label, "tags": tags})
    return entries


def _tag_map(control: int, tag_table: list[dict], entry: bytes, start: int, end: int) -> dict[int, list[int]] | None:
    del end
    if start + control > len(entry):
        return None
    pending = []
    control_index = 0
    data_start = start + control
    for spec in tag_table:
        if spec["end"] == 0x01:
            control_index += 1
            continue
        if start + control_index >= len(entry):
            return None
        mask = spec["mask"]
        value = entry[start + control_index] & mask
        if value != 0:
            if value == mask and _count_set_bits(mask) > 1:
                read = _read_vwi(entry, data_start)
                if read is None:
                    return None
                data_start += read[0]
                pending.append((spec["tag"], None, read[1], spec["values"]))
            elif value == mask:
                pending.append((spec["tag"], 1, None, spec["values"]))
            else:
                while (mask & 0x01) == 0:
                    mask >>= 1
                    value >>= 1
                pending.append((spec["tag"], value, None, spec["values"]))
    mapped: dict[int, list[int]] = {}
    for tag, value_count, value_bytes, values_per in pending:
        values: list[int] = []
        if value_count is not None:
            for _ in range(value_count * max(values_per, 1)):
                read = _read_vwi(entry, data_start)
                if read is None:
                    return None
                data_start += read[0]
                values.append(read[1])
        elif value_bytes is not None:
            stop = data_start + value_bytes
            if stop > len(entry):
                return None
            while data_start < stop:
                read = _read_vwi(entry, data_start)
                if read is None:
                    return None
                data_start += read[0]
                values.append(read[1])
        mapped[tag] = values
    return mapped


def _read_vwi(data: bytes, offset: int) -> tuple[int, int] | None:
    value = 0
    consumed = 0
    while consumed < 5 and offset + consumed < len(data):
        byte = data[offset + consumed]
        consumed += 1
        value = (value << 7) | (byte & 0x7F)
        if byte & 0x80:
            return consumed, value
    return None


def _count_set_bits(value: int) -> int:
    return sum(1 for bit in range(8) if value & (1 << bit))


def _decode_text_records(
    records: list[bytes],
    record_index: int,
    text_records: int,
    text_length: int,
    compression: int,
    trail_flags: int,
) -> bytes:
    parts = []
    remaining = text_length if text_length > 0 else 2**62
    for index in range(text_records):
        if remaining <= 0:
            break
        at = record_index + 1 + index
        if at >= len(records):
            raise FastFallback("AZW3 正文记录缺失。")
        trimmed = _strip_trailers(records[at], trail_flags)
        limit = min(4096, remaining)
        plain = _palmdoc_decompress(trimmed, limit) if compression == 2 else trimmed[: min(len(trimmed), limit)]
        parts.append(plain)
        remaining -= len(plain)
    return b"".join(parts)


def _strip_trailers(data: bytes, flags: int) -> bytes:
    if not flags or not data:
        return data
    out = data
    bits = flags
    trailers = 0
    while bits > 1:
        if bits & 2:
            trailers += 1
        bits >>= 1
    for _ in range(trailers):
        size = _trailing_entry_size(out)
        if size <= 0 or size > len(out):
            break
        out = out[: len(out) - size]
    if (flags & 1) and out:
        extra = (out[-1] & 3) + 1
        if extra <= len(out):
            out = out[: len(out) - extra]
    return out


def _trailing_entry_size(data: bytes) -> int:
    number = 0
    for value in data[max(0, len(data) - 4) :]:
        if value & 0x80:
            number = 0
        number = (number << 7) | (value & 0x7F)
    return number


def _palmdoc_decompress(data: bytes, uncompressed_length: int) -> bytes:
    out = bytearray()
    index = 0
    limit = uncompressed_length if uncompressed_length > 0 else 2**62
    while index < len(data) and len(out) < limit:
        code = data[index]
        index += 1
        if 1 <= code <= 8:
            for _ in range(code):
                if index >= len(data) or len(out) >= limit:
                    break
                out.append(data[index])
                index += 1
        elif code < 128:
            out.append(code)
        elif code >= 192:
            if len(out) < limit:
                out.append(32)
            if len(out) < limit:
                out.append(code ^ 128)
        else:
            if index >= len(data):
                break
            second = data[index]
            index += 1
            distance = (((code << 8) | second) >> 3) & 0x7FF
            length = (second & 0x07) + 3
            if distance <= 0 or distance > len(out):
                break
            for _ in range(length):
                if len(out) >= limit:
                    break
                out.append(out[-distance])
    return bytes(out)


def _collect_css(flows: list[bytes], encoding: int, images: list[tuple[str, bytes]]) -> str:
    sheets = []
    for flow in flows:
        text = _decode_bytes(flow, encoding).replace("\0", "").strip()
        if not text:
            continue
        blocks = re.findall(r"<style[^>]*>([\s\S]*?)</style>", text, flags=re.I)
        css = "\n".join(blocks) if blocks else text
        css = re.sub(r"</?style[^>]*>", "", css, flags=re.I)
        if css.strip():
            sheets.append(_rewrite_kindle(css, images))
    return "\n".join(sheets)


def _rewrite_kindle(text: str, images: list[tuple[str, bytes]]) -> str:
    text = re.sub(r"<link\b[^>]*kindle:flow:[^>]*>", "", text, flags=re.I)

    def embed(match: re.Match[str]) -> str:
        index = int(match.group(1), 16)
        image = images[index - 1] if 0 <= index - 1 < len(images) else images[index] if 0 <= index < len(images) else None
        if image is None:
            return match.group(0)
        mime, blob = image
        return f"data:{mime};base64,{base64.b64encode(blob).decode('ascii')}"

    text = re.sub(r"kindle:embed:([0-9A-Fa-f]+)(?:\?[^\"')\s]*)?", embed, text)
    text = re.sub(r"kindle:pos:[^\"')\s]*", "#", text)

    def recindex(match: re.Match[str]) -> str:
        index = int(match.group(2)) - 1
        if not 0 <= index < len(images):
            return match.group(0)
        mime, blob = images[index]
        encoded = base64.b64encode(blob).decode("ascii")
        return f'<img{match.group(1)} src="data:{mime};base64,{encoded}"{match.group(3)}>'

    return re.sub(
        r'<img\b([^>]*?)\srecindex\s*=\s*["\'](\d+)["\']([^>]*)>',
        recindex,
        text,
        flags=re.I,
    )


def _collect_images(records: list[bytes], first_image: int | None) -> list[tuple[str, bytes]]:
    if first_image is None or first_image < 0 or first_image >= len(records):
        return []
    images = []
    for record in records[first_image:]:
        mime = _image_mime(record)
        if mime is None:
            break
        images.append((mime, record))
    return images


def _image_mime(data: bytes) -> str | None:
    if len(data) >= 3 and data[0] == 0xFF and data[1] == 0xD8 and data[2] == 0xFF:
        return "image/jpeg"
    if len(data) >= 8 and data[0] == 0x89 and data[1:4] == b"PNG":
        return "image/png"
    if len(data) >= 4 and data[:4] == b"GIF8":
        return "image/gif"
    return None


def _read_exth(rec0: bytes, offset: int) -> dict[int, list[bytes]]:
    found: dict[int, list[bytes]] = {}
    if offset < 0 or offset + 12 > len(rec0) or rec0[offset : offset + 4] != b"EXTH":
        return found
    count = _u32(rec0, offset + 8)
    cursor = offset + 12
    for _ in range(count):
        if cursor + 8 > len(rec0):
            break
        kind = _u32(rec0, cursor)
        length = _u32(rec0, cursor + 4)
        if length < 8 or cursor + length > len(rec0):
            break
        found.setdefault(kind, []).append(rec0[cursor + 8 : cursor + length])
        cursor += length
    return found


def _visible_text(html: str) -> str:
    text = re.sub(r"<script\b[^>]*>[\s\S]*?</script>", " ", html, flags=re.I)
    text = re.sub(r"<style\b[^>]*>[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", text).strip()


def _heading_of(html: str) -> str:
    match = re.search(r"<h[1-3]\b[^>]*>([\s\S]*?)</h[1-3]>", html, re.I)
    if not match:
        return ""
    return _visible_text(match.group(1))[:80]


def _extract_body(html: str) -> str:
    match = re.search(r"<body\b[^>]*>([\s\S]*?)</body>", html, re.I)
    body = match.group(1) if match else html
    return re.sub(r"<script\b[^>]*>[\s\S]*?</script>", "", body, flags=re.I)


def _utf8(data: bytes) -> str:
    if not data:
        return ""
    return data.decode("utf-8", "replace").rstrip("\0").strip()


def _decode_bytes(data: bytes, encoding: int) -> str:
    if encoding == 1252:
        return data.decode("cp1252", "replace")
    return data.decode("utf-8", "replace")


def _absolute_index(section_start: int, value: int | None) -> int | None:
    if value is None or value == 0xFFFFFFFF or value > 0xFFFF:
        return None
    return section_start + value
