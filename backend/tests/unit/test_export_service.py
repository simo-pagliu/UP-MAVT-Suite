"""Unit tests for ExportService — pure CSV/JSON builder methods (no DB needed)."""
import csv
import io
import json
import zipfile

import pytest

from app.services.export_service import ExportService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def read_csv(text):
    """Parse CSV text into a list of dicts (first row = header)."""
    reader = csv.DictReader(io.StringIO(text))
    return list(reader)


CRITERIA_QUANTITATIVE = [
    {
        'criterion_name': 'Cost',
        'unit': 'EUR',
        'alternatives': [
            {'name': 'A', 'value': '100'},
            {'name': 'B', 'value': '200'},
        ],
    }
]

CRITERIA_QUALITATIVE = [
    {
        'criterion_name': 'Quality',
        'unit': '',
        'is_qualitative': True,
        'alternatives': [
            {'name': 'A', 'value': ''},
            {'name': 'B', 'value': ''},
        ],
    }
]

QUALITATIVE_INDICATORS = {
    'Quality': {
        'ranking': {'A': 1, 'B': 2},
        'values': {1: 0.8, 2: 0.3},
        'confidences': {'1': 3, '2': 4},
        'isIncreasing': True,
    }
}


# ---------------------------------------------------------------------------
# build_input_raw_csv
# ---------------------------------------------------------------------------

class TestBuildInputRawCsv:
    def test_header_row(self):
        csv_text = ExportService.build_input_raw_csv(CRITERIA_QUANTITATIVE)
        rows = read_csv(csv_text)
        assert 'Criterion' in rows[0]
        assert 'Alternative' in rows[0]
        assert 'Value' in rows[0]

    def test_data_rows(self):
        csv_text = ExportService.build_input_raw_csv(CRITERIA_QUANTITATIVE)
        rows = read_csv(csv_text)
        assert len(rows) == 2
        assert rows[0]['Alternative'] == 'A'
        assert rows[0]['Value'] == '100'
        assert rows[1]['Alternative'] == 'B'
        assert rows[1]['Value'] == '200'

    def test_empty_criteria_returns_header_only(self):
        csv_text = ExportService.build_input_raw_csv([])
        rows = read_csv(csv_text)
        assert rows == []

    def test_skips_non_dict_criteria(self):
        csv_text = ExportService.build_input_raw_csv(['not_a_dict'])
        rows = read_csv(csv_text)
        assert rows == []


# ---------------------------------------------------------------------------
# build_alternatives_csv
# ---------------------------------------------------------------------------

class TestBuildAlternativesCsv:
    def test_quantitative_uses_original_value(self):
        csv_text = ExportService.build_alternatives_csv(CRITERIA_QUANTITATIVE, {})
        rows = read_csv(csv_text)
        assert rows[0]['Value'] == '100.0'

    def test_qualitative_uses_x_position(self):
        csv_text = ExportService.build_alternatives_csv(CRITERIA_QUALITATIVE, QUALITATIVE_INDICATORS)
        rows = read_csv(csv_text)
        # A has rank=1 (best) so x > 0; B has rank=2 (worst) so x < A's
        values = [float(r['Value']) for r in rows]
        assert values[0] > values[1]

    def test_rounds_to_3_decimal_places(self):
        csv_text = ExportService.build_alternatives_csv(CRITERIA_QUANTITATIVE, {})
        rows = read_csv(csv_text)
        # 100.0 → should be a valid float
        assert float(rows[0]['Value']) == 100.0


# ---------------------------------------------------------------------------
# build_qualitative_csv
# ---------------------------------------------------------------------------

class TestBuildQualitativeCsv:
    def test_header_row(self):
        csv_text = ExportService.build_qualitative_csv(CRITERIA_QUALITATIVE, QUALITATIVE_INDICATORS)
        rows = read_csv(csv_text)
        assert 'CRITERION_NAME' in rows[0]
        assert 'RANK' in rows[0]
        assert 'CONFIDENCE' in rows[0]

    def test_data_rows(self):
        csv_text = ExportService.build_qualitative_csv(CRITERIA_QUALITATIVE, QUALITATIVE_INDICATORS)
        rows = read_csv(csv_text)
        assert len(rows) == 2
        names = {r['ALTERNATIVE'] for r in rows}
        assert names == {'A', 'B'}

    def test_skips_non_qualitative_criteria(self):
        csv_text = ExportService.build_qualitative_csv(CRITERIA_QUANTITATIVE, {})
        rows = read_csv(csv_text)
        assert rows == []


# ---------------------------------------------------------------------------
# build_pile_bwt_csv
# ---------------------------------------------------------------------------

class TestBuildPileBwtCsv:
    BWT_DATA = {
        'comparisons': [
            {
                'reference_criterion': 'Cost',
                'adjusted_criterion': 'Time',
                'data_value': 1.5,
                'type': 'ratio',
                'group': 'G1',
            }
        ]
    }

    def test_header_and_data(self):
        csv_text = ExportService.build_pile_bwt_csv(self.BWT_DATA)
        rows = read_csv(csv_text)
        assert rows[0]['REFERENCE_CRITERION'] == 'Cost'
        assert rows[0]['DATA_VALUE'] == '1.5'

    def test_rounds_data_value(self):
        bwt = {
            'comparisons': [
                {
                    'reference_criterion': 'X',
                    'adjusted_criterion': 'Y',
                    'data_value': 1.23456789,
                    'type': 'r',
                    'group': '',
                }
            ]
        }
        csv_text = ExportService.build_pile_bwt_csv(bwt)
        rows = read_csv(csv_text)
        assert rows[0]['DATA_VALUE'] == '1.235'

    def test_non_dict_bwt_falls_back(self):
        csv_text = ExportService.build_pile_bwt_csv('raw_value')
        rows = read_csv(csv_text)
        assert rows[0]['VALUE'] == 'raw_value'


class TestBuildPileBwtRevisionCsv:
    def test_decreasing_vf_clamps_to_endpoint_y_by_x_bounds(self):
        criteria_list = [
            {
                'criterion_name': 'Cost',
                'is_qualitative': False,
            }
        ]
        value_functions_data = {
            'criteria': {
                'Cost': {
                    'points': [
                        {'x': 100, 'y': 1.0},
                        {'x': 200, 'y': 0.0},
                    ]
                }
            }
        }
        bwt_data = {
            'comparisons': [
                {
                    'reference_criterion': 'R',
                    'adjusted_criterion': 'Cost',
                    'data_value': 90,  # below min x -> should clamp to y at x=100 (1.0)
                    'type': 'ratio',
                    'group': 'G1',
                },
                {
                    'reference_criterion': 'R',
                    'adjusted_criterion': 'Cost',
                    'data_value': 210,  # above max x -> should clamp to y at x=200 (0.0)
                    'type': 'ratio',
                    'group': 'G1',
                },
            ]
        }

        csv_text = ExportService.build_pile_bwt_revision_csv(
            bwt_data, value_functions_data, criteria_list
        )
        rows = read_csv(csv_text)

        assert rows[0]['a_value'] == '1.0'
        assert rows[1]['a_value'] == ''


# ---------------------------------------------------------------------------
# _serialize_points
# ---------------------------------------------------------------------------

class TestSerializePoints:
    def test_basic_serialization(self):
        points = [{'x': 0, 'y': 0}, {'x': 0.5, 'y': 0.5}, {'x': 1, 'y': 1}]
        result = ExportService._serialize_points(points)
        assert result == '0.0:0.0;0.5:0.5;1.0:1.0'

    def test_rounds_to_3_decimals(self):
        points = [{'x': 0.1234, 'y': 0.9876}]
        result = ExportService._serialize_points(points)
        assert result == '0.123:0.988'

    def test_skips_missing_xy(self):
        points = [{'x': 0}, {'y': 1}, {'x': 1, 'y': 1}]
        result = ExportService._serialize_points(points)
        assert result == '1.0:1.0'

    def test_empty_list(self):
        assert ExportService._serialize_points([]) == ''

    def test_non_list_returns_empty(self):
        assert ExportService._serialize_points(None) == ''


# ---------------------------------------------------------------------------
# get_qualitative_alt_value
# ---------------------------------------------------------------------------

class TestGetQualitativeAltValue:
    def test_returns_value_for_known_alt(self):
        val = ExportService.get_qualitative_alt_value(QUALITATIVE_INDICATORS, 'Quality', 'A')
        assert val == 0.8

    def test_returns_empty_string_for_unknown_alt(self):
        val = ExportService.get_qualitative_alt_value(QUALITATIVE_INDICATORS, 'Quality', 'Z')
        assert val == ''

    def test_returns_empty_for_unknown_criterion(self):
        val = ExportService.get_qualitative_alt_value(QUALITATIVE_INDICATORS, 'Unknown', 'A')
        assert val == ''

    def test_returns_empty_for_non_dict_input(self):
        assert ExportService.get_qualitative_alt_value(None, 'Q', 'A') == ''


# ---------------------------------------------------------------------------
# get_qualitative_x_value
# ---------------------------------------------------------------------------

class TestGetQualitativeXValue:
    def test_returns_float_in_0_1(self):
        val = ExportService.get_qualitative_x_value(QUALITATIVE_INDICATORS, 'Quality', 'A')
        assert 0.0 < float(val) < 1.0

    def test_better_rank_has_higher_x(self):
        # rank 1 = best (A), rank 2 = worst (B) → A should have higher x (closer to 1)
        x_a = ExportService.get_qualitative_x_value(QUALITATIVE_INDICATORS, 'Quality', 'A')
        x_b = ExportService.get_qualitative_x_value(QUALITATIVE_INDICATORS, 'Quality', 'B')
        assert float(x_a) > float(x_b)

    def test_returns_empty_for_unknown_alt(self):
        val = ExportService.get_qualitative_x_value(QUALITATIVE_INDICATORS, 'Quality', 'Z')
        assert val == ''


# ---------------------------------------------------------------------------
# generate_qualitative_value_function
# ---------------------------------------------------------------------------

class TestGenerateQualitativeValueFunction:
    def test_returns_list_of_points(self):
        points = ExportService.generate_qualitative_value_function(QUALITATIVE_INDICATORS, 'Quality')
        assert isinstance(points, list)
        assert len(points) > 0

    def test_first_point_x_is_0(self):
        points = ExportService.generate_qualitative_value_function(QUALITATIVE_INDICATORS, 'Quality')
        assert points[0]['x'] == 0

    def test_last_point_x_is_1(self):
        points = ExportService.generate_qualitative_value_function(QUALITATIVE_INDICATORS, 'Quality')
        assert points[-1]['x'] == 1

    def test_increasing_function_starts_at_0(self):
        points = ExportService.generate_qualitative_value_function(QUALITATIVE_INDICATORS, 'Quality')
        assert points[0]['y'] == 0  # increasing → y=0 at x=0

    def test_decreasing_function_starts_at_1(self):
        qi_dec = {
            'Quality': {
                'ranking': {'A': 1, 'B': 2},
                'values': {1: 0.2, 2: 0.8},
                'isIncreasing': False,
            }
        }
        points = ExportService.generate_qualitative_value_function(qi_dec, 'Quality')
        assert points[0]['y'] == 1

    def test_returns_empty_for_missing_data(self):
        assert ExportService.generate_qualitative_value_function({}, 'Missing') == []


# ---------------------------------------------------------------------------
# build_value_functions_csv
# ---------------------------------------------------------------------------

class TestBuildValueFunctionsCsv:
    VF_CRITERIA_MAP = {
        'Cost': {
            'points': [{'x': 0, 'y': 0}, {'x': 1, 'y': 1}],
            'confidence': 3,
        }
    }

    def test_header_row(self):
        csv_text = ExportService.build_value_functions_csv(
            CRITERIA_QUANTITATIVE, self.VF_CRITERIA_MAP
        )
        rows = read_csv(csv_text)
        assert 'CRITERION_NAME' in rows[0]
        assert 'CONFIDENCE' in rows[0]
        assert 'LIST OF POINTS' in rows[0]

    def test_data_row_has_serialized_points(self):
        csv_text = ExportService.build_value_functions_csv(
            CRITERIA_QUANTITATIVE, self.VF_CRITERIA_MAP
        )
        rows = read_csv(csv_text)
        assert '0.0:0.0' in rows[0]['LIST OF POINTS']

    def test_qualitative_criterion_generates_points(self):
        csv_text = ExportService.build_value_functions_csv(
            CRITERIA_QUALITATIVE, {}, QUALITATIVE_INDICATORS
        )
        rows = read_csv(csv_text)
        assert rows[0]['CRITERION_NAME'] == 'Quality'
        assert rows[0]['LIST OF POINTS'] != ''

    def test_fallback_to_criteria_map_when_no_criteria(self):
        csv_text = ExportService.build_value_functions_csv([], self.VF_CRITERIA_MAP)
        rows = read_csv(csv_text)
        assert rows[0]['CRITERION_NAME'] == 'Cost'


# ---------------------------------------------------------------------------
# ExportService methods that require DB (via fixtures from conftest)
# ---------------------------------------------------------------------------

class TestExportServiceWithDb:
    @pytest.fixture()
    def es(self, mock_db):
        return ExportService(mock_db)

    @pytest.fixture()
    def session_id(self, mock_db):
        """Insert a session document directly into the mock DB."""
        from datetime import datetime, timezone
        from bson.objectid import ObjectId
        doc = {
            'name': 'TEST',
            'criteria': CRITERIA_QUANTITATIVE,
            'qualitative_indicators': None,
            'value_functions': None,
            'bwt': None,
            'locked': False,
            'session_locked': False,
            'created_at': datetime.now(timezone.utc),
        }
        result = mock_db.sessions.insert_one(doc)
        return str(result.inserted_id)

    def test_export_input_raw_csv_ok(self, es, session_id):
        content, filename, mime = es.export_input_raw_csv(session_id)
        assert mime == 'text/csv'
        assert 'input_raw_' in filename
        rows = read_csv(content.decode())
        assert rows[0]['Criterion'] == 'Cost'

    def test_export_input_raw_csv_empty_criteria_raises(self, es, mock_db):
        from datetime import datetime, timezone
        doc = {
            'name': 'EMPTY',
            'criteria': [],
            'qualitative_indicators': None,
            'value_functions': None,
            'bwt': None,
            'locked': False,
            'session_locked': False,
            'created_at': datetime.now(timezone.utc),
        }
        oid = mock_db.sessions.insert_one(doc).inserted_id
        from app.exceptions import NotFoundError
        with pytest.raises(NotFoundError):
            es.export_input_raw_csv(str(oid))

    def test_export_summary_csv_ok(self, es, session_id):
        content, filename, mime = es.export_summary_csv(session_id)
        text = content.decode()
        assert 'Completed Sections' in text
        assert '0/3' in text

    def test_export_not_found_raises(self, es, mock_db):
        from bson.objectid import ObjectId
        from app.exceptions import NotFoundError
        with pytest.raises(NotFoundError):
            es.export_input_raw_csv(str(ObjectId()))

    def test_export_pile_csv_raises_when_no_bwt(self, es, session_id):
        from app.exceptions import NotFoundError
        with pytest.raises(NotFoundError, match='No PILE-BWT'):
            es.export_pile_csv(session_id)

    def test_export_bwt_csv_ok(self, es, mock_db):
        from datetime import datetime, timezone
        doc = {
            'name': 'BWT_SESSION',
            'criteria': CRITERIA_QUANTITATIVE,
            'bwt': {
                'comparisons': [
                    {
                        'reference_criterion': 'Cost',
                        'adjusted_criterion': 'Time',
                        'data_value': 2.0,
                        'type': 'ratio',
                    }
                ]
            },
            'locked': False,
            'session_locked': False,
            'created_at': datetime.now(timezone.utc),
        }
        oid = mock_db.sessions.insert_one(doc).inserted_id
        content, filename, mime = es.export_bwt_csv(str(oid))
        rows = read_csv(content.decode())
        assert rows[0]['REFERENCE_CRITERION'] == 'Cost'

    def test_export_pile_json_ok(self, es, mock_db):
        from datetime import datetime, timezone
        doc = {
            'name': 'PILE_SESSION',
            'criteria': CRITERIA_QUANTITATIVE,
            'bwt': {'comparisons': []},
            'locked': False,
            'session_locked': False,
            'created_at': datetime.now(timezone.utc),
        }
        oid = mock_db.sessions.insert_one(doc).inserted_id
        content, filename, mime = es.export_pile_json(str(oid))
        payload = json.loads(content.decode())
        assert 'pile_bwt' in payload
        assert mime == 'application/json'

    def test_export_all_outputs_zip(self, es, mock_db):
        from datetime import datetime, timezone
        # Session with complete data
        qi = {
            'Quality': {
                'ranking': {'A': 1, 'B': 2},
                'values': {1: 0.8, 2: 0.3},
                'confidences': {'1': 3, '2': 4},
            }
        }
        criteria = [
            {
                'criterion_name': 'Cost',
                'unit': 'EUR',
                'alternatives': [{'name': 'A', 'value': '100'}, {'name': 'B', 'value': '200'}],
            }
        ]
        doc = {
            'name': 'FULL',
            'criteria': criteria,
            'qualitative_indicators': None,
            'value_functions': {
                'criteria': {
                    'Cost': {
                        'points': [{'x': 0, 'y': 0}, {'x': 1, 'y': 1}],
                        'confidence': 4,
                    }
                }
            },
            'bwt': {'comparisons': []},
            'locked': False,
            'session_locked': False,
            'created_at': datetime.now(timezone.utc),
        }
        oid = mock_db.sessions.insert_one(doc).inserted_id
        buf, filename, mime = es.export_all_outputs_zip(str(oid))
        assert mime == 'application/zip'
        with zipfile.ZipFile(buf) as zf:
            names = zf.namelist()
        assert any('alternatives' in n for n in names)
        assert any('value_functions' in n for n in names)
        assert any('pile_bwt' in n for n in names)
