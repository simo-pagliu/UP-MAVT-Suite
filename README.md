# UP-MAVT Suite

Open-source web application for Multi-Criteria Decision Analysis (MCDA) under uncertainty, based on the UP-MAVT methodology.

## What is UP-MAVT Suite?

UP-MAVT Suite guides a group of stakeholders through a structured elicitation process to assign weights and preferences to a set of criteria. It then runs a Monte Carlo simulation to produce robust multi-criteria rankings of alternatives under uncertainty.

The application supports three user roles:

- **Stakeholder** – participates in the elicitation workflow (qualitative indicators, value functions, pairwise weight comparison)
- **Practitioner** – sets up the case study, manages stakeholder sessions, and launches the analysis
- **Admin** – manages all studies and sessions through an administration panel

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

**3. Edit `.env` and set your values**

| Variable | Description |
|---|---|
| `ADMIN_PASSWORD` | Password for the admin panel |
| `SMTP_HOST` | SMTP server hostname (leave blank to disable email) |
| `SMTP_PORT` | SMTP port (e.g. `587` for STARTTLS) |
| `SMTP_USER` | SMTP username (or mailbox identity for OAuth2) |
| `SMTP_PASSWORD` | SMTP password (only for `EMAIL_AUTH_MODE=basic`) |
| `EMAIL_AUTH_MODE` | `basic` (default) or `oauth2` (required for Microsoft 365 tenants with basic auth disabled) |
| `OAUTH2_TENANT_ID` | Microsoft Entra tenant ID (for `oauth2`) |
| `OAUTH2_CLIENT_ID` | Microsoft Entra app client ID (for `oauth2`) |
| `OAUTH2_CLIENT_SECRET` | Microsoft Entra app client secret (for `oauth2`) |
| `OAUTH2_SCOPE` | OAuth scope (default `https://outlook.office365.com/.default`) |
| `OAUTH2_TOKEN_URL` | Optional OAuth token endpoint override |
| `OAUTH2_USERNAME` | Optional SMTP identity override for XOAUTH2 (defaults to `SMTP_USER`) |
| `SMTP_USE_TLS` | `true` to use STARTTLS |
| `EMAIL_FROM` | Sender address shown in outgoing emails |
| `APP_BASE_URL` | Public URL of the frontend (e.g. `https://yourdomain.com`) |

**4. Build and start all services**

```bash
docker compose up --build -d
```

**5. Open the application**

Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

---

## User Guide

### Practitioner workflow

1. **Log in** – On the login page, enter your study session ID in the *Practitioner* section and click **Login**.
2. **Define the case study** – Use the *Input Definition* page to configure alternatives, criteria, and enable the elicitation modules (Qualitative Indicators, Value Functions, Pairwise Weight Comparison).
3. **Create stakeholder sessions** – From the same page, generate individual sessions for each stakeholder. Each session gets a unique ID that you share with the participant.
4. **Send invitations** – If email is configured, invitations are sent automatically. Otherwise, share session IDs manually.
5. **Monitor progress** – Track how many stakeholders have completed each step.
6. **Run the analysis** – Once all sessions are complete, go to the *Run UP-MAVT* page and launch the computation. Results appear when the worker finishes.

### Stakeholder workflow

1. **Log in** – On the login page, enter your session ID in the *Stakeholder* section, provide your email address, and complete the email verification step.
2. **Qualitative Indicators** *(if enabled)* – Provide your assessments for qualitative criteria using the guided input form.
3. **Value Functions** *(if enabled)* – Define your preference curves for each criterion.
4. **Pairwise Weight Comparison** *(if enabled)* – Compare pairs of criteria to indicate their relative importance.
5. **Review & Submit** – Check your answers on the recap page and submit when ready.

### Admin panel

Access the admin panel by logging in with the **Admin** option and the `ADMIN_PASSWORD` set in your `.env` file. From there you can:

- View all study sessions and their stakeholder sessions
- Download session data
- Delete studies or individual sessions
- Restore a session from a backup file

---

## Example case studies

The `examples/` folder contains three ready-to-use case studies that can be imported through the Admin panel:

- `example_1.zip` – Case study presented in the software publication (based on PLACEHOLDER)
- `example_2.zip` – Case study presented in the software publication (based on PLACEHOLDER)
- `example_3.zip` – Case study with a hierarchical criteria structure, developed alongside the UP-MAVT methodology (PLACEHOLDER)

---

## Publication

Add the final publication link and DOI here when available.
