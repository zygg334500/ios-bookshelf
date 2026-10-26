import tempfile
import unittest
from pathlib import Path

from bookpush.mock_server import serve
from bookpush.queue import PushQueue, describe_batch, push_batch


def _palm(encryption: int) -> bytes:
    payload = "锁定".encode()
    record = b"\x00\x01\x00\x00" + len(payload).to_bytes(4, "big") + b"\x00\x01\x10\x00"
    record += encryption.to_bytes(2, "big") + b"\x00\x00" + b"MOBI" + payload
    header = bytearray(78)
    header[60:68] = b"BOOKMOBI"
    header[76:78] = (1).to_bytes(2, "big")
    offset = 78 + 8
    header += offset.to_bytes(4, "big") + b"\x00\x00\x00\x00"
    return bytes(header) + record


class QueueTests(unittest.TestCase):
    def test_add_remove_and_list_many_books(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            paths = []
            for name in ("窗下.epub", "notes.pdf", "window-free.azw3"):
                path = directory / name
                path.write_bytes(b"book")
                paths.append(path)
            queue = PushQueue()
            added = queue.add(paths + [paths[0]])
            self.assertEqual(added, ["窗下.epub", "notes.pdf", "window-free.azw3"])
            self.assertEqual(queue.labels(), added)
            self.assertIn("3 本", queue.summary())
            removed = queue.remove_at([1])
            self.assertEqual(removed, ["notes.pdf"])
            self.assertEqual(queue.labels(), ["窗下.epub", "window-free.azw3"])
            self.assertEqual(queue.clear(), 2)
            self.assertEqual(queue.labels(), [])
            self.assertIn("空的", queue.summary())

    def test_one_drm_book_does_not_stop_the_others(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            epub = directory / "窗下.epub"
            locked = directory / "locked.azw3"
            pdf = directory / "notes.pdf"
            epub.write_bytes(b"EPUB-one")
            locked.write_bytes(_palm(2))
            pdf.write_bytes(b"%PDF-1.4 english notes")
            received = directory / "in"
            server = serve("127.0.0.1", 0, received, pin="2468")
            port = server.server_address[1]
            try:
                outcomes = push_batch([epub, locked, pdf], "127.0.0.1", port, "2468")
            finally:
                server.shutdown()
            self.assertEqual([item.ok for item in outcomes], [True, False, True])
            self.assertIn("受数字版权保护", outcomes[1].detail)
            self.assertNotIn("破解", outcomes[1].detail)
            self.assertEqual((received / "窗下.epub").read_bytes(), b"EPUB-one")
            self.assertEqual((received / "notes.pdf").read_bytes(), b"%PDF-1.4 english notes")
            self.assertFalse((received / "locked.azw3").exists())
            summary = describe_batch(outcomes)
            self.assertIn("已送出 2 本", summary)
            self.assertIn("1 本失败", summary)


if __name__ == "__main__":
    unittest.main()
