#!/usr/bin/env python3
"""Create tiny original, DRM-free fixtures and the app icon. No copyrighted books."""

from __future__ import annotations

import struct
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"
BUNDLED = ROOT / "app" / "assets" / "samples"
ASSETS = ROOT / "app" / "assets"

STORY_1 = """雨下到后半夜才小。我把椅子拖到窗边，没有开灯，只留着对面楼一格还亮着的厨房。

书架最上一层躺着一本没读完的书。书脊已经发白，我却总在同一页停住：一个人推开门，发现院子里的水比记忆里浅。我把那句话又看了一遍。字是简体的，横排，像平时写给自己的便条。

我想起白天在电车上听见两个人争论该不该把旧书裁开。一个说纸会旧，一个说旧了才像自己的。车门打开的时候，雨气跟着进来，谁也没说服谁。

如果把这些字竖过来，从右往左读，句子会慢一点。标点也只好跟着句子站好。这不是古籍，只是一个用来试阅读器的短篇，所以我把想说的话写短一些。

窗玻璃上有一道水痕，从左上角拖到窗框。我用指节碰了碰，冰的。屋里的钟走得很快，快得不像夜里。"""

STORY_2 = """灯是后来才打开的。暖光落在桌面上，把书页照得有点发黄。我把字号调大一号，又换成宋体，句子忽然像印在旧报纸上。

第二章很短。它存在，是为了让目录里有一个可以跳过去的名字。你从第一章翻到这里，进度条应当往前走一截；合上之后再打开，应当还停在附近。

我在页脚想象一个很小的页码。不需要华丽，只要翻页的时候纸面微微抬起，露出下面已经写好的下一页。

读完可以把书留在书架上。它没有版权人物，没有从别处抄来的章节，只有这些为了试软件而写下的句子。"""

VERTICAL = """窗下有雨。雨不大，卻把院子裡的石階洗得很乾淨。我坐在燈下，把一篇本來橫著寫的短文改成豎排，讓字從上往下、從右往左走。

這一段本來就是繁體。閱讀器裡的「豎排繁體」會再跑一遍簡轉繁；已經是繁體的字應當保持原樣。標點停在句子旁邊，不需要被人為地扳正。

我記得小時候習字，老師讓我們先把「書」寫端正，再談快慢。軟體做不到老師那種眼光，它只能把常見的簡體換成表裡的繁體，偶爾會在「髮」和「發」之間挑錯。那是顯示用的轉換，不會改你原來的文件。

如果你把簡體的《窗下》也切到這個模式，橫排會變成直排，句子會換一副筆畫。試完可以關回去。夜還長，雨還沒有停。"""

AZW3_HTML = """<html><head><title>无锁的样本</title></head><body>
<h1>无锁的样本</h1>
<p>这是一本没有数字版权保护的 AZW3 样本，正文是原创的，用来确认阅读器能把无 DRM 的 KF8 当成书打开。</p>
<p>若加密标志不是 0，BookShelf 会停下，并用中文说明它不能打开受 DRM 保护的文件。它不会尝试解除保护。</p>
<p>你可以把这一本留在书架上，也可以删掉。它很短，短到适合做第一次翻页测试。</p>
</body></html>"""


def write_epub(path: Path, title: str, author: str, chapters: list[tuple[str, str]], cover: bytes) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        archive.writestr(
            "META-INF/container.xml",
            """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>""",
        )
        manifest = [
            '<item id="cover-img" href="cover.png" media-type="image/png" properties="cover-image"/>',
            '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
            '<item id="css" href="style.css" media-type="text/css"/>',
        ]
        spine = []
        nav = []
        for index, (label, _) in enumerate(chapters, start=1):
            manifest.append(
                f'<item id="c{index}" href="c{index}.xhtml" media-type="application/xhtml+xml"/>'
            )
            spine.append(f'<itemref idref="c{index}"/>')
            nav.append(f'<li><a href="c{index}.xhtml">{label}</a></li>')
        opf = f"""<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:{path.stem}</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:creator>{author}</dc:creator>
    <dc:language>zh</dc:language>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    {''.join(manifest)}
  </manifest>
  <spine>
    {''.join(spine)}
  </spine>
</package>"""
        archive.writestr("OEBPS/content.opf", opf)
        archive.writestr("OEBPS/style.css", "p { line-height: 1.75; } h1 { font-weight: 600; }")
        archive.writestr("OEBPS/cover.png", cover)
        archive.writestr(
            "OEBPS/nav.xhtml",
            f"""<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol>{''.join(nav)}</ol></nav></body>
</html>""",
        )
        for index, (label, body) in enumerate(chapters, start=1):
            paragraphs = "".join(f"<p>{line}</p>" for line in body.strip().split("\n\n"))
            archive.writestr(
                f"OEBPS/c{index}.xhtml",
                f"""<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>{label}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
  <body><h1>{label}</h1>{paragraphs}</body>
</html>""",
            )


def u16(value: int) -> bytes:
    return struct.pack(">H", value)


def u32(value: int) -> bytes:
    return struct.pack(">I", value)


def write_azw3(path: Path, html: str, title: str, author: str) -> None:
    html_bytes = html.encode("utf-8")
    title_bytes = title.encode("utf-8")
    author_bytes = author.encode("utf-8")
    text_records = [html_bytes[i : i + 4096] for i in range(0, len(html_bytes), 4096)] or [b""]
    exth_records = b"".join(
        [
            u32(503),
            u32(len(title_bytes) + 8),
            title_bytes,
            u32(100),
            u32(len(author_bytes) + 8),
            author_bytes,
        ]
    )
    exth = b"EXTH" + u32(12 + len(exth_records)) + u32(2) + exth_records
    if len(exth) % 4:
        exth += b"\0" * (4 - (len(exth) % 4))
    header_length = 0xE8
    mobi = bytearray(header_length)
    mobi[0:4] = b"MOBI"
    struct.pack_into(">I", mobi, 4, header_length)
    struct.pack_into(">I", mobi, 8, 2)
    struct.pack_into(">I", mobi, 12, 65001)
    struct.pack_into(">I", mobi, 16, 42)
    struct.pack_into(">I", mobi, 20, 6)
    struct.pack_into(">I", mobi, 0x5C, 0xFFFFFFFF)
    struct.pack_into(">I", mobi, 0x70, 0x40)
    full_name_offset = 16 + header_length + len(exth)
    struct.pack_into(">I", mobi, 0x44, full_name_offset)
    struct.pack_into(">I", mobi, 0x48, len(title_bytes))
    palm = b"".join(
        [
            u16(1),
            u16(0),
            u32(len(html_bytes)),
            u16(len(text_records)),
            u16(4096),
            u16(0),
            u16(0),
        ]
    )
    record0 = palm + bytes(mobi) + exth + title_bytes
    records = [record0, *text_records]
    header = bytearray(78)
    header[0:6] = b"Sample"
    header[60:64] = b"BOOK"
    header[64:68] = b"MOBI"
    struct.pack_into(">H", header, 76, len(records))
    listing = bytearray(len(records) * 8 + 2)
    cursor = 78 + len(listing)
    for index, record in enumerate(records):
        struct.pack_into(">I", listing, index * 8, cursor)
        cursor += len(record)
    path.write_bytes(bytes(header) + bytes(listing) + b"".join(records))


def pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def write_pdf(path: Path, pages: list[list[str]]) -> None:
    objects: list[bytes] = []

    def add(data: str | bytes) -> int:
        objects.append(data.encode("latin-1") if isinstance(data, str) else data)
        return len(objects)

    font_id = 3
    page_ids: list[int] = []
    content_ids: list[int] = []
    # Reserve numbers: 1 catalog, 2 pages, 3 font, then pairs.
    catalog = add("<< /Type /Catalog /Pages 2 0 R >>")
    pages_id = add("<< /Type /Pages >>")
    font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>")
    assert catalog == 1 and pages_id == 2 and font == font_id
    for lines in pages:
        commands = ["BT /F1 18 Tf 72 740 Td 16 TL"]
        for index, line in enumerate(lines):
            if index:
                commands.append("T*")
            commands.append(f"({pdf_escape(line)}) Tj")
        commands.append("ET")
        stream = "\n".join(commands).encode("latin-1")
        content_ids.append(
            add(f"<< /Length {len(stream)} >>\nstream\n".encode("latin-1") + stream + b"\nendstream")
        )
        page_ids.append(0)
    built_pages = []
    for content_id in content_ids:
        built_pages.append(
            add(
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                f"/Contents {content_id} 0 R /Resources << /Font << /F1 3 0 R >> >> >>"
            )
        )
    kids = " ".join(f"{page} 0 R" for page in built_pages)
    objects[1] = f"<< /Type /Pages /Count {len(built_pages)} /Kids [{kids}] >>".encode("latin-1")
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{index} 0 obj\n".encode("latin-1") + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode("latin-1")
    out += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        out += f"{offset:010d} 00000 n \n".encode("latin-1")
    out += (
        f"trailer<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode("latin-1")
    )
    path.write_bytes(out)


def draw_book(size: int, background: tuple[int, int, int, int] | None = None) -> Image.Image:
    image = Image.new("RGBA", (size, size), background or (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    margin = int(size * 0.16)
    cover = [margin, int(size * 0.12), size - margin, size - int(size * 0.12)]
    draw.rounded_rectangle(cover, radius=int(size * 0.04), fill=(122, 49, 44, 255))
    draw.rectangle([cover[0], cover[1], cover[0] + int(size * 0.07), cover[3]], fill=(78, 28, 26, 255))
    inset = int(size * 0.12)
    draw.rectangle(
        [cover[0] + inset, cover[1] + inset, cover[2] - int(size * 0.08), cover[1] + inset + int(size * 0.015)],
        fill=(232, 214, 170, 255),
    )
    draw.rectangle(
        [cover[0] + inset, cover[1] + inset * 2, cover[2] - int(size * 0.18), cover[1] + inset * 2 + max(2, size // 180)],
        fill=(232, 214, 170, 180),
    )
    return image


def write_icons() -> None:
    cream = (230, 221, 208, 255)
    icon = draw_book(1024, cream)
    icon.save(ASSETS / "icon.png")
    splash = draw_book(512, (0, 0, 0, 0))
    splash.save(ASSETS / "splash-icon.png")
    icon.resize((48, 48), Image.Resampling.LANCZOS).save(ASSETS / "favicon.png")
    icon.resize((512, 512), Image.Resampling.LANCZOS).save(ASSETS / "android-icon-foreground.png")
    Image.new("RGBA", (512, 512), cream).save(ASSETS / "android-icon-background.png")
    draw_book(512, (0, 0, 0, 0)).convert("L").save(ASSETS / "android-icon-monochrome.png")


def cover_png(title: str) -> bytes:
    image = draw_book(900, (230, 221, 208, 255)).convert("RGB")
    image = image.resize((600, 900))
    buffer = Path(SAMPLES / f".{title}.png")
    image.save(buffer, format="PNG")
    data = buffer.read_bytes()
    buffer.unlink()
    return data


def main() -> None:
    SAMPLES.mkdir(parents=True, exist_ok=True)
    BUNDLED.mkdir(parents=True, exist_ok=True)
    write_icons()
    files = {
        "window.epub": None,
        "vertical-traditional.epub": None,
        "notes.pdf": None,
        "window-free.azw3": None,
    }
    cover = cover_png("window")
    epub = SAMPLES / "window.epub"
    write_epub(epub, "窗下", "原创样本", [("雨停之前", STORY_1), ("灯", STORY_2)], cover)
    vertical = SAMPLES / "vertical-traditional.epub"
    write_epub(vertical, "竖排短章", "原创样本", [("窗下有雨", VERTICAL)], cover_png("vertical"))
    pdf = SAMPLES / "notes.pdf"
    write_pdf(
        pdf,
        [
            ["Notes from a paper shelf", "An original fixture, not a published book.", "Page one. The Chinese samples are EPUBs."],
            ["The reader keeps this page as a fixed PDF.", "Curl is a perspective fold, not a reflow.", "Standard Times-Roman only."],
            ["Turn again. Progress should move.", "Close the book and it remembers the page.", "No network is required after import."],
            ["Last page.", "If you can read this, PDF.js rendered the fixture.", "End of the paper notes."],
        ],
    )
    azw = SAMPLES / "window-free.azw3"
    write_azw3(azw, AZW3_HTML, "无锁的样本", "原创样本")
    for name in files:
        target = BUNDLED / name
        target.write_bytes((SAMPLES / name).read_bytes())
    print("wrote samples and icons")


if __name__ == "__main__":
    main()
