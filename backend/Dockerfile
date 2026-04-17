FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY examples/ /app/examples/

EXPOSE 5000

CMD ["python", "run.py"]
