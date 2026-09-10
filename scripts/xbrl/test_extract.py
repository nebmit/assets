import copy
import tempfile
import unittest
from pathlib import Path
from extract import extract

FIXTURES = Path(__file__).resolve().parents[2] / 'tests/fixtures/sec/xbrl'

class ExtractionTests(unittest.TestCase):
    def request(self, root):
        for name in ['test.xsd', 'report.xhtml']:
            (root / name).write_bytes((FIXTURES / name).read_bytes())
        return {'root': str(root), 'entrypoints': ['https://example.com/report.xhtml'], 'urls': {
            'https://example.com/report.xhtml': 'report.xhtml', 'https://example.com/test.xsd': 'test.xsd'}}

    def test_values_nil_continuations_and_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            request = self.request(Path(directory))
            first = extract(request)
            values = {f['id'].split('#')[-1]: f for f in first['facts']}
            self.assertEqual(values['amount']['value'], '-1234000')
            self.assertEqual(values['amount']['decimals'], '-3')
            self.assertTrue(values['nil']['nil'])
            self.assertIsNone(values['nil']['value'])
            self.assertEqual(values['description']['value'], 'first second')
            self.assertEqual(first, extract(request))
            self.assertEqual(first['contexts'][0]['end'], '2025-12-31')
            self.assertTrue(first['contexts'][0]['valid'])

    def test_missing_dependencies_fail_offline(self):
        with tempfile.TemporaryDirectory() as directory:
            request = self.request(Path(directory))
            del request['urls']['https://example.com/test.xsd']
            with self.assertRaisesRegex(ValueError, 'missing_dependency'):
                extract(request)

    def test_malformed_document_does_not_produce_qualified_facts(self):
        with tempfile.TemporaryDirectory() as directory:
            request = self.request(Path(directory))
            (Path(directory) / 'report.xhtml').write_text('<html><broken>')
            with self.assertRaises(ValueError):
                extract(request)
