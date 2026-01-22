# Elicitation Tools

A proof of concept web application for elicitation data collection.

## Setup

### Requirements
- Docker and Docker Compose installed

### Running the Application

```bash
docker-compose up --build
```

Then open your browser to:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000/api
- **MongoDB**: localhost:27017

## Project Structure

```
.
├── backend/          # Flask backend
│   ├── app/
│   │   ├── routes/
│   │   │   └── api.py    # API routes
│   │   └── __init__.py   # App factory
│   ├── run.py            # Entry point
│   └── requirements.txt
├── frontend/         # React frontend
│   ├── src/
│   │   ├── pages/        # Page components
│   │   ├── components/   # Shared components
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── vite.config.js
│   ├── package.json
│   └── Dockerfile
└── docker-compose.yml
```

## Pages

1. **Input**: User enters their name
2. **Qualitative Indicators**: User enters a number
3. **Value Functions**: User enters a number
4. **PILE-BWT**: User enters a number
5. **Output**: Downloads CSV with results (sum and division)

## Data Flow

- All user inputs are stored in MongoDB
- Each session has a unique ID
- Results are computed on export (sum of 3 numbers, division by 3)
- CSV file is generated and downloaded
