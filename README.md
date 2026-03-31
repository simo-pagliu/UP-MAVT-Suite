# UP-MAVT Suite

Open-source software for Multi-Criteria Decision Analysis under uncertainty, based on the UP-MAVT methodology.

This repository contains a full web deployment with a frontend, backend API, worker, and MongoDB database.

## What this repository provides

- A Docker Compose deployment of the UP-MAVT Suite
- Stakeholder-facing elicitation workflows in the web interface
- A backend API for study, session, and task orchestration
- A worker process for computational tasks
	- Step 1: weight computation
	- Steps 2-6: Monte Carlo simulations

## Architecture

The stack is composed of four services:

- frontend: React + Vite (development target in Compose)
- backend: Flask API
- worker: Python process that polls tasks and executes computations
- mongo: MongoDB 7.0 database

The worker uses MongoDB as shared storage and executes two core analysis modules in worker/scripts:

- weight_space_definition.py
- upmavt.py

## Prerequisites

- Docker
- Docker Compose

## Quick start (local deployment)

1. Create an environment file from the example:

```bash
cp .env.example .env
```

2. Edit .env and set secure values, especially:

- ADMIN_PASSWORD
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_USE_TLS
- EMAIL_FROM
- APP_BASE_URL

3. Build and start all services:

```bash
docker compose up --build -d
```

4. Open the frontend:

- http://localhost:3000

By default in docker-compose.yml, service ports are:

- frontend: 3000
- backend: 5000
- mongo: 27017

## Service configuration summary

### Backend

- Container exposes port 5000
- Reads .env via env_file
- Uses MONGO_URI=mongodb://mongo:27017/elicitation

### Worker

- Connects to MongoDB through the same MONGO_URI
- Restarts unless stopped

### Frontend

- In Compose, it builds from the Dockerfile dev target
- Uses VITE_API_URL=http://localhost:5000/api in Compose runtime env

## Production image builds

For production workflows, build service images explicitly.

### Backend

```bash
cd backend
docker build -t up-mavt-suite-backend .
```

### Frontend (production target)

```bash
cd frontend
docker build --target production -t up-mavt-suite-frontend .
```

### Worker

```bash
cd worker
docker build -t up-mavt-suite-worker .
```

Note:

- Frontend production image uses nginx and serves the built dist assets.
- The frontend Dockerfile supports a build argument VITE_API_URL (default: /api).

## Development notes

- Frontend scripts (from frontend/package.json):
	- npm run dev
	- npm run build
	- npm run preview
	- npm run test

- Backend entrypoint runs run.py and starts Flask on 0.0.0.0:5000.

## Examples

The examples folder currently contains:

- example_1.zip 
- example_2.zip
- example_3.zip

These archives are example case studies for the UI workflow. Examples 1 and 2 are presented in this software publication and are based on the work of PLACEHOLDER. The third example has a hierarchical structure and was developed alongside the UP-MAVT methodology in this master's thesis PLACEHOLDER.

## Publication

Add the final publication link and DOI here when available.
