import unittest
import zipfile
from io import BytesIO
from pathlib import Path

from bookpush.fastconvert import FastDrm, _palmdoc_decompress, build_epub, convert_bytes
from bookpush.kindle import DRM_MESSAGE


ROOT = Path(__file__).resolve().parents[3]


def test_palm(encryption: int, payload: bytes = b"hello", compression: int = 1) -> bytes:
    record = compression.to_bytes(2, "big") + b"\x00\x00" + len(payload).to_bytes(4, "big")
    record += (1).to_bytes(2, "big") + (4096).to_bytes(2, "big")
    record += encryption.to_bytes(2, "big") + b"\x00\x00" + b"MOBI" + payload
    header = bytearray(78)
    header[60:68] = b"BOOKMOBI"
    header[76:78] = (1).to_bytes(2, "big")
    offset = 78 + 8
    header += offset.to_bytes(4, "big") + b"\x00\x00\x00\x00"
    return bytes(header) + record


class FastConvertTests(unittest.TestCase):
    def test_palmdoc_round_trip_literals_and_backreference(self) -> None:
        self.assertEqual(_palmdoc_decompress(b"Hello", 5), b"Hello")
        compressed = b"abc" + bytes([0x80, 0x18])
        self.assertEqual(_palmdoc_decompress(compressed, 6), b"abcabc")

    def test_sample_azw3_becomes_epub_without_calibre(self) -> None:
        data = (ROOT / "samples" / "window-free.azw3").read_bytes()
        book = convert_bytes(data)
        self.assertEqual(book.title, "无锁的样本")
        self.assertIn("没有数字版权保护", book.chapters[0].html)
        epub = build_epub(book)
        self.assertTrue(epub.startswith(b"PK"))
        with zipfile.ZipFile(BytesIO(epub)) as archive:
            self.assertEqual(archive.read("mimetype"), b"application/epub+zip")
            self.assertIn("OEBPS/content.opf", archive.namelist())
            chapter = archive.read("OEBPS/c1.xhtml").decode("utf-8")
            self.assertIn("没有数字版权保护", chapter)
            opf = archive.read("OEBPS/content.opf").decode("utf-8")
            self.assertIn("无锁的样本", opf)

    def test_drm_is_refused_before_text(self) -> None:
        with self.assertRaises(FastDrm) as caught:
            convert_bytes(test_palm(2, "秘密".encode()))
        self.assertEqual(str(caught.exception), DRM_MESSAGE)
        self.assertNotIn("破解", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
