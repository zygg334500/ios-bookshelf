import stat
import tempfile
import unittest
from pathlib import Path

from bookpush.kindle import DRM_MESSAGE, KFX_MESSAGE, prepare_book
from bookpush.uploader import UploadError


def _palm(encryption: int, payload: bytes = b"hello") -> bytes:
    record = b"\x00\x01" + b"\x00\x00" + len(payload).to_bytes(4, "big") + b"\x00\x01\x10\x00"
    record += encryption.to_bytes(2, "big") + b"\x00\x00" + b"MOBI" + payload
    header = bytearray(78)
    header[60:68] = b"BOOKMOBI"
    header[76:78] = (1).to_bytes(2, "big")
    offset = 78 + 8
    header += offset.to_bytes(4, "big") + b"\x00\x00\x00\x00"
    return bytes(header) + record


class KindlePrepareTests(unittest.TestCase):
    def test_drm_is_refused_before_any_converter_runs(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            source = directory / "locked.azw3"
            source.write_bytes(_palm(2))
            marker = directory / "converter-ran"
            tool = directory / "ebook-convert"
            tool.write_text("#!/bin/sh\ntouch \"$0.ran\"\n", encoding="utf-8")
            tool.chmod(tool.stat().st_mode | stat.S_IEXEC)
            with self.assertRaises(UploadError) as caught:
                prepare_book(source, directory, tool, search=False)
            self.assertIn("受数字版权保护", str(caught.exception))
            self.assertIn("不会尝试解除保护", str(caught.exception))
            self.assertNotIn("破解", str(caught.exception))
            self.assertFalse((directory / "ebook-convert.ran").exists())
            self.assertFalse(marker.exists())

    def test_drmion_and_kfx_do_not_ask_for_cracking(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            drmion = directory / "x.azw3"
            drmion.write_bytes(b"NOTMOBI" + b"DRMION" + b"\x00" * 32)
            with self.assertRaises(UploadError) as caught:
                prepare_book(drmion, directory, search=False)
            self.assertEqual(str(caught.exception), DRM_MESSAGE)
            kfx = directory / "y.azw3"
            kfx.write_bytes(b"CR!something")
            with self.assertRaises(UploadError) as kfx_error:
                prepare_book(kfx, directory, search=False)
            self.assertEqual(str(kfx_error.exception), KFX_MESSAGE)
            self.assertNotIn("受数字版权保护", KFX_MESSAGE)
            self.assertNotIn("破解", KFX_MESSAGE)

    def test_unprotected_uses_converter_without_drm_flags(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            source = directory / "窗下.azw3"
            source.write_bytes(_palm(0, "窗下的正文".encode()))
            tool = directory / "ebook-convert"
            tool.write_text(
                "#!/usr/bin/env python3\n"
                "import pathlib, sys\n"
                "assert len(sys.argv) == 3\n"
                "pathlib.Path(sys.argv[2]).write_bytes(b'EPUB')\n"
                "pathlib.Path(sys.argv[2] + '.args').write_text('\\n'.join(sys.argv))\n",
                encoding="utf-8",
            )
            tool.chmod(tool.stat().st_mode | stat.S_IEXEC)
            prepared = prepare_book(source, directory, tool, search=False)
            self.assertEqual(prepared.path.read_bytes(), b"EPUB")
            self.assertTrue(str(prepared.note or "").startswith("已用 Calibre"))
            args = (directory / "窗下.epub.args").read_text(encoding="utf-8")
            self.assertNotIn("drm", args.lower())

    def test_missing_converter_sends_the_original(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            source = directory / "free.mobi"
            source.write_bytes(_palm(0))
            prepared = prepare_book(source, directory, search=False)
            self.assertEqual(prepared.path, source)
            self.assertIn("未找到 Calibre", prepared.note or "")
            self.assertIn("不会被转换或打开", prepared.note or "")

    def test_pdf_is_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            source = directory / "page.pdf"
            source.write_bytes(b"%PDF")
            prepared = prepare_book(source, directory, search=False)
            self.assertEqual(prepared.path, source)
            self.assertIsNone(prepared.note)


if __name__ == "__main__":
    unittest.main()
