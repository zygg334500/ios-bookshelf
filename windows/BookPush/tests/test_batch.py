import os
import stat
import tempfile
import threading
import time
import unittest
import zipfile
from io import BytesIO
from pathlib import Path
from unittest import mock

from bookpush.batch import convert_batch
from bookpush.kindle import CALIBRE_MISSING
from bookpush.queue import push_batch
from bookpush.mock_server import serve


ROOT = Path(__file__).resolve().parents[3]


def _sample() -> bytes:
    return (ROOT / "samples" / "window-free.azw3").read_bytes()


def _huff() -> bytes:
    payload = b"not-text"
    record = (17480).to_bytes(2, "big") + b"\x00\x00" + len(payload).to_bytes(4, "big")
    record += (1).to_bytes(2, "big") + (4096).to_bytes(2, "big")
    record += (0).to_bytes(2, "big") + b"\x00\x00" + b"MOBI" + payload
    header = bytearray(78)
    header[60:68] = b"BOOKMOBI"
    header[76:78] = (1).to_bytes(2, "big")
    offset = 78 + 8
    header += offset.to_bytes(4, "big") + b"\x00\x00\x00\x00"
    return bytes(header) + record


def _write_script(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


class BatchConvertTests(unittest.TestCase):
    def test_cache_skips_second_conversion(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            source = directory / "window-free.azw3"
            source.write_bytes(_sample())
            cache = directory / "cache"
            work = directory / "work"
            work.mkdir()
            first = convert_batch([source], cache_dir=cache, work_dir=work, search=False, workers=1)
            self.assertTrue(first[0].ok)
            self.assertIn("未调用 Calibre", first[0].note or "")
            with zipfile.ZipFile(BytesIO(first[0].output.read_bytes())) as archive:
                self.assertIn("没有数字版权保护", archive.read("OEBPS/c1.xhtml").decode("utf-8"))
            with mock.patch("bookpush.batch.fast_convert_path", side_effect=AssertionError("should use cache")):
                second = convert_batch([source], cache_dir=cache, work_dir=work, search=False, workers=1)
            self.assertTrue(second[0].ok)
            self.assertTrue(second[0].cached)
            self.assertIn("缓存", second[0].note or "")
            self.assertEqual(second[0].output.read_bytes(), first[0].output.read_bytes())

    def test_identical_bytes_convert_once(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            first = directory / "a.azw3"
            second = directory / "b.azw3"
            first.write_bytes(_sample())
            second.write_bytes(_sample())
            calls = []
            original = __import__("bookpush.fastconvert", fromlist=["fast_convert_path"]).fast_convert_path

            def wrapped(path_str: str):
                calls.append(path_str)
                return original(path_str)

            with mock.patch("bookpush.batch.fast_convert_path", wrapped):
                items = convert_batch(
                    [first, second],
                    cache_dir=directory / "cache",
                    work_dir=directory / "work",
                    search=False,
                    workers=1,
                )
            self.assertEqual(len(calls), 1)
            self.assertTrue(all(item.ok for item in items))
            self.assertEqual(items[0].output.name, "a.epub")
            self.assertEqual(items[1].output.name, "b.epub")
            self.assertEqual(items[0].output.read_bytes(), items[1].output.read_bytes())

    def test_fast_pool_overlaps(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            paths = []
            for index in range(3):
                # Distinct bytes so the cache cannot collapse them into one job.
                path = directory / f"book-{index}.azw3"
                path.write_bytes(_sample() + bytes([index]))
                paths.append(path)
            log = directory / "log.txt"
            with mock.patch.dict(os.environ, {"BOOKPUSH_FAST_DELAY": "0.6", "BOOKPUSH_CONVERT_LOG": str(log)}):
                started = time.time()
                items = convert_batch(
                    paths,
                    cache_dir=directory / "cache",
                    work_dir=directory / "work",
                    search=False,
                    workers=3,
                )
                elapsed = time.time() - started
            self.assertTrue(all(item.ok for item in items))
            lines = [line for line in log.read_text(encoding="utf-8").splitlines() if line]
            starts = [float(line.split()[1]) for line in lines if line.startswith("start")]
            ends = [float(line.split()[1]) for line in lines if line.startswith("end")]
            self.assertEqual(len(starts), 3)
            self.assertLess(max(starts), min(ends))
            self.assertLess(elapsed, 1.8)

    def test_pdf_is_not_opened_by_the_converter(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            pdf = directory / "notes.pdf"
            pdf.write_bytes(b"%PDF-1.4")
            tool = directory / "ebook-convert"
            _write_script(tool, "#!/bin/sh\necho ran > \"$0.ran\"\nexit 1\n")
            items = convert_batch([pdf], cache_dir=directory / "cache", work_dir=directory / "work", converter=tool, search=False)
            self.assertTrue(items[0].ok)
            self.assertEqual(items[0].output, pdf)
            self.assertFalse((directory / "ebook-convert.ran").exists())

    def test_calibre_pool_overlaps_and_isolates_config(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            log = directory / "log.txt"
            tool = directory / "ebook-convert"
            _write_script(
                tool,
                "#!/usr/bin/env python3\n"
                "import os, pathlib, sys, time\n"
                "assert len(sys.argv) == 3\n"
                "assert 'drm' not in '\\n'.join(sys.argv).lower()\n"
                f"path = pathlib.Path({str(log)!r})\n"
                "with path.open('a', encoding='utf-8') as handle:\n"
                "    handle.write(f'start {time.time():.4f}\\n')\n"
                "time.sleep(0.6)\n"
                "pathlib.Path(sys.argv[2]).write_bytes(b'PK\\x03\\x04converted')\n"
                "config = os.environ.get('CALIBRE_CONFIG_DIRECTORY', '')\n"
                "if 'calibre-clean-config' not in config:\n"
                "    raise SystemExit(config or 'missing config')\n"
                "with path.open('a', encoding='utf-8') as handle:\n"
                "    handle.write(f'end {time.time():.4f}\\n')\n",
            )
            paths = []
            for index in range(3):
                path = directory / f"locked-format-{index}.azw3"
                path.write_bytes(_huff() + bytes([index]))
                paths.append(path)
            items = convert_batch(
                paths,
                cache_dir=directory / "cache",
                work_dir=directory / "work",
                converter=tool,
                search=False,
                workers=3,
            )
            self.assertTrue(all(item.ok for item in items), [item.detail for item in items])
            self.assertTrue(all((item.note or "").startswith("已用 Calibre") for item in items))
            lines = log.read_text(encoding="utf-8").splitlines()
            starts = [float(line.split()[1]) for line in lines if line.startswith("start")]
            ends = [float(line.split()[1]) for line in lines if line.startswith("end")]
            self.assertEqual(len(starts), 3)
            self.assertLess(max(starts), min(ends))

    def test_persistent_calibre_worker_is_preferred(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            ran = directory / "cli-ran"
            tool = directory / "ebook-convert"
            _write_script(tool, f"#!/bin/sh\necho no > {ran}\nexit 1\n")
            debug = directory / "calibre-debug"
            _write_script(
                debug,
                "#!/usr/bin/env python3\n"
                "import json, sys, pathlib\n"
                "sys.stdout.write(json.dumps({'ready': True}) + '\\n')\n"
                "sys.stdout.flush()\n"
                "for line in sys.stdin:\n"
                "    if not line.strip():\n"
                "        continue\n"
                "    job = json.loads(line)\n"
                "    if job.get('stop'):\n"
                "        break\n"
                "    pathlib.Path(job['dest']).write_bytes(b'PK\\x03\\x04worker')\n"
                "    sys.stdout.write(json.dumps({'ok': True}) + '\\n')\n"
                "    sys.stdout.flush()\n",
            )
            source = directory / "needs.azw3"
            source.write_bytes(_huff())
            items = convert_batch(
                [source],
                cache_dir=directory / "cache",
                work_dir=directory / "work",
                converter=tool,
                search=False,
                workers=1,
            )
            self.assertTrue(items[0].ok, items[0].detail)
            self.assertTrue(items[0].output.read_bytes().startswith(b"PK"))
            self.assertFalse(ran.exists())
            self.assertTrue((items[0].note or "").startswith("已用 Calibre"))

    def test_drm_failure_from_calibre_skips_that_file_only(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            tool = directory / "ebook-convert"
            _write_script(
                tool,
                "#!/usr/bin/env python3\n"
                "import pathlib, sys\n"
                "name = pathlib.Path(sys.argv[1]).name\n"
                "if 'drm' in name:\n"
                "    sys.stderr.write('This book is locked by DRM\\n')\n"
                "    raise SystemExit(1)\n"
                "pathlib.Path(sys.argv[2]).write_bytes(b'PK\\x03\\x04ok')\n",
            )
            good = directory / "good.azw3"
            bad = directory / "has-drm.azw3"
            pdf = directory / "notes.pdf"
            good.write_bytes(_huff())
            bad.write_bytes(_huff() + b"\x01")
            pdf.write_bytes(b"%PDF")
            items = convert_batch(
                [good, bad, pdf],
                cache_dir=directory / "cache",
                work_dir=directory / "work",
                converter=tool,
                search=False,
                workers=2,
            )
            self.assertTrue(items[0].ok)
            self.assertFalse(items[1].ok)
            self.assertIn("受数字版权保护", items[1].detail)
            self.assertIn("不会尝试解除保护", items[1].detail)
            self.assertNotIn("破解", items[1].detail)
            self.assertTrue(items[2].ok)
            self.assertEqual(items[2].output, pdf)

    def test_missing_calibre_message(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            source = directory / "odd.azw3"
            source.write_bytes(_huff())
            items = convert_batch(
                [source],
                cache_dir=directory / "cache",
                work_dir=directory / "work",
                search=False,
                workers=1,
            )
            self.assertFalse(items[0].ok)
            self.assertIn("calibre-ebook.com", items[0].detail)
            self.assertIn("DeDRM", items[0].detail)
            self.assertEqual(items[0].detail, CALIBRE_MISSING)

    def test_upload_starts_while_a_conversion_is_still_running(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            log = directory / "log.txt"
            tool = directory / "ebook-convert"
            _write_script(
                tool,
                "#!/usr/bin/env python3\n"
                "import os, pathlib, sys, time\n"
                f"pathlib.Path({str(log)!r}).write_text('started', encoding='utf-8')\n"
                "time.sleep(0.8)\n"
                "pathlib.Path(sys.argv[2]).write_bytes(b'PK\\x03\\x04late')\n",
            )
            epub = directory / "窗下.epub"
            epub.write_bytes(b"EPUB-ready")
            slow = directory / "slow.azw3"
            slow.write_bytes(_huff())
            received = directory / "in"
            server = serve("127.0.0.1", 0, received, pin="2468")
            port = server.server_address[1]
            holder: list = []

            def run() -> None:
                holder.append(
                    push_batch(
                        [epub, slow],
                        "127.0.0.1",
                        port,
                        "2468",
                        converter=tool,
                        search=False,
                        cache_dir=directory / "cache",
                        workers=2,
                    )
                )

            try:
                thread = threading.Thread(target=run)
                thread.start()
                deadline = time.time() + 5
                while not log.exists() and time.time() < deadline:
                    time.sleep(0.02)
                self.assertTrue(log.exists(), "conversion did not start")
                self.assertTrue((received / "窗下.epub").exists(), "EPUB waited for the slow AZW3 conversion")
                self.assertEqual((received / "窗下.epub").read_bytes(), b"EPUB-ready")
                thread.join(timeout=5)
                self.assertFalse(thread.is_alive())
            finally:
                server.shutdown()
                server.server_close()
            outcomes = holder[0]
            self.assertEqual([item.ok for item in outcomes], [True, True])


if __name__ == "__main__":
    unittest.main()
