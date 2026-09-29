import base64
import json
import tempfile
import unittest
from pathlib import Path

from scripts.scan_public_dist import scan


def jwt(role: str) -> str:
    enc = lambda obj: base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
    return f"{enc({'alg': 'HS256', 'typ': 'JWT'})}.{enc({'role': role, 'iss': 'supabase'})}.c2lnbmF0dXJlLXZhbHVl"


class ScanTests(unittest.TestCase):
    def test_only_the_pinned_excelize_wasm_binary_is_accepted(self):
        import gzip
        from scripts.scan_public_dist import PINNED_WASM
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'assets').mkdir()
            (Path(tmp) / 'assets' / 'excelize.wasm-AbC123.gz').write_bytes(PINNED_WASM.read_bytes())
            self.assertEqual(scan(Path(tmp)), [])
        with tempfile.TemporaryDirectory() as tmp:  # same name, other bytes (a tampered or different build)
            (Path(tmp) / 'assets').mkdir()
            (Path(tmp) / 'assets' / 'excelize.wasm-AbC123.gz').write_bytes(gzip.compress(b'\0asm\x01\0\0\0'))
            self.assertTrue(any('not byte-identical' in f for f in scan(Path(tmp))))
        with tempfile.TemporaryDirectory() as tmp:  # any other binary archive is still refused
            (Path(tmp) / 'other.gz').write_bytes(gzip.compress(b'\0asm\x01\0\0\0\xff\xfe'))
            self.assertTrue(scan(Path(tmp)))

    def run_scan(self, name: str, text: str) -> list[str]:
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / name).write_text(text, encoding='utf-8')
            return scan(Path(tmp))

    def test_auth_sdk_identifier_is_allowed_in_scripts_only(self):
        self.assertEqual(self.run_scan('a.js', 'const g="refresh_token";'), [])
        self.assertTrue(self.run_scan('d.json', '{"refresh_token": "x"}'))
        self.assertTrue(self.run_scan('i.html', '<p>refresh_token</p>'))

    def test_non_anon_jwt_in_a_bundle_fails(self):
        self.assertEqual(self.run_scan('a.js', f'const k="{jwt("anon")}";'), [])
        self.assertTrue(self.run_scan('a.js', f'const k="{jwt("service_role")}";'))
        self.assertTrue(self.run_scan('a.js', f'const k="{jwt("authenticated")}";'))

    def test_map_never_references_relay_or_account_api(self):
        self.assertTrue(self.run_scan('a.js', 'fetch(base+"/community-auth-relay/claim")'))
        self.assertTrue(self.run_scan('a.js', 'fetch(base+"/community-account/grant")'))
        self.assertTrue(self.run_scan('a.js', 'location.href="https://safeauth.worklazy.net/"'))

    def test_secret_markers_still_fail_in_scripts(self):
        self.assertTrue(self.run_scan('a.js', 'const k="sb_secret_abcdef";'))


if __name__ == '__main__':
    unittest.main()
