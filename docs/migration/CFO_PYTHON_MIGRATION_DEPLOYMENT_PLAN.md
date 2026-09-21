# CFO YANTRA — CLOUD DEPLOYMENT & PRODUCTION DEVOPS PLAN

## Executive Summary
This document specifies the containerized production deployment architecture for CFO Yantra in multi-tenant cloud environments. It details the multi-stage Dockerfile, Docker Compose topology, Nginx reverse proxy configuration for HTTP and Socket.io, and worker scaling controls.

---

## 1. Multi-Stage Production Dockerfile

```dockerfile
# Stage 1: Build & Dependencies
FROM python:3.12-slim-bookworm AS builder

WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY python_backend/requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Minimal Runtime Image
FROM python:3.12-slim-bookworm AS runner

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/root/.local/bin:$PATH

COPY --from=builder /root/.local /root/.local
COPY python_backend/app /app/app
COPY python_backend/run.py /app/run.py

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["python", "run.py", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```

---

## 2. Docker Compose Topology

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      - DATABASE_URL=postgresql+asyncpg://postgres:secret@postgres:5432/cfo_yantra
      - JWT_SECRET=${JWT_SECRET}
      - ENABLE_BACKGROUND_JOBS=false
      - WORKERS=4
    ports:
      - "8000:8000"
    depends_on:
      - postgres
      - redis

  worker:
    build:
      context: .
      dockerfile: Dockerfile
    command: ["python", "run.py", "--mode", "worker-only"]
    environment:
      - DATABASE_URL=postgresql+asyncpg://postgres:secret@postgres:5432/cfo_yantra
      - ENABLE_BACKGROUND_JOBS=true
      - WORKERS=1
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: cfo_yantra
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

---

## 3. Nginx Reverse Proxy Configuration (Socket.io & API Routing)

```nginx
server {
    listen 80;
    server_name api.cfoyantra.com;

    location /socket.io/ {
        proxy_pass http://api:8000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        proxy_pass http://api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
