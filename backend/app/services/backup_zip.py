"""Utility class for reading and writing backup ZIP archives.

Centralises all zipfile I/O so that the backup structure is defined
in one place and can be reused by both export and import operations.
"""

import io
import json
import zipfile


class BackupZip:
    """Utility for creating and parsing backup ZIP archives.

    The backup format used throughout the application is:
    - ``metadata.json``        – top-level study metadata
    - ``input/input.json``     – shared input criteria
    - ``sessions/<name>.json`` – one file per elicitation session
    - ``csv/<name>/…``         – optional CSV exports per session

    All JSON content is stored UTF-8 encoded.
    """

    @staticmethod
    def write(entries):
        """Create a ZIP archive from an iterable of (path, content) pairs.

        Args:
            entries: Iterable of ``(archive_path, content)`` tuples.
                     *content* may be a ``str`` or ``bytes``.

        Returns:
            :class:`io.BytesIO` positioned at the beginning of the archive.
        """
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            for path, content in entries:
                zf.writestr(path, content)
        buf.seek(0)
        return buf

    @staticmethod
    def read_json_entries(zf, *paths):
        """Read and parse specific JSON files from an open :class:`zipfile.ZipFile`.

        Args:
            zf: An open :class:`zipfile.ZipFile` object.
            *paths: File paths within the archive to read and parse as JSON.

        Returns:
            Tuple of parsed JSON objects in the same order as *paths*.
        """
        return tuple(
            json.loads(zf.read(path).decode('utf-8'))
            for path in paths
        )

    @staticmethod
    def find_json_entries(zf, prefix, suffix='.json'):
        """Find and read all JSON files in the archive matching a pattern.

        Args:
            zf: An open :class:`zipfile.ZipFile` object.
            prefix: Path prefix to match (e.g. ``'sessions/'``).
            suffix: Path suffix to match (default: ``'.json'``).

        Returns:
            List of parsed JSON objects for all matching paths.
        """
        matched = [
            name for name in zf.namelist()
            if name.startswith(prefix) and name.endswith(suffix)
        ]
        return [json.loads(zf.read(path).decode('utf-8')) for path in matched]

    @staticmethod
    def read(zip_bytes):
        """Parse a backup ZIP archive and return its contents.

        Opens the archive, reads the required JSON files, and discovers all
        session JSON files.  Low-level I/O exceptions (``KeyError``,
        ``BadZipFile``, ``json.JSONDecodeError``, ``UnicodeDecodeError``) are
        **not** caught here – callers should handle them as appropriate.

        Args:
            zip_bytes: Raw ZIP data as :class:`bytes` or a :class:`bytes`-like
                       object.

        Returns:
            A three-tuple ``(metadata, input_payload, session_payloads)``
            where *metadata* and *input_payload* are parsed JSON objects and
            *session_payloads* is a list of parsed JSON objects (one per
            ``sessions/*.json`` entry).
        """
        with zipfile.ZipFile(io.BytesIO(zip_bytes), 'r') as zf:
            metadata, input_payload = BackupZip.read_json_entries(
                zf, 'metadata.json', 'input/input.json'
            )
            session_payloads = BackupZip.find_json_entries(zf, 'sessions/')
        return metadata, input_payload, session_payloads
