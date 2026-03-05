"""Export service: builds CSV and JSON payloads for session data."""

import csv
import io
import json
import zipfile

from app.repositories import SessionRepository, InputRepository
from app.services.session_service import SessionService
from app.exceptions import NotFoundError, ValidationError


class ExportService:
    """Service that builds file exports (CSV, JSON, ZIP) from session data."""

    def __init__(self, db):
        """Initialise the service with a database handle.

        Args:
            db: A PyMongo (or mongomock) database object.
        """
        self._sessions = SessionRepository(db)
        self._inputs = InputRepository(db)
        self._session_svc = SessionService(db)

    # ------------------------------------------------------------------ #
    # Qualitative helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def get_qualitative_alt_value(qualitative_indicators, criterion_name, alt_name):
        """Look up the stored qualitative value for an alternative's rank.

        Resolves the rank from *ranking* and then looks up the corresponding
        entry in *values*, trying integer, string, and coerced-integer keys.

        Args:
            qualitative_indicators (dict): The session's qualitative indicator
                data keyed by criterion name.
            criterion_name (str | None): The criterion to query.
            alt_name (str | None): The alternative name whose value is needed.

        Returns:
            Any: The stored value (often a float between 0 and 1), or ``''``
            when the data is missing or cannot be resolved.
        """
        if not isinstance(qualitative_indicators, dict):
            return ''
        data = qualitative_indicators.get(criterion_name) if criterion_name else None
        if not isinstance(data, dict):
            return ''
        ranking = data.get('ranking')
        values = data.get('values')
        if not isinstance(ranking, dict) or not isinstance(values, dict):
            return ''
        rank = ranking.get(alt_name)
        if rank is None:
            return ''
        if rank in values:
            return values.get(rank)
        rank_str = str(rank)
        if rank_str in values:
            return values.get(rank_str)
        try:
            rank_int = int(rank)
        except (TypeError, ValueError):
            return ''
        return values.get(rank_int, values.get(str(rank_int), ''))

    @staticmethod
    def get_qualitative_x_value(qualitative_indicators, criterion_name, alt_name):
        """Compute the normalised X position (0–1) for an alternative in a qualitative criterion.

        The X value represents the alternative's relative position in the
        ranking.  The best rank maps to the highest X value (closest to 1) and
        the worst rank maps to the lowest non-zero X value.

        Args:
            qualitative_indicators (dict): The session's qualitative indicator
                data keyed by criterion name.
            criterion_name (str | None): The criterion to query.
            alt_name (str | None): The alternative name to position.

        Returns:
            float | str: A float in (0, 1), or ``''`` when the data is missing
            or the alternative is not ranked.
        """
        if not isinstance(qualitative_indicators, dict):
            return ''
        data = qualitative_indicators.get(criterion_name) if criterion_name else None
        if not isinstance(data, dict):
            return ''
        ranking = data.get('ranking')
        if not isinstance(ranking, dict):
            return ''
        rank = ranking.get(alt_name)
        if rank is None:
            return ''
        unique_ranks = sorted(set(ranking.values()))
        if not unique_ranks:
            return ''
        total_points = len(unique_ranks) + 2
        rank_list = list(reversed(unique_ranks))
        if rank not in rank_list:
            return ''
        idx = rank_list.index(rank)
        return (idx + 1) / (total_points - 1)

    @staticmethod
    def generate_qualitative_value_function(qualitative_indicators, criterion_name):
        """Build a piecewise-linear value function from qualitative ranking data.

        The function spans from (0, 0) to (1, 1) for increasing criteria or
        from (0, 1) to (1, 0) for decreasing criteria.  Intermediate points
        are placed at evenly-spaced X positions corresponding to each unique
        rank, with Y values taken from the stored ``values`` dict.

        Args:
            qualitative_indicators (dict): The session's qualitative indicator
                data keyed by criterion name.
            criterion_name (str | None): The criterion for which to generate
                the function.

        Returns:
            list[dict]: A list of ``{'x': float, 'y': float}`` point dicts, or
            an empty list when the required data is absent.
        """
        if not isinstance(qualitative_indicators, dict):
            return []
        data = qualitative_indicators.get(criterion_name) if criterion_name else None
        if not isinstance(data, dict):
            return []
        ranking = data.get('ranking')
        values = data.get('values')
        is_increasing = data.get('isIncreasing', True)
        if not isinstance(ranking, dict) or not isinstance(values, dict):
            return []
        unique_ranks = sorted(set(ranking.values()))
        if not unique_ranks:
            return []
        total_points = len(unique_ranks) + 2
        points = [{'x': 0, 'y': 0 if is_increasing else 1}]
        for idx, rank in enumerate(reversed(unique_ranks)):
            x_normalized = (idx + 1) / (total_points - 1)
            y_value = values.get(rank, values.get(str(rank), x_normalized))
            points.append({'x': x_normalized, 'y': y_value})
        points.append({'x': 1, 'y': 1 if is_increasing else 0})
        return points

    # ------------------------------------------------------------------ #
    # CSV builders
    # ------------------------------------------------------------------ #

    @classmethod
    def build_input_raw_csv(cls, criteria):
        """Build a raw-input CSV listing every alternative's stored value.

        Columns: ``Criterion``, ``Unit``, ``Alternative``, ``Value``.

        Args:
            criteria (list[dict]): The session's criteria list.

        Returns:
            str: The CSV text (UTF-8).
        """
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Criterion', 'Unit', 'Alternative', 'Value'])
        for criterion in criteria:
            if not isinstance(criterion, dict):
                continue
            criterion_name = criterion.get('criterion_name', '')
            unit = criterion.get('unit', '')
            for alt in criterion.get('alternatives', []):
                if not isinstance(alt, dict):
                    continue
                writer.writerow([criterion_name, unit, alt.get('name', ''), alt.get('value', '')])
        return output.getvalue()

    @classmethod
    def build_alternatives_csv(cls, criteria, qualitative_indicators):
        """Build an alternatives CSV using normalised X values for qualitative criteria.

        Quantitative alternative values are used as-is (rounded to 3 decimal
        places).  For qualitative criteria the normalised X position is used
        instead.

        Columns: ``Criterion``, ``Unit``, ``Alternative``, ``Value``.

        Args:
            criteria (list[dict]): The session's criteria list.
            qualitative_indicators (dict): The session's qualitative indicators.

        Returns:
            str: The CSV text (UTF-8).
        """
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Criterion', 'Unit', 'Alternative', 'Value'])
        for criterion in criteria:
            if not isinstance(criterion, dict):
                continue
            criterion_name = criterion.get('criterion_name', '')
            unit = criterion.get('unit', '')
            for alt in criterion.get('alternatives', []):
                if not isinstance(alt, dict):
                    continue
                if criterion.get('is_qualitative'):
                    alt_value = cls.get_qualitative_x_value(qualitative_indicators, criterion_name, alt.get('name'))
                else:
                    alt_value = alt.get('value', '')
                if alt_value != '' and alt_value is not None:
                    try:
                        alt_value = round(float(alt_value), 3)
                    except (TypeError, ValueError):
                        pass
                writer.writerow([criterion_name, unit, alt.get('name', ''), alt_value])
        return output.getvalue()

    @classmethod
    def build_qualitative_csv(cls, criteria, qualitative_indicators):
        """Build a CSV of qualitative rankings, values, and confidences.

        Only qualitative criteria are included.  Non-qualitative criteria are
        silently skipped.

        Columns: ``CRITERION_NAME``, ``ALTERNATIVE``, ``RANK``, ``VALUE``,
        ``CONFIDENCE``.

        Args:
            criteria (list[dict]): The session's criteria list.
            qualitative_indicators (dict): The session's qualitative indicators.

        Returns:
            str: The CSV text (UTF-8).
        """
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['CRITERION_NAME', 'ALTERNATIVE', 'RANK', 'VALUE', 'CONFIDENCE'])
        for criterion in criteria:
            if not isinstance(criterion, dict) or not criterion.get('is_qualitative'):
                continue
            name = criterion.get('criterion_name', '')
            data = qualitative_indicators.get(name, {}) if name else {}
            ranking = data.get('ranking') if isinstance(data, dict) else None
            confidences = data.get('confidences', {}) if isinstance(data, dict) else {}
            if not isinstance(ranking, dict):
                continue
            for alt in criterion.get('alternatives', []):
                if not isinstance(alt, dict):
                    continue
                alt_name = alt.get('name')
                if not alt_name:
                    continue
                rank = ranking.get(alt_name)
                value = cls.get_qualitative_alt_value(qualitative_indicators, name, alt_name)
                confidence = 4
                if rank is not None and isinstance(confidences, dict):
                    confidence = confidences.get(rank, confidences.get(str(rank), 4))
                writer.writerow([name, alt_name, rank if rank is not None else '', value, confidence])
        return output.getvalue()

    @classmethod
    def build_value_functions_csv(cls, criteria, criteria_map, qualitative_indicators=None):
        """Build a value functions CSV with serialised point lists.

        For qualitative criteria the value function is generated automatically
        from ranking/values data; for quantitative criteria it is read from
        *criteria_map*.  When *criteria* is empty the method falls back to
        iterating directly over *criteria_map*.

        Columns: ``CRITERION_NAME``, ``CONFIDENCE``, ``LIST OF POINTS`` (a
        semicolon-separated list of ``x:y`` pairs rounded to 3 decimal places).

        Args:
            criteria (list[dict]): The session's criteria list.
            criteria_map (dict): Mapping of criterion name → ``{'points': [...],
                'confidence': ...}`` from the session's ``value_functions``.
            qualitative_indicators (dict | None): The session's qualitative
                indicators (required to generate qualitative value functions).

        Returns:
            str: The CSV text (UTF-8).
        """
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['CRITERION_NAME', 'CONFIDENCE', 'LIST OF POINTS'])
        if isinstance(criteria, list) and len(criteria) > 0:
            for criterion in criteria:
                if not isinstance(criterion, dict):
                    continue
                name = criterion.get('criterion_name')
                if not name:
                    continue
                if criterion.get('is_qualitative'):
                    points = cls.generate_qualitative_value_function(qualitative_indicators, name)
                    qual_data = qualitative_indicators.get(name) if isinstance(qualitative_indicators, dict) else None
                    if isinstance(qual_data, dict) and 'confidences' in qual_data:
                        confidences_dict = qual_data.get('confidences', {})
                        ranks = []
                        values = qual_data.get('values') if isinstance(qual_data.get('values'), dict) else None
                        ranking_map = qual_data.get('ranking') if isinstance(qual_data.get('ranking'), dict) else None
                        if values:
                            try:
                                ranks = sorted([int(r) for r in values.keys()])
                            except (TypeError, ValueError):
                                ranks = []
                        if not ranks and ranking_map:
                            ranks = sorted({int(r) for r in ranking_map.values()})
                        confidence_values = [str(confidences_dict.get(r, confidences_dict.get(str(r), 4))) for r in ranks]
                        confidence = ','.join(confidence_values) if confidence_values else '4'
                    else:
                        ranks = []
                        values = qual_data.get('values') if isinstance(qual_data, dict) else None
                        ranking_map = qual_data.get('ranking') if isinstance(qual_data, dict) else None
                        if isinstance(values, dict):
                            try:
                                ranks = sorted([int(r) for r in values.keys()])
                            except (TypeError, ValueError):
                                ranks = []
                        if not ranks and isinstance(ranking_map, dict):
                            ranks = sorted({int(r) for r in ranking_map.values()})
                        confidence = ','.join(['4'] * len(ranks)) if ranks else '4'
                else:
                    cfg = criteria_map.get(name) if isinstance(criteria_map, dict) else None
                    points = cfg.get('points') if isinstance(cfg, dict) else []
                    confidence = cfg.get('confidence', 4) if isinstance(cfg, dict) else 4
                serialized = cls._serialize_points(points)
                writer.writerow([name, confidence, serialized])
        else:
            for name, cfg in criteria_map.items():
                points = cfg.get('points') if isinstance(cfg, dict) else []
                confidence = cfg.get('confidence', 4) if isinstance(cfg, dict) else 4
                writer.writerow([name, confidence, cls._serialize_points(points)])
        return output.getvalue()

    @staticmethod
    def _serialize_points(points):
        """Serialise a list of ``{'x', 'y'}`` dicts to a ``x:y;x:y`` string.

        Each coordinate is rounded to 3 decimal places.  Points with missing
        or non-numeric coordinates are skipped.

        Args:
            points (list[dict] | None): The list of point dicts.

        Returns:
            str: Semicolon-separated ``x:y`` pairs, or ``''`` when *points*
            is not a list.
        """
        if not isinstance(points, list):
            return ''
        parts = []
        for p in points:
            if not isinstance(p, dict):
                continue
            x, y = p.get('x'), p.get('y')
            if x is None or y is None:
                continue
            try:
                parts.append(f"{round(float(x), 3)}:{round(float(y), 3)}")
            except (TypeError, ValueError):
                continue
        return ';'.join(parts)

    @classmethod
    def build_pile_bwt_csv(cls, bwt_data):
        """Build a PILE-BWT comparison CSV.

        When *bwt_data* contains a ``comparisons`` list the output includes
        one row per comparison with columns ``REFERENCE_CRITERION``,
        ``ADJUSTED_CRITERION``, ``DATA_VALUE``, ``TYPE``, and ``GROUP``.
        Otherwise a single ``VALUE`` column is written with *bwt_data* as its
        only row.

        Args:
            bwt_data: The session's BWT data object.

        Returns:
            str: The CSV text (UTF-8).
        """
        output = io.StringIO()
        writer = csv.writer(output)
        if isinstance(bwt_data, dict) and isinstance(bwt_data.get('comparisons'), list):
            writer.writerow(['REFERENCE_CRITERION', 'ADJUSTED_CRITERION', 'DATA_VALUE', 'TYPE', 'GROUP'])
            for comp in bwt_data.get('comparisons', []):
                if not isinstance(comp, dict):
                    continue
                data_value = comp.get('data_value', '')
                if data_value != '' and data_value is not None:
                    try:
                        data_value = round(float(data_value), 3)
                    except (TypeError, ValueError):
                        pass
                writer.writerow([
                    comp.get('reference_criterion', ''),
                    comp.get('adjusted_criterion', ''),
                    data_value,
                    comp.get('type', ''),
                    comp.get('group', ''),
                ])
        else:
            writer.writerow(['VALUE'])
            writer.writerow([bwt_data])
        return output.getvalue()

    # ------------------------------------------------------------------ #
    # Public export methods
    # ------------------------------------------------------------------ #

    def _get_session_or_raise(self, session_id):
        """Fetch a session document or raise :class:`NotFoundError`.

        Args:
            session_id: The session's ``_id`` (string or ObjectId).

        Returns:
            dict: The raw session document.

        Raises:
            NotFoundError: When no session with that ``_id`` exists.
        """
        session = self._sessions.find_by_id(session_id)
        if not session:
            raise NotFoundError('Session not found')
        return session

    def export_value_functions_csv(self, session_id):
        """Export a session's value functions as a CSV file.

        Args:
            session_id: The session's ``_id``.

        Returns:
            tuple[bytes, str, str]: (content, filename, ``'text/csv'``).

        Raises:
            NotFoundError: When the session does not exist.
            ValidationError: When value functions are not yet complete.
        """
        session = self._get_session_or_raise(session_id)
        criteria = self._session_svc.resolve_session_criteria(session)
        qi = session.get('qualitative_indicators') or {}
        vf = session.get('value_functions') or {}
        if not self._session_svc.is_value_functions_complete(criteria, vf):
            raise ValidationError('Complete value functions before export')
        criteria_map = vf.get('criteria') if isinstance(vf, dict) else {}
        if not isinstance(criteria_map, dict):
            criteria_map = {}
        content = self.build_value_functions_csv(criteria, criteria_map, qi)
        filename = f'value_functions_{session.get("name", session_id)}.csv'
        return content.encode(), filename, 'text/csv'

    def export_value_functions_json(self, session_id):
        """Export a session's value functions as a JSON file.

        Qualitative criteria are represented with a placeholder straight-line
        function (``x=0,y=0`` to ``x=1,y=1``).

        Args:
            session_id: The session's ``_id``.

        Returns:
            tuple[bytes, str, str]: (content, filename, ``'application/json'``).

        Raises:
            NotFoundError: When the session does not exist.
            ValidationError: When value functions are not yet complete.
        """
        session = self._get_session_or_raise(session_id)
        criteria = self._session_svc.resolve_session_criteria(session)
        vf = session.get('value_functions') or {}
        if not self._session_svc.is_value_functions_complete(criteria, vf):
            raise ValidationError('Complete value functions before export')
        criteria_map = vf.get('criteria') if isinstance(vf, dict) else {}
        if not isinstance(criteria_map, dict):
            criteria_map = {}
        combined = {}
        if isinstance(criteria, list) and criteria:
            for criterion in criteria:
                if not isinstance(criterion, dict):
                    continue
                name = criterion.get('criterion_name')
                if not name:
                    continue
                if criterion.get('is_qualitative'):
                    combined[name] = {'points': [{'x': 0, 'y': 0}, {'x': 1, 'y': 1}]}
                elif name in criteria_map:
                    combined[name] = criteria_map[name]
        else:
            combined = criteria_map
        exported_vf = dict(vf) if isinstance(vf, dict) else {}
        exported_vf['criteria'] = combined
        payload = {'session_id': str(session['_id']), 'name': session.get('name'), 'value_functions': exported_vf}
        content = json.dumps(payload, ensure_ascii=False, indent=2).encode()
        return content, f'value_functions_{session.get("name", session_id)}.json', 'application/json'

    def export_bwt_csv(self, session_id):
        """Export a session's BWT comparison data as a CSV file.

        Args:
            session_id: The session's ``_id``.

        Returns:
            tuple[bytes, str, str]: (content, filename, ``'text/csv'``).

        Raises:
            NotFoundError: When the session does not exist or contains no BWT
                comparisons.
        """
        session = self._get_session_or_raise(session_id)
        bwt_data = session.get('bwt') or {}
        comparisons = bwt_data.get('comparisons', [])
        if not comparisons:
            raise NotFoundError('No BWT data to export')
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['REFERENCE_CRITERION', 'ADJUSTED_CRITERION', 'DATA_VALUE', 'TYPE'])
        for comp in comparisons:
            if isinstance(comp, dict):
                writer.writerow([
                    comp.get('reference_criterion', ''),
                    comp.get('adjusted_criterion', ''),
                    comp.get('data_value', ''),
                    comp.get('type', '')
                ])
        filename = f'bwt_{session.get("name", session_id)}.csv'
        return output.getvalue().encode(), filename, 'text/csv'

    def export_input_csv(self, session_id):
        """Export a session's normalised input data as a CSV file.

        Requires both qualitative indicators and value functions to be
        complete.

        Args:
            session_id: The session's ``_id``.

        Returns:
            tuple[bytes, str, str]: (content, filename, ``'text/csv'``).

        Raises:
            NotFoundError: When the session does not exist.
            ValidationError: When qualitative indicators or value functions are
                incomplete.
        """
        session = self._get_session_or_raise(session_id)
        criteria = self._session_svc.resolve_session_criteria(session)
        qi = session.get('qualitative_indicators') or {}
        vf = session.get('value_functions') or {}
        if not self._session_svc.is_qualitative_complete(criteria, qi) or not self._session_svc.is_value_functions_complete(criteria, vf):
            raise ValidationError('Complete qualitative indicators and value functions before export')
        content = self.build_alternatives_csv(criteria, qi)
        return content.encode(), f'input_{session.get("name", session_id)}.csv', 'text/csv'

    def export_input_json(self, session_id):
        """Export a session's normalised input data as a JSON file.

        For qualitative criteria the stored qualitative value is embedded into
        each alternative's ``value`` field.

        Args:
            session_id: The session's ``_id``.

        Returns:
            tuple[bytes, str, str]: (content, filename, ``'application/json'``).

        Raises:
            NotFoundError: When the session does not exist.
            ValidationError: When qualitative indicators or value functions are
                incomplete.
        """
        session = self._get_session_or_raise(session_id)
        criteria = self._session_svc.resolve_session_criteria(session)
        qi = session.get('qualitative_indicators') or {}
        vf = session.get('value_functions') or {}
        if not self._session_svc.is_qualitative_complete(criteria, qi) or not self._session_svc.is_value_functions_complete(criteria, vf):
            raise ValidationError('Complete qualitative indicators and value functions before export')
        updated_criteria = []
        for criterion in (criteria if isinstance(criteria, list) else []):
            if not isinstance(criterion, dict):
                continue
            updated = dict(criterion)
            if isinstance(updated.get('alternatives'), list) and updated.get('is_qualitative'):
                new_alts = []
                for alt in updated['alternatives']:
                    if not isinstance(alt, dict):
                        continue
                    new_alt = dict(alt)
                    new_alt['value'] = self.get_qualitative_alt_value(qi, updated.get('criterion_name'), alt.get('name'))
                    new_alts.append(new_alt)
                updated['alternatives'] = new_alts
            updated_criteria.append(updated)
        payload = {'session_id': str(session['_id']), 'name': session.get('name'), 'criteria': updated_criteria}
        content = json.dumps(payload, ensure_ascii=False, indent=2).encode()
        return content, f'input_{session.get("name", session_id)}.json', 'application/json'

    def export_input_raw_csv(self, session_id):
        """Export a session's raw criteria data as a CSV file (no normalisation).

        Args:
            session_id: The session's ``_id``.

        Returns:
            tuple[bytes, str, str]: (content, filename, ``'text/csv'``).

        Raises:
            NotFoundError: When the session does not exist or has no criteria.
        """
        session = self._get_session_or_raise(session_id)
        criteria = self._session_svc.resolve_session_criteria(session)
        if not isinstance(criteria, list) or not criteria:
            raise NotFoundError('No input data to export')
        content = self.build_input_raw_csv(criteria)
        return content.encode(), f'input_raw_{session.get("name", session_id)}.csv', 'text/csv'

    def export_qualitative_csv(self, session_id):
        """Export a session's qualitative indicators as a CSV file.

        Args:
            session_id: The session's ``_id``.

        Returns:
            tuple[bytes, str, str]: (content, filename, ``'text/csv'``).

        Raises:
            NotFoundError: When the session does not exist.
            ValidationError: When qualitative indicators are incomplete.
        """
        session = self._get_session_or_raise(session_id)
        criteria = self._session_svc.resolve_session_criteria(session)
        qi = session.get('qualitative_indicators') or {}
        if not self._session_svc.is_qualitative_complete(criteria, qi):
            raise ValidationError('Complete qualitative indicators before export')
        content = self.build_qualitative_csv(criteria, qi)
        return content.encode(), f'qualitative_indicators_{session.get("name", session_id)}.csv', 'text/csv'

    def export_pile_csv(self, session_id):
        """Export a session's PILE-BWT data as a CSV file.

        Args:
            session_id: The session's ``_id``.

        Returns:
            tuple[bytes, str, str]: (content, filename, ``'text/csv'``).

        Raises:
            NotFoundError: When the session does not exist or has no BWT data.
        """
        session = self._get_session_or_raise(session_id)
        bwt_data = session.get('bwt')
        if bwt_data is None:
            raise NotFoundError('No PILE-BWT data to export')
        content = self.build_pile_bwt_csv(bwt_data)
        return content.encode(), f'pile_bwt_{session.get("name", session_id)}.csv', 'text/csv'

    def export_pile_json(self, session_id):
        """Export a session's PILE-BWT data as a JSON file.

        Args:
            session_id: The session's ``_id``.

        Returns:
            tuple[bytes, str, str]: (content, filename, ``'application/json'``).

        Raises:
            NotFoundError: When the session does not exist or has no BWT data.
        """
        session = self._get_session_or_raise(session_id)
        bwt_data = session.get('bwt')
        if bwt_data is None:
            raise NotFoundError('No PILE-BWT data to export')
        payload = {'session_id': str(session['_id']), 'name': session.get('name'), 'pile_bwt': bwt_data}
        content = json.dumps(payload, ensure_ascii=False, indent=2).encode()
        return content, f'pile_bwt_{session.get("name", session_id)}.json', 'application/json'

    def export_all_outputs_zip(self, session_id):
        """Package all session exports into a single ZIP archive.

        Includes the alternatives CSV, value functions CSV, and PILE-BWT CSV.
        All three data sections must be complete before calling this method.

        Args:
            session_id: The session's ``_id``.

        Returns:
            tuple[BytesIO, str, str]: (buffer, filename, ``'application/zip'``).

        Raises:
            NotFoundError: When the session does not exist.
            ValidationError: When qualitative indicators, value functions, or
                PILE-BWT data are incomplete.
        """
        session = self._get_session_or_raise(session_id)
        criteria = self._session_svc.resolve_session_criteria(session)
        qi = session.get('qualitative_indicators') or {}
        vf = session.get('value_functions') or {}
        bwt_data = session.get('bwt')
        if not self._session_svc.is_qualitative_complete(criteria, qi) or not self._session_svc.is_value_functions_complete(criteria, vf):
            raise ValidationError('Complete qualitative indicators and value functions before export')
        if bwt_data is None:
            raise ValidationError('Complete PILE-BWT before export')
        criteria_map = vf.get('criteria') if isinstance(vf, dict) else {}
        if not isinstance(criteria_map, dict):
            criteria_map = {}
        session_name = session.get('name', session_id)
        alt_csv = self.build_alternatives_csv(criteria, qi)
        vf_csv = self.build_value_functions_csv(criteria, criteria_map, qi)
        pile_csv = self.build_pile_bwt_csv(bwt_data)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(f'alternatives_{session_name}.csv', alt_csv)
            zf.writestr(f'value_functions_{session_name}.csv', vf_csv)
            zf.writestr(f'pile_bwt_{session_name}.csv', pile_csv)
        buf.seek(0)
        return buf, f'outputs_{session_name}.zip', 'application/zip'

    def export_summary_csv(self, session_id):
        """Export a brief completion-status summary for a session as CSV.

        Columns: ``Field``, ``Value``.  Rows report whether qualitative
        indicators, value functions, and PILE-BWT have been filled, and the
        overall fraction of completed sections.

        Args:
            session_id: The session's ``_id``.

        Returns:
            tuple[bytes, str, str]: (content, filename, ``'text/csv'``).

        Raises:
            NotFoundError: When the session does not exist.
        """
        session = self._get_session_or_raise(session_id)
        has_qi = session.get('qualitative_indicators') is not None
        has_vf = session.get('value_functions') is not None
        has_bwt = session.get('bwt') is not None
        completed = sum([has_qi, has_vf, has_bwt])
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Field', 'Value'])
        writer.writerow(['Name', session.get('name')])
        writer.writerow(['Qualitative Indicators Filled', has_qi])
        writer.writerow(['Value Functions Filled', has_vf])
        writer.writerow(['PILE-BWT Filled', has_bwt])
        writer.writerow(['Completed Sections', f'{completed}/3'])
        return output.getvalue().encode(), f'output_{session.get("name", session_id)}.csv', 'text/csv'
