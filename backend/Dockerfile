FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY examples/ /app/examples/
# Workflow export ZIP generation in backend reads these templates/scripts at runtime.
COPY frontend/public/ /app/frontend/public/
COPY worker/scripts/ /app/worker/scripts/

EXPOSE 5000

CMD ["python", "run.py"]
