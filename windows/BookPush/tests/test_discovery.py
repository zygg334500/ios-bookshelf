import unittest

from bookpush.discovery import choose_host, device_from_record, display_name, manual_hint


class DiscoveryTests(unittest.TestCase):
    def test_prefers_private_ipv4_over_public_and_link_local(self) -> None:
        host = choose_host(["8.8.8.8", "169.254.1.8", "fe80::1", "192.168.1.23", "2001:db8::1"])
        self.assertEqual(host, "192.168.1.23")

    def test_keeps_a_routable_ipv6_when_that_is_all_bonjour_offered(self) -> None:
        self.assertEqual(choose_host(["fe80::1", "2001:db8::9"]), "2001:db8::9")
        self.assertIsNone(choose_host(["169.254.4.4", "fe80::2"]))

    def test_label_comes_from_txt_display_name(self) -> None:
        device = device_from_record(
            "BookShelf-ab12._bookshelf._tcp.local.",
            27780,
            ["10.0.0.8"],
            {b"name": "书房".encode(), b"pinRequired": b"1"},
        )
        self.assertIsNotNone(device)
        assert device is not None
        self.assertEqual(device.name, "书房")
        self.assertEqual(device.host, "10.0.0.8")
        self.assertEqual(device.port, 27780)
        self.assertEqual(display_name("BookShelf-ab12._bookshelf._tcp.local.", {}), "BookShelf-ab12")

    def test_ignores_the_local_network_permission_probe(self) -> None:
        probe = device_from_record(
            "rnzeroconf-ab12cd34._bookshelf._tcp.local.",
            9,
            ["192.168.1.20"],
            {},
        )
        self.assertIsNone(probe)
        real = device_from_record(
            "BookShelf-ab12._bookshelf._tcp.local.",
            27780,
            ["192.168.1.20"],
            {b"path": b"/v1/books", b"name": "书房".encode()},
        )
        self.assertIsNotNone(real)

    def test_zero_results_point_at_the_manual_path(self) -> None:
        text = manual_hint()
        self.assertIn("0 台", text)
        self.assertIn("本地网络", text)
        self.assertIn("5353", text)
        self.assertIn("27780", text)
        self.assertIn("配对码", text)
        self.assertNotIn("破解", text)


if __name__ == "__main__":
    unittest.main()
