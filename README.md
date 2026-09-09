# UP-MAVT Suite

Open-source web application for Multi-Criteria Decision Analysis (MCDA) under uncertainty, based on the UP-MAVT methodology.

UP-MAVT Suite guides a group of stakeholders through a structured elicitation process to assign weights and preferences to a set of criteria, then runs a Monte Carlo simulation to produce robust, uncertainty-aware rankings of alternatives. The software supports three user roles: **Stakeholder** (participates in the elicitation workflow: qualitative indicators, value functions, pairwise weight comparison), **Practitioner** (sets up the case study, manages stakeholder sessions, and launches the analysis), and **Admin** (manages all studies and sessions through an administration panel).

For a complete, start-to-finish walkthrough of using the software, see the [**User Manual**](USER_MANUAL/README.md). This README covers deployment.

---

## Deployment

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

### Steps

**1. Clone the repository**

```bash
git clone https://github.com/simo-pagliu/UP-MAVT-Suite.git
cd UP-MAVT-Suite
```

**2. Create the environment file**

```bash
cp .env.example .env
```

**3. Configure secrets (choose one method)**

The backend supports both direct environment injection and file-based secrets.

Method A: Direct environment injection (recommended when your platform injects env vars)

```env
ADMIN_PASSWORD=${MCDA_UP_ADMIN_PASSWORD}
OAUTH2_CLIENT_SECRET=${MCDA_UP_OAUTH2_SECRET}
```

In this mode, your deployment environment must define `MCDA_UP_ADMIN_PASSWORD` and `MCDA_UP_OAUTH2_SECRET`.

Method B: File-based secrets (`*_FILE`)

Set file path variables so the app reads secrets from files inside the backend container:

```env
ADMIN_PASSWORD_FILE=/run/secrets/admin_password
OAUTH2_CLIENT_SECRET_FILE=/run/secrets/oauth2_client_secret
```

The `docker-compose.yml` backend section already includes these two lines as commented fallback settings. Uncomment them when using file-based secrets, and make sure your deployment mounts the secret files at those paths.

**4. Set remaining `.env` values**

| Variable | Description |
|---|---|
| `ADMIN_PASSWORD` | Admin password consumed by the backend (required unless `ADMIN_PASSWORD_FILE` is used) |
| `ADMIN_PASSWORD_FILE` | Optional file path containing admin password (file-based secret mode) |
| `DISABLE_EMAIL` | Set to `true` to disable the entire email system (default: `false`). When disabled, email verification is skipped during practitioner onboarding, and all transactional emails are suppressed. SMTP/OAuth2 configuration is not required when email is disabled. |
| `SMTP_HOST` | SMTP server hostname (leave blank to disable email, or set `DISABLE_EMAIL=true`) |
| `SMTP_PORT` | SMTP port (e.g. `587` for STARTTLS) |
| `SMTP_USER` | SMTP username (or mailbox identity for OAuth2) |
| `SMTP_PASSWORD` | SMTP password (only for `EMAIL_AUTH_MODE=basic`) |
| `EMAIL_AUTH_MODE` | `basic` (default) or `oauth2` (required for Microsoft 365 tenants with basic auth disabled) |
| `OAUTH2_TENANT_ID` | Microsoft Entra tenant ID (for `oauth2`) |
| `OAUTH2_CLIENT_ID` | Microsoft Entra app client ID (for `oauth2`) |
| `OAUTH2_CLIENT_SECRET` | Microsoft Entra app client secret (for `oauth2`, required unless `OAUTH2_CLIENT_SECRET_FILE` is used) |
| `OAUTH2_CLIENT_SECRET_FILE` | Optional file path containing OAuth2 client secret (file-based secret mode) |
| `OAUTH2_SCOPE` | OAuth scope (default `https://outlook.office365.com/.default`) |
| `OAUTH2_TOKEN_URL` | Optional OAuth token endpoint override |
| `OAUTH2_USERNAME` | Optional SMTP identity override for XOAUTH2 (defaults to `SMTP_USER`) |
| `SMTP_USE_TLS` | `true` to use STARTTLS |
| `EMAIL_FROM` | Sender address shown in outgoing emails |
| `APP_BASE_URL` | Public URL of the frontend (e.g. `https://yourdomain.com`) |
| `VITE_DEBUG_CONSOLE` | Frontend build-time flag (`true`/`false`) to print failed API calls and uncaught JS errors in browser DevTools. Default `false`. |

**5. Build and start all services**

```bash
docker compose up --build -d
```

**6. Open the application**

Navigate to [http://localhost:3000](http://localhost:3000) in your browser. From there, follow the [User Manual](USER_MANUAL/README.md) to create your first case study.

---

## Administration

Log in with the **Admin** option on the landing page, using the password you configured in step 3 above. From the admin panel you can:

- View all study sessions and their stakeholder sessions
- Download session data
- Delete studies or individual sessions
- Restore a session from a backup file

---

## Example case studies

The [`examples/`](examples/) folder contains five case studies, see
[`examples/README.md`](examples/README.md) for the full index. Three are ready to import through
the login page's "Upload a case study (.zip file)" button:

- [`01-port-selection-liang-et-al/`](examples/01-port-selection-liang-et-al/): reference case study, 7 ports, 6 criteria, from Liang, Brunelli & Rezaei (2022), https://doi.org/10.1016/j.ins.2022.07.097
- [`02-port-selection-uncertainty-two-decision-makers/`](examples/02-port-selection-uncertainty-two-decision-makers/): the same problem, extended with input uncertainty, a qualitative criterion, and a second decision-maker
- [`03-nuclear-reactor-hierarchical-uncertain/`](examples/03-nuclear-reactor-hierarchical-uncertain/): a large, self-produced case study, 6 reactor designs, 14 criteria in 4 groups, 3 decision-makers

Two more validate the software's computational engine against published results and
hand-checkable mathematics:

- [`04-tradeoff-elicitation-sun-kroesen-rezaei-2026/`](examples/04-tradeoff-elicitation-sun-kroesen-rezaei-2026/): replicates a published worked example from Sun, Kroesen & Rezaei (2026), https://doi.org/10.1002/bdm.70069
- [`05-analytically-tractable-verification/`](examples/05-analytically-tractable-verification/): a small, self-produced problem with a closed-form expected result

---

## Publication

Add the final publication link and DOI here when available.
