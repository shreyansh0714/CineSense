# CineSense — FastAPI + static frontend in one container
FROM python:3.12-slim

WORKDIR /srv

# Install deps first so this layer caches across code changes
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY static ./static

# App Runner's default port
EXPOSE 8080

# ANTHROPIC_API_KEY is injected at runtime (App Runner env config / docker run -e)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
