# Elicitation Tools

A web application for elicitation data collection. The application provides a multi-step form interface for collecting structured data and exporting results.

## Setup

### Requirements
- Docker and Docker Compose installed

### Running the Application

```bash
docker-compose up --build
```

The application will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **Database**: MongoDB on localhost:27017

### Environment Variables

Set the admin password via the `ADMIN_PASSWORD` environment variable (defaults to `admin123`):

```bash
ADMIN_PASSWORD=your_secure_password docker-compose up --build
```

## Project Structure

```
.
├── backend/                  # Flask REST API
│   ├── app/
│   │   ├── routes/
│   │   │   └── api.py       # API endpoints
│   │   └── __init__.py      # App initialization
│   ├── run.py               # Application entry point
│   ├── requirements.txt     # Python dependencies
│   └── Dockerfile
├── frontend/                # React + Vite frontend
│   ├── src/
│   │   ├── pages/           # Page components
│   │   │   ├── InputPage.jsx
│   │   │   ├── QualitativeIndicatorsPage.jsx
│   │   │   ├── ValueFunctionsPage.jsx
│   │   │   ├── PileBwtPage.jsx
│   │   │   ├── OutputPage.jsx
│   │   │   └── AdminPage.jsx
│   │   ├── components/      # Reusable components
│   │   │   └── Navigation.jsx
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── vite.config.js
│   ├── package.json
│   ├── index.html
│   └── Dockerfile
├── docker-compose.yml       # Multi-container orchestration
├── example_input.csv        # Sample input data
└── README.md
```

## Application Pages

1. **Input Page**: Collect basic user information
2. **Qualitative Indicators Page**: Record qualitative assessment data
3. **Value Functions Page**: Input value function parameters
4. **PILE-BWT Page**: Collect PILE-BWT assessment data
5. **Output Page**: Review results and download CSV export
6. **Admin Page**: Administrative functions

## Data Management

- User responses are stored in MongoDB
- Each session is uniquely identified
- Data persists across application restarts via Docker volumes
- Export functionality generates downloadable CSV files with collected data
