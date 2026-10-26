import tempfile
import unittest
from pathlib import Path

from bookpush.mock_server import serve
from bookpush.uploader import UploadError, upload_book


class UploadTests(unittest.TestCase):
    def test_round_trip_and_wrong_pin(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            source = directory / "窗下.epub"
            payload = b"EPUB-bytes\r\nkeep"
            source.write_bytes(payload)
            received = directory / "in"
            server = serve("127.0.0.1", 0, received, pin="2468")
            port = server.server_address[1]
            try:
                with self.assertRaises(UploadError):
                    upload_book("127.0.0.1", port, source, "0000")
                result = upload_book("127.0.0.1", port, source, "2468")
            finally:
                server.shutdown()
            self.assertTrue(result["ok"])
            self.assertEqual((received / "窗下.epub").read_bytes(), payload)
            self.assertGreater(result["bytes"], 0)


if __name__ == "__main__":
    unittest.main()
