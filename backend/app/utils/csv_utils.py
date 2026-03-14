"""CSV utility helpers."""

import csv
import io


class CsvUtils:
    """Utility class for building CSV content."""

    @staticmethod
    def build_csv(headers, rows):
        """Build a CSV string from a header row and an iterable of data rows.

        Args:
            headers (list): Column header names for the first row.
            rows (iterable): An iterable of sequences, one per data row.

        Returns:
            str: The CSV text (UTF-8).
        """
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        for row in rows:
            writer.writerow(row)
        return output.getvalue()
