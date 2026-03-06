# Fixes and Enhancements Backlog (Refined)

This file rewrites the requested changes into clear implementation requirements.

## 1) Stakeholder Overview page fixes

### 1.1 Remove incorrect navigation when input is missing
- In Stakeholder Overview, if input is missing, **do not show** a button to "Go to Input Definition".
- Reason: Stakeholders should not be redirected to practitioner-only input editing.

### 1.2 Unify "missing criteria" warning copy
- The warning text for missing criteria is currently inconsistent across sections.
- Use one common warning style and wording for all 3 relevant sections.

---

## 2) Input CSV schema updates

Update both:
- Uploaded input CSV format
- Downloaded/generated input CSV format
- Example CSV file

### Add/ensure these columns per criterion
- `is_qi` (true/false)
- `min_value` (empty by default unless custom value is set)
- `max_value` (empty by default unless custom value is set)
- `vf_method` (value function method)

### Notes
- Keep backward compatibility where feasible (older CSVs should fail gracefully with clear errors, or be auto-interpreted if possible).
- Ensure parsing and export are symmetric (what is exported can be re-imported without losing data).

---

## 3) Admin backup/restore via ZIP

Admin page should provide case-study level backup and restore.

### Required actions
- **Download backup ZIP** for a whole case study, including:
	- all related CSVs
	- required metadata
- **Upload backup ZIP** to restore a case study later (for archive/delete/re-upload workflows).

### Expected behavior
- ZIP should include enough metadata to reconstruct the case study and sessions consistently.
- Validation errors on upload must be explicit and user-friendly.

---

## 4) PILE-BWT behavior redesign

### 4.1 Remove "invalid criteria" warning flow
- Remove the current "invalid criteria" warning functionality.
- Replace with automatic reset behavior and clear completion-state reporting.

### 4.2 Lock QI and VF when starting PILE-BWT
- Before entering PILE-BWT, show a confirmation message:
	- proceeding will lock QIs and VFs.
- If user accepts, lock QI and VF editing and continue to PILE-BWT.

### 4.3 Unlock from PILE-BWT with explicit consequence
- If user chooses to unlock QI/VF from PILE-BWT interface, show clear warning that some comparisons will be reset.

### 4.4 Reset logic on criterion modification
- If a criterion is modified:
	- reset the whole group containing that criterion in PILE-BWT,
	- reset the two related intra-group comparisons,
	- mark PILE-BWT as not fully completed.

### 4.5 Fix textbox-only input completion bug
- In PILE-BWT comparisons, changing only the numeric textbox (without touching slider) must count as completed input.
- User must be able to continue (`Next`) after valid textbox entry.

---

## 5) Login page redesign

Replace centered-box style with a full page layout:
- top explanatory text introducing the suite,
- brief explanation of the login/access model,
- access/create controls,
- documentation link.

---

## 6) Auto-generated codes

### 6.1 Create new case study
- Replace manual code entry with one "Create new" action.
- System auto-generates a unique code and checks collision before saving.

### 6.2 Create new elicitation session
- Same behavior: one "Create new" action with automatic unique code generation.

---

## 7) Practitioner export step

Add a new final step:
- **Step 7: Export**

Include two actions:
- **Export data** (ZIP, meaningful filenames)
- **Export plots** (ZIP, meaningful filenames)

---

## 8) Consistency pass for messages/tooltips

Run a codebase-wide UX consistency pass to unify:
- tooltips,
- warnings,
- error messages.

Goal: avoid mixed tones and inconsistent terminology.

---

## Clarifications needed before implementation

1. `vf_method` allowed values: fixed enum or free text? vf method is the tickbox currently implemented in input page deifniton, is "mid-value" askign if the value function elicitaion should use the mid-value splitting techinique, the csv will have TRUE or FALSE, if FALSE, then it's free edit method
2. On backup ZIP upload conflicts (same case/session code), should behavior be skip, overwrite, or create new codes? Tell the user about the conflict, and give the option to abort or generate new codes
3. For code generation format, do you prefer short alphanumeric (e.g. `AB12CD`) or prefixed format (e.g. `STUDY-XXXX`)? Alphanueric is fine
4. For old CSVs missing new columns, should import reject with error or auto-fill defaults? reject

ADDITIONAL:
all the message icosns should use chakra icons
