# Implementation Prompt (refined)

Implement the following UX and behavior changes in this repository.

## Scope

- Frontend: `frontend/src/App.jsx`, `frontend/src/components/Navigation.jsx`, `frontend/src/pages/CaseStudyPage.jsx`, `frontend/src/pages/ValueFunctionsPage.jsx`, and any shared UI helper you introduce.
- Backend (if needed for persistence): `backend/app/routes/api.py`, `backend/app/services/study_session_service.py`.
- Tests: update/add only the tests affected by these changes.

## Requirements

### 1) Practitioner page order

For practitioner users, the page order must be:

1. Input Definition
2. Manage Case Studies
3. Run UP-MAVT

Apply this consistently in both:

- initial practitioner landing page state
- top navigation button order

Do not add extra pages.

### 2) Value-function method selection must be practitioner-controlled

Move value-function method choice from stakeholder execution to practitioner setup.

- In `CaseStudyPage`, add a practitioner control for Value Functions method with exactly two choices:
	- Mid-value splitting
	- Free edit
- Persist this setting at study-session level (backend + API update as needed).
- Ensure stakeholder value-function flow reads this study-level setting.

### 3) Remove stakeholder method toggle

In `ValueFunctionsPage`, remove stakeholder-facing method switching controls (currently “Mid-splitting” / “Free Edit” toggle buttons).

- Stakeholder must no longer choose the method manually.
- The page should operate in the method preselected by practitioner.

### 4) Free edit UX simplification

For free edit mode in `ValueFunctionsPage`:

- Remove numeric textbox-based point editing UI (X/Y point inputs list).
- Keep graph-based editing only:
	- user can add a point
	- user can drag points
- Keep existing constraints (range clamp, monotonic behavior for linear shapes, locked endpoints) unless they conflict with this requirement.

### 5) Mid-splitting should be step-by-step (one question at a time)

Refactor mid-splitting to a sequential flow:

1. Increasing/decreasing question first (this replaces the current shape radio selector for this flow).
2. Indifference point 0.5 question.
3. Indifference point 0.25 question.
4. Indifference point 0.75 question.

Behavior:

- Show only one question at a time.
- Include `Next` between questions and `Done` at the end.
- Allow skipping each indifference question.
- If skipped, treat that step as completed for progress/completion logic.
- Skipping all indifference points must still be a valid completed result (linear function case).

### 6) Consistent question presentation style

Unify question presentation style across:

- Value Functions (`ValueFunctionsPage`)
- Qualitative Indicators (`QualitativeIndicatorsPage`)
- Weights / PILE-BWT (`PileBwtPage`)

Style requirement:

- Present questions as clear plain text, easy to read, visually consistent.
- Avoid “question inside a boxed card” styling for the question prompt itself.

Keep this minimal and aligned with existing Chakra design tokens (no new theme system).

## Implementation constraints

- Make focused, minimal changes.
- Do not introduce unrelated features.
- Preserve existing autosave behavior and lock protections.
- Keep existing APIs backward-compatible where possible.

## Acceptance checklist

- Practitioner nav and default page follow: Input Definition → Manage Case Studies → Run UP-MAVT.
- Practitioner can set VF method once per study session.
- Stakeholder VF page no longer shows method toggle.
- Free edit has graph-only interaction (add + drag), no X/Y point textboxes.
- Mid-splitting runs one question at a time with Next/Done and Skip.
- Direction question appears before first indifference point.
- Question prompts are visually consistent and plain-text across VF, QI, and PILE-BWT.
- Relevant frontend/backend tests updated and passing.

## Validation

Run and report:

- Frontend tests: `cd frontend && npm test`
- Backend tests impacted by study-session settings changes (at least targeted unit/integration tests).
