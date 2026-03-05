# UP-MAVT Suite Implementation Plan

## Overview
This document outlines the modifications needed to transform the webapp into the "UP-MAVT Suite" with a new login-based navigation system, feature toggles for practitioners, and flexible input validation.

## Key Requirements

1. **App Title**: Rename to "UP-MAVT Suite" (all user-facing areas)
2. **Terminology**: Rename "Expert" to "Stakeholder" (frontend UI only)
3. **Authentication Flow**: Replace Expert/Practitioner dropdown with login page
4. **Landing Page**: Make login page the default landing page
5. **Navigation**: Add Login button (top right) and Documentation button (before settings icon)
6. **Feature Toggling**: Allow practitioners to independently activate Value Functions, QIs, and BWT
7. **Input Flexibility**: Adjust input file validation based on activated features
8. **Min/Max Handling**: Add checkbox to activate min/max rows; use available values as fallback

---

## Detailed Implementation Steps

### FRONTEND CHANGES

#### 1. Create Login Page Component
**File**: `frontend/src/pages/LoginPage.jsx`

**Requirements**:
- Input field for session code
- Buttons to submit code
- Display login status and messages
- Query backend to detect session type (practitioner vs stakeholder/elicitation)
- On successful access:
  - For stakeholder: Load stakeholder session, navigate to qualitative indicators or appropriate page
  - For practitioner: Load practitioner session, navigate to manage case study page
- Allow creation of new practitioner session via manual code entry
- Handle errors gracefully

**Backend Call**:
- New endpoint: `GET /api/session/detect/<code>` - returns `{ type: 'stakeholder' | 'practitioner', _id, code, exists }`

#### 2. Create Documentation Page Component
**File**: `frontend/src/pages/DocumentationPage.jsx`

**Requirements**:
- Empty page with heading "Documentation"
- Placeholder text: "Documentation coming soon"
- Accessible to both stakeholders and practitioners
- Simple layout with white background

#### 3. Update Navigation Component
**File**: `frontend/src/components/Navigation.jsx`

**Changes**:
- Remove role dropdown (Expert/Practitioner selector)
- Replace with "Login" button (top right, before settings icon)
- Add Documentation button/icon (book icon or question mark) before settings icon
- Update heading to display "UP-MAVT Suite" instead of "UP-MAVT"
- Conditionally hide role-specific navigation pages when on login page
- Add logout functionality (clears session and returns to login)
- Update all user-facing text: "Expert" → "Stakeholder"

**Props needed**:
- `isLoggedIn`: Boolean
- `currentRole`: 'stakeholder' | 'practitioner' | null
- `onLogin`: Handler when user logs in
- `onLogout`: Handler when user logs out
- `onDocumentation`: Handler to navigate to documentation page

#### 4. Update App.jsx
**File**: `frontend/src/App.jsx`

**Changes**:
- Add new state for login status: `isLoggedIn`, `currentRole`, `currentSessionId`, `currentCode`
- Change initial page to LoginPage (instead of SessionAccessPage/StudyAccessPage)
- Restructure routing logic:
  - If not logged in: Show LoginPage
  - If logged in as stakeholder: Show stakeholder pages
  - If logged in as practitioner: Show practitioner pages
- Add handlers:
  - `handleLogin(sessionId, code, role)` - sets login state and navigates to appropriate page
  - `handleLogout()` - clears login state and returns to LoginPage
  - `handleDocumentation()` - navigates to DocumentationPage for both roles
- Update page naming: "expert" → "stakeholder" in page identifiers

#### 5. Update ManageCaseStudyPage
**File**: `frontend/src/pages/ManageCaseStudyPage.jsx`

**Changes**:
- Move feature toggle UI from elsewhere into this page (or create a new FeatureTogglePage)
- Add three independent checkboxes:
  - [ ] Qualitative Indicators (QIs)
  - [ ] Value Functions
  - [ ] PILE-BWT
- Store feature activation state in `practitioner_features` or similar
- Save state to backend via new endpoint: `PATCH /api/study-session/<id>` with `{ features: { qi: bool, vf: bool, bwt: bool } }`
- For each elicitation session created, validate based on activated features:
  - If QI activated: require complete input (with alternatives)
  - If VF/BWT activated: require only criteria and optional min/max values
  - Display validation requirements dynamically

#### 6. Update InputPage
**File**: `frontend/src/pages/InputPage.jsx`

**Changes**:
- Add checkbox at top: "Use custom min/max values"
- When unchecked (default):
  - Hide min/max input rows
  - Backend uses min/max from alternatives
- When checked:
  - Show min/max input rows for each criterion
  - Allow practitioners to manually set extremes
- Update CSV parsing to handle optional min/max rows
- Update validation logic:
  - If QI activated: require complete input with alternatives
  - If VF/BWT only: allow criteria-only input with optional min/max
  - Show clear validation messages based on activated features

#### 7. Add Stakeholder Terminology
**Files**: Multiple (all frontend pages and components)

**Changes**:
- Update all UI labels: "Expert" → "Stakeholder"
- Update page titles and instructions where "Expert" is mentioned
- Keep variable names in code as-is if needed for simplicity
- Update help text and tooltips

**Affected Files**:
- `Navigation.jsx` - dropdown labels, page labels
- `SessionAccessPage.jsx` - heading, placeholder text
- `App.jsx` - internal routing references (for consistency)

#### 8. Update App Title
**File**: `frontend/index.html`

**Changes**:
- Update `<title>` to "UP-MAVT Suite"
- Update any meta descriptions if present

#### 9. Add Documentation Icon to Navigation
**File**: `frontend/src/components/Navigation.jsx`

**Changes**:
- Import documentation icon (use `<InfoIcon />` or `<QuestionIcon />` from Chakra if available, or `<BookIcon />`)
- Place button before settings icon
- Add onClick handler to navigate to Documentation page

### BACKEND CHANGES

#### 1. Add Session Detection Endpoint
**File**: `backend/app/routes/api.py`

**New Endpoint**: `GET /api/session/detect/<code>`

**Logic**:
- Check if code exists in `sessions` collection (stakeholder/elicitation)
- Check if code exists in `study_sessions` collection (practitioner)
- Return:
  ```json
  {
    "exists": true,
    "type": "stakeholder" | "practitioner",
    "_id": "<session_id>",
    "code": "<code>"
  }
  ```
- If not found: `{ "exists": false }`

#### 2. Extend Study Session Schema
**File**: `backend/app/routes/api.py` - `create_study_session` and related endpoints

**Add to study_sessions document**:
- `features: { qi: bool, vf: bool, bwt: bool }` - tracks which features are active
- Default: all false initially

#### 3. Add Feature Toggle Endpoint
**File**: `backend/app/routes/api.py`

**New Endpoint**: `PATCH /api/study-session/<id>`

**Allows**:
- Updating `features` field
- Example request body: `{ "features": { "qi": true, "vf": true, "bwt": false } }`

#### 4. Update Input Validation
**File**: `backend/app/routes/api.py` - update endpoints that validate input

**Changes**:
- When receiving input for a study session, check which features are active
- If QI active: require complete input (criteria + alternatives)
- If VF/BWT active: allow criteria-only or criteria + min/max
- Return clear validation messages indicating what's missing based on activated features
- If min/max not provided but needed, generate from alternatives (if available)

---

## File Structure Summary

### New Files
- `frontend/src/pages/LoginPage.jsx`
- `frontend/src/pages/DocumentationPage.jsx`

### Modified Files (Frontend)
- `frontend/src/App.jsx` - routing structure, login state management
- `frontend/src/components/Navigation.jsx` - login button, documentation button, removed role dropdown
- `frontend/src/pages/SessionAccessPage.jsx` - ui updates if repurposed
- `frontend/src/pages/InputPage.jsx` - min/max toggle, flexible validation
- `frontend/src/pages/ManageCaseStudyPage.jsx` - feature toggles
- `frontend/index.html` - title update

### Modified Files (Backend)
- `backend/app/routes/api.py` - new endpoints, validation updates

---

## Implementation Order

1. **Backend first**:
   - Add session detection endpoint
   - Add feature toggle endpoint
   - Update input validation logic

2. **Frontend next**:
   - Create LoginPage component
   - Create DocumentationPage component
   - Update Navigation component (remove dropdown)
   - Update App.jsx routing
   - Update ManageCaseStudyPage with feature toggles
   - Update InputPage with min/max checkbox
   - Update terminology (Expert → Stakeholder)
   - Update title

3. **Testing**:
   - Test login with stakeholder code
   - Test login with practitioner code
   - Test creating new practitioner session
   - Test feature toggles and input validation
   - Test min/max checkbox functionality