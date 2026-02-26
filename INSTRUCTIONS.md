Feature changes: Expert vs Practitioner, Study Sessions

Goal
- Split the top navigation into two tabs: Expert (default) and Practitioner.
- Replace expert-side input editing with a session access flow.
- Add study sessions so multiple elicitation sessions share one input.
- Move per-session downloads into the practitioner Manage Case Studies page.
- Make Admin access less conspicuous (icon/button top-right).

Roles and navigation
- Expert tab (default): Session Access, Value Functions, Qualitative Indicators, PILE-BWT.
- Practitioner tab: Input Definition, Manage Case Studies.
- Admin page: accessible via a low-visibility icon/button on the top-right of the header.

Expert flow (elicitation session)
- Session Access page replaces Input page for experts.
- Expert enters an elicitation session code to load criteria and proceed.
- Experts cannot edit or upload input data.

Practitioner flow (study session)
- Practitioner enters an existing study session code or creates a new study session code (same UX as current session code entry).
- After accessing a study session, the practitioner goes to Input Definition (current Input page) to upload/edit the input table for that study.
- Then the practitioner uses Manage Case Study to create elicitation sessions for this study.
- Practitioner can see progress for each elicitation session.
- Add a "Run UP-MAVT" page currently blank

Manage Case Study page (new)
- Scoped to the currently accessed study session.
- Create one or more elicitation sessions (each with its own code).
- List elicitation sessions with progress indicators and actions.
- Elicitation sessions can be locked, unlocked and deleted
- Add a 3-dot menu on each elicitation session row to download:
	- Qualitative Indicators
	- Value Functions
	- PILE-BWT

Data model and persistence
- Introduce study sessions as a parent entity.
- Store input once and reference it from multiple elicitation sessions.
- Elicitation sessions should reference study_session_id and input_id.

Backend/API changes
- New endpoints for study sessions:
	- Create study session (code + input upload).
	- Get study session by code.
	- List elicitation sessions for a study.
	- Create elicitation session under a study.
- Ensure existing export endpoints work per elicitation session.
- Keep current elicitation session behavior for experts (by session code).

Frontend changes
- Update header to show Expert/Practitioner tabs and a subtle Admin button.
- Replace Input page with Session Access page for experts.
- Add Manage Case Studies page for practitioners.
- Move per-session downloads from Output into Manage Case Studies.
- Add "UP-MAVT" title on the top of the web app