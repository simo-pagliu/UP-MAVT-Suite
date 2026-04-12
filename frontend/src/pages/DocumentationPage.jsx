import {
  Badge,
  Box,
  Code,
  Divider,
  Heading,
  HStack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  Text,
  VStack,
} from '@chakra-ui/react'

// ---------------------------------------------------------------------------
// Reusable sub-components
// ---------------------------------------------------------------------------

function SectionHeading({ children }) {
  return (
    <Heading as="h2" size="md" mt={6} mb={2} color="blue.700">
      {children}
    </Heading>
  )
}

function SubHeading({ children }) {
  return (
    <Heading as="h3" size="sm" mt={4} mb={1} color="gray.700">
      {children}
    </Heading>
  )
}

function Para({ children }) {
  return (
    <Text fontSize="sm" color="gray.700" mb={2} lineHeight="tall">
      {children}
    </Text>
  )
}

function BulletList({ items }) {
  return (
    <VStack align="start" spacing={1} pl={4} mb={2}>
      {items.map((item, i) => (
        <HStack key={i} align="start" spacing={2}>
          <Text fontSize="sm" color="blue.500" mt="1px">
            •
          </Text>
          <Text fontSize="sm" color="gray.700" lineHeight="tall">
            {item}
          </Text>
        </HStack>
      ))}
    </VStack>
  )
}

function ApiRow({ method, path, description }) {
  const colorMap = { GET: 'green', POST: 'blue', PUT: 'orange', PATCH: 'purple', DELETE: 'red' }
  return (
    <HStack align="start" spacing={3} py={1}>
      <Badge colorScheme={colorMap[method] ?? 'gray'} minW="55px" textAlign="center">
        {method}
      </Badge>
      <Code fontSize="xs" colorScheme="gray" whiteSpace="pre-wrap" flex="1">
        {path}
      </Code>
      <Text fontSize="xs" color="gray.600" flex="2">
        {description}
      </Text>
    </HStack>
  )
}

function SchemaField({ name, type, description }) {
  return (
    <HStack align="start" spacing={3} py={1}>
      <Code fontSize="xs" colorScheme="blue" minW="180px">
        {name}
      </Code>
      <Tag size="sm" colorScheme="purple" minW="80px" justifyContent="center">
        {type}
      </Tag>
      <Text fontSize="xs" color="gray.600" flex="1">
        {description}
      </Text>
    </HStack>
  )
}

// ---------------------------------------------------------------------------
// Tab panels
// ---------------------------------------------------------------------------

function OverviewPanel() {
  return (
    <VStack align="start" spacing={0} pb={6}>
      <SectionHeading>What is the UP-MAVT Suite?</SectionHeading>
      <Para>
        The <strong>UP-MAVT Suite</strong> (Uncertainty-Propagated Multi-Attribute Value Theory) is a
        web-based elicitation platform that collects structured expert judgments from stakeholders and
        uses them to drive a multi-criteria decision analysis (MCDA). The results are expressed as
        probability distributions over alternative rankings, making the inherent uncertainty in expert
        opinions explicit rather than suppressing it.
      </Para>
      <Para>
        The platform implements three complementary elicitation instruments, each targeting a different
        aspect of an expert's preference model:
      </Para>
      <BulletList
        items={[
          'Qualitative Indicators — elicitation of values for qualitative indicators.',
          'Quantitative Indicators — traditional elicitation of value functions.',
          'Weight Elicitation — based on the best-worst tradeoff method.',
        ]}
      />

      <SectionHeading>High-level workflow</SectionHeading>
      <BulletList
        items={[
          '1. A practitioner creates a study session, defines criteria and alternatives, and enables the desired elicitation instruments.',
          '2. The practitioner generates one elicitation session code per stakeholder and shares the codes.',
          '3. Each stakeholder logs in with their code and completes the enabled elicitation steps.',
          '4. The practitioner runs the UP-MAVT analysis: Step 1 derives criterion weights from Weight Elicitation data; Steps 2–6 run a Monte Carlo simulation that propagates uncertainty through Qualitative Indicators, Quantitative Indicators, and weight distributions to produce ranked alternative scores.',
          '5. Results (distributions, rankings, sensitivity) are available for export as CSV / JSON / ZIP.',
        ]}
      />
    </VStack>
  )
}

function ArchitecturePanel() {
  return (
    <VStack align="start" spacing={0} pb={6}>
      <SectionHeading>Service topology</SectionHeading>
      <Para>
        The application is composed of four Docker services orchestrated with Docker Compose. All
        services share a private bridge network (<Code fontSize="xs">elicitation-network</Code>).
      </Para>
      <BulletList
        items={[
          'frontend — React 18 / Vite app served on port 3000. Communicates with the backend exclusively via a REST API at VITE_API_URL.',
          'backend — Flask 2.3 REST API on port 5000. Handles all HTTP requests, validates data, reads/writes MongoDB, and enqueues background tasks.',
          'worker — Python background process. Polls MongoDB for pending tasks and executes weight-computation and MAVT simulation jobs. Restarts automatically on failure.',
          'mongo — MongoDB 7.0 on port 27017. Single database: elicitation. Data persisted in the mongo_data Docker volume.',
        ]}
      />

      <SectionHeading>Frontend stack</SectionHeading>
      <BulletList
        items={[
          'React 18 — component model and state management.',
          'Vite — dev server and production bundler.',
          'Chakra UI — design-system component library (theme colours: blue scale).',
          'Recharts — chart components used in RunUpMavtPage.',
          'Axios — HTTP client; base URL configured in src/config.js via VITE_API_URL.',
          'Vitest + React Testing Library — unit tests run with `npm test`.',
        ]}
      />

      <SectionHeading>Backend stack</SectionHeading>
      <BulletList
        items={[
          'Flask 2.3 — WSGI web framework.',
          'Flask-CORS — permissive CORS for local development; tighten in production.',
          'PyMongo 4.6 — MongoDB driver.',
          'Python 3.11 — required for both backend and worker.',
        ]}
      />

      <SectionHeading>Worker stack</SectionHeading>
      <BulletList
        items={[
          'NumPy / SciPy — numerical computing for Monte Carlo sampling and weight optimisation.',
          'PyMongo — reads task queue and writes results back to MongoDB.',
          'The worker runs an infinite polling loop. Pending tasks are detected via a find-and-modify on the tasks collection.',
        ]}
      />

      <SectionHeading>Key configuration</SectionHeading>
      <BulletList
        items={[
          '.env / .env.example — non-sensitive settings (SMTP host, port, etc.); never commit .env to version control.',
          'secrets/ — Docker secret files for sensitive values (admin password, OAuth2 secret); excluded from version control.',
          'frontend/src/config.js — exports API_URL (read from VITE_API_URL env var).',
          'docker-compose.yml — service definitions, port mappings, volume mounts, environment injection.',
          'deployment_notes.md — step-by-step instructions for building, tagging, and pushing images to the PSI Gitea registry.',
        ]}
      />
    </VStack>
  )
}

function RolesPanel() {
  return (
    <VStack align="start" spacing={0} pb={6}>
      <SectionHeading>Role overview</SectionHeading>
      <Para>
        The application has three distinct roles. Role detection is code-based: the backend examines
        which MongoDB collection contains a document whose code/name matches the submitted value.
      </Para>

      <SubHeading>Stakeholder</SubHeading>
      <BulletList
        items={[
          'Receives a short alphanumeric code that maps to an elicitation session document in the sessions collection.',
          'Can complete Qualitative Indicators, Quantitative Indicators, and/or Weight Elicitation depending on which features the practitioner enabled.',
          'Session may be individually locked (criteria lock) or fully locked (session lock) by the practitioner.',
          'Has no visibility of other stakeholders or of the overall study configuration.',
        ]}
      />

      <SubHeading>Practitioner</SubHeading>
      <BulletList
        items={[
          'Receives a code that maps to a study session document in the study_sessions collection.',
          'Defines the decision problem: criteria, alternatives, groups, distributions.',
          'Configures enabled features (Qualitative Indicators, Quantitative Indicators, Weight Elicitation) and value-function method (mid-splitting or free-edit).',
          'Creates and manages individual elicitation sessions for stakeholders.',
          'Runs the UP-MAVT analysis and exports results.',
        ]}
      />

      <SubHeading>Admin</SubHeading>
      <BulletList
        items={[
          'Access is granted by entering the ADMIN_PASSWORD defined in the .env file.',
          'Can view and delete any session or study session.',
          'Can export (backup) or import (restore) the full database as a ZIP archive.',
          'The admin interface is rendered by AdminPage.jsx; it is only visible when currentRole === "admin".',
        ]}
      />

      <SectionHeading>Locking mechanisms</SectionHeading>
      <BulletList
        items={[
          'Criteria lock (PUT /api/session/<id>/lock) — marks individual criteria as read-only for the stakeholder.',
          'Session lock (PUT /api/session/<id>/lock-session) — prevents all further edits to the session.',
          'Both flags are stored as booleans on the session document and enforced on the frontend by disabling form controls.',
        ]}
      />
    </VStack>
  )
}

function ConceptsPanel() {
  return (
    <VStack align="start" spacing={0} pb={6}>
      <SectionHeading>MAVT — Multi-Attribute Value Theory</SectionHeading>
      <Para>
        MAVT is a decision-analysis framework that converts expert preferences into a scalar value
        score for each alternative across multiple criteria. Scores are aggregated using a weighted-sum
        (or geometric / harmonic mean) to produce an overall preference ranking.
      </Para>

      <SectionHeading>UP-MAVT — Uncertainty Propagation</SectionHeading>
      <Para>
        The "UP" prefix indicates that uncertainty in expert judgments (expressed through
        confidence levels and distributional inputs) is propagated through the analysis via Monte Carlo
        simulation. The result is a distribution of scores per alternative rather than a single point
        estimate.
      </Para>

      <SectionHeading>Qualitative Indicators</SectionHeading>
      <Para>
        Used when a criterion has no quantitative measurement. The stakeholder:
      </Para>
      <BulletList
        items={[
          'Phase 1 — Drags alternatives into a ranked tier list (best → worst).',
          'Phase 2 — Assigns a confidence level (0 = no confidence to 4 = absolute certainty) to each rank.',
        ]}
      />
      <Para>
        During the Monte Carlo simulation, alternatives are sampled from each rank according to
        confidence-weighted probabilities, producing a stochastic preference score.
      </Para>

      <SectionHeading>Quantitative Indicators</SectionHeading>
      <Para>
        A value function maps a quantitative criterion value (e.g. cost in €) to a preference score in
        [0, 1]. Two function shapes are supported:
      </Para>
      <BulletList
        items={[
          'Piecewise linear — defined by a set of (x, y) breakpoints; interpolated linearly.',
          'Gaussian — bell-curve shape; useful for criteria with an optimal interior value.',
        ]}
      />
      <Para>Two definition methods are available (configured per study session):</Para>
      <BulletList
        items={[
          'Mid-splitting — the stakeholder answers three indifference questions; the system derives breakpoints automatically.',
          'Free-edit — the stakeholder adjusts up to 10 breakpoints directly on an interactive chart.',
        ]}
      />

      <SectionHeading>Weight Elicitation (Best-Worst Tradeoff)</SectionHeading>
      <Para>
        The stakeholder identifies the most important (best) and least important (worst) criterion,
        then rates every other criterion relative to these anchors on a 1–9 scale. The rating data is
        stored as comparison rows and later converted into weight constraints during Step 1 of the
        UP-MAVT analysis.
      </Para>

      <SectionHeading>Criterion weights</SectionHeading>
      <Para>
        Weights are derived from Weight Elicitation comparisons via a three-phase optimisation:
      </Para>
      <BulletList
        items={[
          'Phase A — Differential Evolution minimises the maximum constraint violation over the weight simplex.',
          'Phase B — Simplex sampling projects the feasible weight region.',
          'Phase C — Threshold filtering removes infeasible solutions.',
        ]}
      />
      <Para>
        Each stakeholder session produces one weight vector. All weight vectors are stored in the
        study session document under computed_weights.weight_solutions and used as inputs to the Monte
        Carlo simulation.
      </Para>

      <SectionHeading>UP-MAVT analysis steps</SectionHeading>
      <BulletList
        items={[
          'Step 1 — Compute weights from Weight Elicitation data for all selected stakeholder sessions.',
          'Step 2 — Sample Qualitative Indicators scores and weight vectors; compute weighted-sum scores per alternative.',
          'Step 3 — Incorporate value functions; resample with distributional criterion values.',
          'Step 4 — Sensitivity analysis: vary one criterion at a time.',
          'Step 5 — Group-level aggregation and ranking.',
          'Step 6 — Full integrated UP-MAVT run combining all elicitation outputs.',
        ]}
      />
    </VStack>
  )
}

function DatabasePanel() {
  return (
    <VStack align="start" spacing={0} pb={6}>
      <SectionHeading>Database</SectionHeading>
      <Para>
        MongoDB 7.0, single database: <Code fontSize="xs">elicitation</Code>. The Python driver is
        PyMongo 4.6. All ObjectId values are serialised as strings in API responses.
      </Para>

      <SubHeading>Collection: sessions (elicitation sessions)</SubHeading>
      <VStack align="start" spacing={0} divider={<Divider />} w="full" mb={4}>
        <SchemaField name="_id" type="ObjectId" description="Primary key." />
        <SchemaField name="study_session_id" type="ObjectId" description="Reference to parent study_sessions document." />
        <SchemaField name="name" type="string" description="Short alphanumeric code shared with the stakeholder." />
        <SchemaField name="criteria" type="array" description="Copy of input criteria/alternatives from the study session at session-creation time." />
        <SchemaField name="qualitative_indicators" type="object" description="Keyed by criterion name. Each entry: { ranking, values, confidences }." />
        <SchemaField name="value_functions" type="object" description="Keyed by criterion name. Each entry: array of { x, y } breakpoints." />
        <SchemaField name="bwt" type="object" description="{ comparisons: [...], criteria_signature: string }." />
        <SchemaField name="locked" type="boolean" description="Criteria-level lock flag." />
        <SchemaField name="session_locked" type="boolean" description="Full-session lock flag." />
        <SchemaField name="created_at / updated_at" type="datetime" description="Automatic timestamps." />
      </VStack>

      <SubHeading>Collection: study_sessions (practitioner studies)</SubHeading>
      <VStack align="start" spacing={0} divider={<Divider />} w="full" mb={4}>
        <SchemaField name="_id" type="ObjectId" description="Primary key." />
        <SchemaField name="code" type="string" description="8-char code shared with the practitioner." />
        <SchemaField name="title / description" type="string" description="Human-readable study metadata." />
        <SchemaField name="features" type="object" description="{ qi, vf, bwt } — boolean flags enabling each elicitation instrument." />
        <SchemaField name="vf_method" type="string" description='"mid-splitting" or "free-edit".' />
        <SchemaField name="input" type="array" description="Criteria and alternatives defining the decision problem." />
        <SchemaField name="computed_weights" type="object" description="{ weight_solutions: { sessionId: [w1, w2, …] } } — populated after Step 1." />
        <SchemaField name="step_results" type="object" description="Keyed by step number (2–6). Populated after each analysis step." />
        <SchemaField name="created_at" type="datetime" description="Creation timestamp." />
      </VStack>

      <SubHeading>Collection: tasks (background jobs)</SubHeading>
      <VStack align="start" spacing={0} divider={<Divider />} w="full" mb={4}>
        <SchemaField name="_id" type="ObjectId" description="Primary key." />
        <SchemaField name="type" type="string" description='"compute_weights" or "run_step".' />
        <SchemaField name="status" type="string" description='"pending" | "running" | "completed" | "failed".' />
        <SchemaField name="params" type="object" description="Input parameters: study_session_id, selected_session_ids, step_number, mc_iterations, aggregation_method, etc." />
        <SchemaField name="console_output" type="string" description="Real-time log text streamed from the worker." />
        <SchemaField name="error" type="string" description="Error message if the task failed." />
        <SchemaField name="created_at / started_at / completed_at" type="datetime" description="Lifecycle timestamps." />
      </VStack>
    </VStack>
  )
}

function ApiPanel() {
  return (
    <VStack align="start" spacing={0} pb={6}>
      <SectionHeading>Health &amp; Admin</SectionHeading>
      <VStack align="start" spacing={0} w="full" divider={<Divider />}>
        <ApiRow method="GET"    path="/api/health"          description="Database connectivity check." />
        <ApiRow method="POST"   path="/api/admin/login"     description="Authenticate admin with ADMIN_PASSWORD." />
      </VStack>

      <SectionHeading>Session Detection</SectionHeading>
      <VStack align="start" spacing={0} w="full" divider={<Divider />}>
        <ApiRow method="GET"  path="/api/session/detect/<session_code>" description="Detect session type (stakeholder / practitioner) and return its ID." />
      </VStack>

      <SectionHeading>Elicitation Sessions (Stakeholder)</SectionHeading>
      <VStack align="start" spacing={0} w="full" divider={<Divider />}>
        <ApiRow method="POST"   path="/api/session"                           description="Create a new elicitation session." />
        <ApiRow method="GET"    path="/api/sessions"                          description="List all elicitation sessions." />
        <ApiRow method="GET"    path="/api/session/<id>"                      description="Retrieve a single session." />
        <ApiRow method="GET"    path="/api/session/by-name/<name>"            description="Look up a session by its code." />
        <ApiRow method="DELETE" path="/api/session/<id>"                      description="Delete a session." />
        <ApiRow method="PUT"    path="/api/session/<id>/lock"                 description="Toggle criteria lock." />
        <ApiRow method="PUT"    path="/api/session/<id>/lock-session"         description="Toggle full session lock." />
        <ApiRow method="PUT"    path="/api/session/<id>/criteria"             description="Update the criteria list." />
        <ApiRow method="PUT"    path="/api/session/<id>/qualitative"          description="Save Qualitative Indicators rankings and confidences." />
        <ApiRow method="PUT"    path="/api/session/<id>/value"                description="Save value function breakpoints." />
        <ApiRow method="PUT"    path="/api/session/<id>/bwt"                  description="Save Weight Elicitation comparison data." />
      </VStack>

      <SectionHeading>Study Sessions (Practitioner)</SectionHeading>
      <VStack align="start" spacing={0} w="full" divider={<Divider />}>
        <ApiRow method="POST"   path="/api/study-session"                               description="Create a new study session." />
        <ApiRow method="GET"    path="/api/study-sessions"                              description="List all study sessions." />
        <ApiRow method="GET"    path="/api/study-session/<id>"                          description="Retrieve a study session." />
        <ApiRow method="GET"    path="/api/study-session/by-code/<code>"                description="Look up a study session by its code." />
        <ApiRow method="PATCH"  path="/api/study-session/<id>"                         description="Update features, quantitative-indicator method, or metadata." />
        <ApiRow method="DELETE" path="/api/study-session/<id>"                          description="Delete a study session." />
        <ApiRow method="PUT"    path="/api/study-session/<id>/input"                   description="Save the input criteria / alternatives." />
        <ApiRow method="GET"    path="/api/study-session/<id>/input"                   description="Retrieve the saved input." />
        <ApiRow method="POST"   path="/api/study-session/<id>/elicitation-session"     description="Create a linked stakeholder session." />
        <ApiRow method="GET"    path="/api/study-session/<id>/elicitation-sessions"    description="List all stakeholder sessions for a study." />
        <ApiRow method="POST"   path="/api/study-session/<id>/reset-sessions"          description="Delete all linked elicitation sessions." />
        <ApiRow method="POST"   path="/api/study-session/<id>/selective-reset"         description="Delete sessions for specific criteria or groups." />
        <ApiRow method="GET"    path="/api/study-session/backup/<id>"                  description="Export a study as a ZIP archive." />
        <ApiRow method="POST"   path="/api/study-session/backup/restore"               description="Restore a study from a ZIP archive." />
      </VStack>

      <SectionHeading>Exports</SectionHeading>
      <VStack align="start" spacing={0} w="full" divider={<Divider />}>
        <ApiRow method="GET" path="/api/session/<id>/value-functions/export"      description="CSV of value-function breakpoints." />
        <ApiRow method="GET" path="/api/session/<id>/value-functions/export-json" description="JSON of value-function breakpoints." />
        <ApiRow method="GET" path="/api/session/<id>/bwt/export"                  description="CSV of Weight Elicitation comparison data." />
        <ApiRow method="GET" path="/api/session/<id>/export-input"               description="CSV of input data per session." />
        <ApiRow method="GET" path="/api/session/<id>/qualitative/export"          description="CSV of qualitative indicator rankings." />
        <ApiRow method="GET" path="/api/session/<id>/pile/export"                 description="CSV of PILE analysis output." />
        <ApiRow method="GET" path="/api/session/<id>/export-all"                  description="ZIP of all session outputs." />
      </VStack>

      <SectionHeading>Workflow (Analysis Tasks)</SectionHeading>
      <VStack align="start" spacing={0} w="full" divider={<Divider />}>
        <ApiRow method="POST" path="/api/study-session/<id>/compute-weights"                  description="Enqueue a weight-computation task." />
        <ApiRow method="POST" path="/api/study-session/<id>/run-step"                         description="Enqueue a MAVT step (2–6)." />
        <ApiRow method="GET"  path="/api/task/<task_id>/status"                               description="Poll task status and console output." />
        <ApiRow method="POST" path="/api/task/<task_id>/cancel"                               description="Cancel a running task." />
        <ApiRow method="GET"  path="/api/study-session/<id>/active-task"                      description="Get the currently running task." />
        <ApiRow method="GET"  path="/api/study-session/<id>/workflow-status"                  description="Get overall workflow state." />
        <ApiRow method="GET"  path="/api/study-session/<id>/weight-solutions/<sid>/export"    description="Export individual session weights." />
        <ApiRow method="GET"  path="/api/study-session/<id>/step-results/<step>"              description="Retrieve step output data." />
      </VStack>
    </VStack>
  )
}

function FileStructurePanel() {
  return (
    <VStack align="start" spacing={0} pb={6}>
      <SectionHeading>Repository layout</SectionHeading>
      <Code fontSize="xs" whiteSpace="pre" p={4} borderRadius="md" bg="gray.50" w="full" overflowX="auto">
{`elicitation-tools/
├── docker-compose.yml          # Service orchestration
├── .env / .env.example         # Non-sensitive settings (never commit .env)
├── secrets/                    # Docker secret files – excluded from version control
├── deployment_notes.md         # Image build & push instructions
│
├── frontend/                   # React + Vite SPA
│   ├── src/
│   │   ├── App.jsx             # Root component – routing & global state
│   │   ├── config.js           # API_URL (VITE_API_URL)
│   │   ├── main.jsx            # React entry point
│   │   ├── components/
│   │   │   ├── Navigation.jsx          # Role-aware nav bar
│   │   │   ├── DistributionModal.jsx   # Visual distribution editor
│   │   │   ├── PdfModal.jsx            # PDF viewer overlay
│   │   │   └── QuestionPrompt.jsx      # Help tooltip
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx               # Session code entry & role detection
│   │   │   ├── DocumentationPage.jsx       # This page
│   │   │   ├── QualitativeIndicatorsPage.jsx  # Stakeholder: Qualitative Indicators tier-list
│   │   │   ├── ValueFunctionsPage.jsx      # Stakeholder: Quantitative Indicators definition
│   │   │   ├── PileBwtPage.jsx             # Stakeholder: Weight Elicitation pairwise
│   │   │   ├── RecapPage.jsx               # Stakeholder: completion summary
│   │   │   ├── InputPage.jsx               # Practitioner: criteria & alternatives
│   │   │   ├── CaseStudyPage.jsx           # Practitioner: session management
│   │   │   ├── RunUpMavtPage.jsx           # Practitioner: run analysis
│   │   │   └── AdminPage.jsx               # Admin: session management
│   │   ├── utils/
│   │   │   └── sessionUtils.js             # Completion-check helpers
│   │   └── test/                           # Vitest test setup
│   └── public/                 # Static assets (PDFs, icons)
│
├── backend/                    # Flask REST API
│   ├── app/
│   │   ├── __init__.py         # Flask app factory
│   │   ├── routes/api.py       # All REST endpoints
│   │   ├── services/           # Business logic (weight computation, etc.)
│   │   └── repositories/       # MongoDB data-access layer
│   ├── requirements.txt
│   └── Dockerfile
│
├── worker/                     # Background task runner
│   ├── scripts/                # MAVT simulation scripts
│   └── Dockerfile
│
└── Agent/                      # AI-assisted development artefacts
    └── modifications.md        # Change history and implementation plans`}
      </Code>

      <SectionHeading>Adding a new elicitation step</SectionHeading>
      <BulletList
        items={[
          '1. Add a new page component under frontend/src/pages/.',
          '2. Register the route in App.jsx inside the appropriate role block.',
          '3. Add a navigation button in Navigation.jsx; wire the feature flag if the step is optional.',
          '4. Add the corresponding backend endpoints in backend/app/routes/api.py.',
          '5. If the step requires background computation, add a new task type in the worker scripts and handle it in the worker polling loop.',
          '6. Store any new result data as a field on the sessions or study_sessions document.',
        ]}
      />

      <SectionHeading>Running locally</SectionHeading>
      <BulletList
        items={[
          'Copy .env.example to .env and set ADMIN_PASSWORD.',
          'Run `docker compose up --build` from the repository root.',
          'The frontend is available at http://localhost:3000.',
          'The backend API is available at http://localhost:5000/api.',
          'Frontend unit tests: cd frontend && npm test.',
          'Backend tests: cd backend && pytest.',
        ]}
      />
    </VStack>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function DocumentationPage() {
  return (
    <Box bg="white" p={8} borderRadius="lg" boxShadow="sm">
      <Heading as="h1" size="lg" mb={1}>
        Documentation
      </Heading>
      <Text fontSize="sm" color="gray.500" mb={6}>
        Software reference for maintainers and contributors of the UP-MAVT Suite.
      </Text>

      <Tabs colorScheme="blue" variant="enclosed" isLazy>
        <TabList flexWrap="wrap">
          <Tab fontSize="sm">Overview</Tab>
          <Tab fontSize="sm">Architecture</Tab>
          <Tab fontSize="sm">User Roles</Tab>
          <Tab fontSize="sm">Core Concepts</Tab>
          <Tab fontSize="sm">Database Schema</Tab>
          <Tab fontSize="sm">API Reference</Tab>
          <Tab fontSize="sm">File Structure</Tab>
        </TabList>

        <TabPanels>
          <TabPanel px={0}><OverviewPanel /></TabPanel>
          <TabPanel px={0}><ArchitecturePanel /></TabPanel>
          <TabPanel px={0}><RolesPanel /></TabPanel>
          <TabPanel px={0}><ConceptsPanel /></TabPanel>
          <TabPanel px={0}><DatabasePanel /></TabPanel>
          <TabPanel px={0}><ApiPanel /></TabPanel>
          <TabPanel px={0}><FileStructurePanel /></TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  )
}

export default DocumentationPage
