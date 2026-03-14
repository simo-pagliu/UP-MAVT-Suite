"""Repository for the *sessions* (elicitation sessions) collection."""

from bson.objectid import ObjectId
from .base import BaseRepository


class SessionRepository(BaseRepository):
    """Data-access object for the ``sessions`` MongoDB collection."""

    def __init__(self, db):
        """Initialise the repository with a database handle.

        Args:
            db: A PyMongo (or mongomock) database object.
        """
        self._col = db.sessions

    def find_by_id(self, session_id):
        """Retrieve a single session document by its identifier.

        Args:
            session_id: The document's ``_id`` (string or ObjectId).

        Returns:
            dict | None: The document, or ``None`` if not found.
        """
        oid = self._to_oid(session_id)
        print(f"DEBUG: find_by_id - session_id={session_id}, converted oid={oid}")
        if oid:
            result = self._col.find_one({'_id': oid})
            print(f"DEBUG: find_by_id - query result: {result is not None}")
            return result
        else:
            print(f"DEBUG: find_by_id - failed to convert to oid")
            return None

    def find_by_name(self, name):
        """Retrieve a session by its unique name (session code).

        Args:
            name (str): The session's ``name`` field value.

        Returns:
            dict | None: The first matching document, or ``None``.
        """
        return self._col.find_one({'name': name})

    def find_all(self):
        """Return all sessions sorted by creation date (newest first).

        Returns:
            list[dict]: All session documents.
        """
        return list(self._col.find().sort('created_at', -1))

    def find_by_study_session_id(self, study_session_id):
        """Return all sessions that belong to a given study session.

        Args:
            study_session_id: The parent study session's ``_id``.

        Returns:
            list[dict]: Matching session documents, newest first.
        """
        oid = self._to_oid(study_session_id)
        if not oid:
            return []
        return list(self._col.find({'study_session_id': oid}).sort('created_at', -1))

    def count_by_study_session_id(self, study_session_id):
        """Count sessions that belong to a given study session.

        Args:
            study_session_id: The parent study session's ``_id``.

        Returns:
            int: The number of matching documents.
        """
        oid = self._to_oid(study_session_id)
        return self._col.count_documents({'study_session_id': oid}) if oid else 0

    def insert(self, doc):
        """Insert a new session document.

        Args:
            doc (dict): The document to insert.

        Returns:
            ObjectId: The ``_id`` of the newly inserted document.
        """
        return self._col.insert_one(doc).inserted_id

    def update(self, session_id, fields):
        """Apply a ``$set`` update to the specified session.

        Args:
            session_id: The document's ``_id`` (string or ObjectId).
            fields (dict): The fields to set.

        Returns:
            int: The number of documents modified (0 or 1).
        """
        oid = self._to_oid(session_id)
        if not oid:
            return 0
        return self._col.update_one({'_id': oid}, {'$set': fields}).modified_count

    def delete(self, session_id):
        """Delete a session document by its identifier.

        Args:
            session_id: The document's ``_id`` (string or ObjectId).

        Returns:
            int: The number of documents deleted (0 or 1).
        """
        oid = self._to_oid(session_id)
        if not oid:
            return 0
        return self._col.delete_one({'_id': oid}).deleted_count

    def find_by_ids(self, session_ids):
        """Retrieve multiple sessions by a list of identifiers.

        Invalid or unparseable identifiers are silently skipped.

        Args:
            session_ids (list): A list of ``_id`` values (strings or ObjectIds).

        Returns:
            list[dict]: Documents whose ``_id`` is in the resolved list.
        """
        oids = [oid for sid in session_ids if (oid := self._to_oid(sid)) is not None]
        if not oids:
            return []
        return list(self._col.find({'_id': {'$in': oids}}))

    def delete_many_by_study_session_id(self, study_session_id):
        """Delete all sessions that belong to a given study session.

        Args:
            study_session_id: The parent study session's ``_id``.

        Returns:
            int: The number of documents deleted.
        """
        oid = self._to_oid(study_session_id)
        if not oid:
            return 0
        return self._col.delete_many({'study_session_id': oid}).deleted_count

    def selective_reset_data(self, study_session_id, affected_criteria, affected_groups):
        """Selectively remove specific criteria and groups from session data.
        
        This removes:
        - VF data for affected criteria
        - BWT comparisons for affected groups
        - QI data for removed criteria only
        
        Args:
            study_session_id: The parent study session's ``_id``.
            affected_criteria (list[str]): Criterion names to reset VF/QI data for.
            affected_groups (list[str]): Group names to reset BWT data for.
            
        Returns:
            dict: Summary of reset operations.
        """
        oid = self._to_oid(study_session_id)
        if not oid:
            return {'updated_sessions': 0}
        
        sessions = self.find_by_study_session_id(study_session_id)
        updated_count = 0
        
        for session in sessions:
            session_id = session['_id']
            update_fields = {}
            
            # Reset VF data for affected criteria
            if affected_criteria:
                vf = session.get('value_functions') or {}
                vf_criteria = vf.get('criteria') or {}
                
                # Remove affected criteria
                for crit_name in affected_criteria:
                    if crit_name in vf_criteria:
                        del vf_criteria[crit_name]
                
                update_fields['value_functions'] = {'criteria': vf_criteria}
            
            # Reset BWT data for affected groups
            if affected_groups:
                bwt = session.get('bwt') or {}
                comparisons = bwt.get('comparisons') or []
                criteria_signature = bwt.get('criteria_signature', '')
                
                # Remove comparisons involving affected groups
                # Also remove intra-best and intra-worst comparisons when any group is affected
                filtered_comparisons = [
                    comp for comp in comparisons 
                    if comp.get('group') not in affected_groups
                    and comp.get('type') not in ['intra-best', 'intra-worst']
                ]
                
                update_fields['bwt'] = {
                    'comparisons': filtered_comparisons,
                    'criteria_signature': criteria_signature
                }
            
            # Apply updates if any
            if update_fields:
                self.update(session_id, update_fields)
                updated_count += 1
        
        return {'updated_sessions': updated_count}
