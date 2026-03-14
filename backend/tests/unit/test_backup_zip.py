"""Unit tests for the BackupZip utility class."""
import io
import json
import zipfile

import pytest

from app.services.backup_zip import BackupZip


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_zip(entries):
    """Build a raw ZIP from a list of (path, content) pairs."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for path, content in entries:
            zf.writestr(path, content)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# BackupZip.write
# ---------------------------------------------------------------------------

class TestBackupZipWrite:
    def test_returns_bytesio_seeked_to_start(self):
        buf = BackupZip.write([('a.txt', 'hello')])
        assert isinstance(buf, io.BytesIO)
        assert buf.tell() == 0

    def test_archive_contains_all_entries(self):
        entries = [
            ('metadata.json', '{"v": 1}'),
            ('input/input.json', '{"criteria": []}'),
            ('sessions/s1.json', '{"name": "s1"}'),
        ]
        buf = BackupZip.write(entries)
        with zipfile.ZipFile(buf) as zf:
            assert set(zf.namelist()) == {p for p, _ in entries}

    def test_archive_content_matches(self):
        entries = [('data.json', '{"key": "value"}')]
        buf = BackupZip.write(entries)
        with zipfile.ZipFile(buf) as zf:
            assert zf.read('data.json').decode('utf-8') == '{"key": "value"}'

    def test_empty_entries_produces_valid_zip(self):
        buf = BackupZip.write([])
        with zipfile.ZipFile(buf) as zf:
            assert zf.namelist() == []


# ---------------------------------------------------------------------------
# BackupZip.read_json_entries
# ---------------------------------------------------------------------------

class TestReadJsonEntries:
    def test_reads_single_entry(self):
        raw = _make_zip([('meta.json', '{"x": 1}')])
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            (result,) = BackupZip.read_json_entries(zf, 'meta.json')
        assert result == {'x': 1}

    def test_reads_multiple_entries_in_order(self):
        raw = _make_zip([
            ('a.json', '{"a": 1}'),
            ('b.json', '{"b": 2}'),
        ])
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            a, b = BackupZip.read_json_entries(zf, 'a.json', 'b.json')
        assert a == {'a': 1}
        assert b == {'b': 2}

    def test_raises_key_error_for_missing_entry(self):
        raw = _make_zip([('exists.json', '{}')])
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            with pytest.raises(KeyError):
                BackupZip.read_json_entries(zf, 'missing.json')


# ---------------------------------------------------------------------------
# BackupZip.find_json_entries
# ---------------------------------------------------------------------------

class TestFindJsonEntries:
    def test_finds_matching_entries(self):
        raw = _make_zip([
            ('sessions/alice.json', '{"name": "alice"}'),
            ('sessions/bob.json', '{"name": "bob"}'),
            ('other/data.json', '{"name": "other"}'),
        ])
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            results = BackupZip.find_json_entries(zf, 'sessions/')
        names = {r['name'] for r in results}
        assert names == {'alice', 'bob'}

    def test_returns_empty_list_when_no_match(self):
        raw = _make_zip([('metadata.json', '{}')])
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            results = BackupZip.find_json_entries(zf, 'sessions/')
        assert results == []

    def test_custom_suffix_filtering(self):
        raw = _make_zip([
            ('sessions/alice.json', '{"name": "alice"}'),
            ('sessions/LOCK', '{}'),
        ])
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            results = BackupZip.find_json_entries(zf, 'sessions/', suffix='.json')
        assert len(results) == 1
        assert results[0]['name'] == 'alice'


# ---------------------------------------------------------------------------
# BackupZip.read  (high-level)
# ---------------------------------------------------------------------------

class TestBackupZipRead:
    def _make_backup_zip(self, metadata=None, input_payload=None, sessions=None):
        metadata = metadata or {'version': 1, 'study': {'code': 'TEST'}}
        input_payload = input_payload or {'criteria': []}
        sessions = sessions or [{'name': 's1'}]
        entries = [
            ('metadata.json', json.dumps(metadata)),
            ('input/input.json', json.dumps(input_payload)),
        ] + [
            (f'sessions/{s["name"]}.json', json.dumps(s))
            for s in sessions
        ]
        return _make_zip(entries)

    def test_returns_metadata_input_sessions(self):
        raw = self._make_backup_zip()
        meta, inp, sessions = BackupZip.read(raw)
        assert meta['version'] == 1
        assert inp == {'criteria': []}
        assert len(sessions) == 1
        assert sessions[0]['name'] == 's1'

    def test_multiple_sessions_returned(self):
        raw = self._make_backup_zip(
            sessions=[{'name': 'alice'}, {'name': 'bob'}]
        )
        _, _, sessions = BackupZip.read(raw)
        assert {s['name'] for s in sessions} == {'alice', 'bob'}

    def test_raises_key_error_when_metadata_missing(self):
        raw = _make_zip([('input/input.json', '{}')])
        with pytest.raises(KeyError):
            BackupZip.read(raw)

    def test_raises_bad_zip_for_invalid_bytes(self):
        with pytest.raises(zipfile.BadZipFile):
            BackupZip.read(b'not a zip file')

    def test_raises_json_decode_error_for_bad_json(self):
        raw = _make_zip([
            ('metadata.json', 'NOT JSON'),
            ('input/input.json', '{}'),
        ])
        with pytest.raises(json.JSONDecodeError):
            BackupZip.read(raw)

    def test_no_sessions_returns_empty_list(self):
        raw = _make_zip([
            ('metadata.json', '{}'),
            ('input/input.json', '{}'),
        ])
        _, _, sessions = BackupZip.read(raw)
        assert sessions == []
