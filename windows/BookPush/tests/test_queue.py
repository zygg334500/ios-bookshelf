import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from bookpush.mock_server import serve
from bookpush.queue import (
    PushOutcome,
    PushQueue,
    UploadError,
    describe_batch,
    push_batch,
    push_queue,
    upload_book,
)


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
            self.assertIn("一次送完", queue.summary())
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
            self.assertIn("移出", summary)
            self.assertIn("重试", summary)


class QueueSettleTests(unittest.TestCase):
    def test_same_filename_keeps_its_own_result(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            first_dir = root / "one"
            second_dir = root / "two"
            first_dir.mkdir()
            second_dir.mkdir()
            first = first_dir / "notes.pdf"
            second = second_dir / "notes.pdf"
            first.write_bytes(b"one")
            second.write_bytes(b"two")
            queue = PushQueue()
            self.assertEqual(queue.add([first, second]), ["notes.pdf", "notes.pdf"])
            queue.settle_one(second, PushOutcome("notes.pdf", False, detail="第二本没送到"))
            queue.settle_one(first, PushOutcome("notes.pdf", True, title="notes"))
            self.assertEqual(queue.files, [second])
            self.assertEqual(queue.snapshot()[0].status, "failed")
            self.assertEqual(queue.snapshot()[0].detail, "第二本没送到")
            self.assertEqual(queue.labels(), ["notes.pdf（失败，可重试）"])

    def test_parallel_settle_does_not_clobber_other_books(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            paths = []
            for index in range(12):
                path = directory / f"book-{index}.epub"
                path.write_bytes(f"body-{index}".encode())
                paths.append(path)
            queue = PushQueue()
            queue.add(paths)
            barrier = threading.Barrier(12)

            def apply(index: int) -> None:
                barrier.wait(timeout=5)
                failed = index % 2 == 1
                queue.settle_one(
                    paths[index],
                    PushOutcome(
                        paths[index].name,
                        not failed,
                        title=paths[index].stem,
                        detail=f"失败原因-{index}" if failed else "",
                    ),
                )

            threads = [threading.Thread(target=apply, args=(index,)) for index in range(12)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=5)
                self.assertFalse(thread.is_alive())
            remaining = queue.snapshot()
            self.assertEqual(
                [entry.path.name for entry in remaining],
                [f"book-{index}.epub" for index in range(1, 12, 2)],
            )
            for entry, index in zip(remaining, range(1, 12, 2)):
                self.assertEqual(entry.status, "failed")
                self.assertEqual(entry.detail, f"失败原因-{index}")
                self.assertIn("失败，可重试", entry.label)
            self.assertIn("6 本失败", queue.summary())

    def test_push_queue_drops_successes_and_keeps_failures(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            epub = directory / "窗下.epub"
            locked = directory / "locked.azw3"
            pdf = directory / "notes.pdf"
            extra = directory / "later.epub"
            epub.write_bytes(b"EPUB-one")
            locked.write_bytes(_palm(2))
            pdf.write_bytes(b"%PDF-1.4 english notes")
            extra.write_bytes(b"later")
            queue = PushQueue()
            queue.add([epub, locked, pdf])
            received = directory / "in"
            server = serve("127.0.0.1", 0, received, pin="2468")
            port = server.server_address[1]
            seen: list[tuple[int, str, bool, str]] = []
            added = {"done": False}

            def on_outcome(index: int, outcome: PushOutcome) -> None:
                seen.append((index, outcome.name, outcome.ok, outcome.detail))
                if not added["done"]:
                    queue.add([extra])
                    added["done"] = True

            try:
                outcomes = push_queue(
                    queue,
                    "127.0.0.1",
                    port,
                    "2468",
                    on_outcome=on_outcome,
                    workers=2,
                    search=False,
                )
            finally:
                server.shutdown()
                server.server_close()
            self.assertEqual([item.name for item in outcomes], ["窗下.epub", "locked.azw3", "notes.pdf"])
            self.assertEqual([item.ok for item in outcomes], [True, False, True])
            self.assertIn("受数字版权保护", outcomes[1].detail)
            for index, name, ok, detail in seen:
                self.assertEqual(outcomes[index].name, name)
                self.assertEqual(outcomes[index].ok, ok)
                self.assertEqual(outcomes[index].detail, detail)
            self.assertEqual([path.name for path in queue.files], ["locked.azw3", "later.epub"])
            rows = queue.snapshot()
            self.assertEqual(rows[0].status, "failed")
            self.assertIn("受数字版权保护", rows[0].detail)
            self.assertEqual(rows[1].status, "pending")
            self.assertEqual(rows[1].detail, "")
            self.assertEqual(queue.labels()[0], "locked.azw3（失败，可重试）")
            self.assertEqual(queue.labels()[1], "later.epub")
            self.assertEqual((received / "窗下.epub").read_bytes(), b"EPUB-one")
            self.assertEqual((received / "notes.pdf").read_bytes(), b"%PDF-1.4 english notes")
            self.assertFalse((received / "locked.azw3").exists())
            self.assertFalse((received / "later.epub").exists())

    def test_overlapping_batches_do_not_clobber(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            first = directory / "a.epub"
            locked = directory / "locked.azw3"
            second = directory / "b.epub"
            rejected = directory / "reject.epub"
            first.write_bytes(b"AAA")
            second.write_bytes(b"BBB")
            locked.write_bytes(_palm(2))
            rejected.write_bytes(b"NO")
            queue_a = PushQueue()
            queue_b = PushQueue()
            queue_a.add([first, locked])
            queue_b.add([second, rejected])
            received = directory / "in"
            server = serve("127.0.0.1", 0, received, pin="2468")
            port = server.server_address[1]

            def wrapped(host, port, path, pin, on_progress=None, timeout=180):
                if "reject" in path.name:
                    raise UploadError("手机没有收下这一本。")
                import time

                time.sleep(0.2)
                return upload_book(host, port, path, pin, on_progress=on_progress, timeout=timeout)

            holder: dict[str, list[PushOutcome]] = {}
            errors: list[BaseException] = []
            barrier = threading.Barrier(2)

            def run(name: str, queue: PushQueue) -> None:
                try:
                    barrier.wait(timeout=5)
                    holder[name] = push_queue(
                        queue,
                        "127.0.0.1",
                        port,
                        "2468",
                        workers=2,
                        search=False,
                    )
                except BaseException as error:  # noqa: BLE001 - surfaced below
                    errors.append(error)

            try:
                with mock.patch("bookpush.queue.upload_book", wrapped):
                    threads = [
                        threading.Thread(target=run, args=("a", queue_a)),
                        threading.Thread(target=run, args=("b", queue_b)),
                    ]
                    for thread in threads:
                        thread.start()
                    for thread in threads:
                        thread.join(timeout=8)
                        self.assertFalse(thread.is_alive())
                self.assertEqual(errors, [])
                self.assertEqual([item.name for item in holder["a"]], ["a.epub", "locked.azw3"])
                self.assertEqual([item.ok for item in holder["a"]], [True, False])
                self.assertEqual([item.name for item in holder["b"]], ["b.epub", "reject.epub"])
                self.assertEqual([item.ok for item in holder["b"]], [True, False])
                self.assertIn("受数字版权保护", holder["a"][1].detail)
                self.assertEqual(holder["b"][1].detail, "手机没有收下这一本。")
                self.assertEqual([path.name for path in queue_a.files], ["locked.azw3"])
                self.assertEqual(queue_a.snapshot()[0].detail, holder["a"][1].detail)
                self.assertEqual([path.name for path in queue_b.files], ["reject.epub"])
                self.assertEqual(queue_b.snapshot()[0].detail, "手机没有收下这一本。")
                self.assertNotIn("没有收下", queue_a.snapshot()[0].detail)
                self.assertNotIn("版权", queue_b.snapshot()[0].detail)
                self.assertEqual((received / "a.epub").read_bytes(), b"AAA")
                self.assertEqual((received / "b.epub").read_bytes(), b"BBB")
                self.assertFalse((received / "reject.epub").exists())
                retried = push_queue(queue_b, "127.0.0.1", port, "2468", search=False)
                self.assertEqual([item.ok for item in retried], [True])
                self.assertEqual(queue_b.files, [])
                self.assertEqual((received / "reject.epub").read_bytes(), b"NO")
                self.assertEqual([path.name for path in queue_a.files], ["locked.azw3"])
            finally:
                server.shutdown()
                server.server_close()


if __name__ == "__main__":
    unittest.main()
