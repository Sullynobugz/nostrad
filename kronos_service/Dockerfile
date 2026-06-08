# Build-Context: Projekt-Root (nostrad/)
# docker build -f kronos_service/Dockerfile .

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Dependencies zuerst (besseres Layer-Caching)
COPY kronos_service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Kronos-Repo-Code (Architektur, keine Gewichte)
COPY kronos/ /app/kronos

# Service-Code
COPY kronos_service/app.py /app/app.py

# HuggingFace Cache als Volume
ENV HF_HOME=/app/hf_cache
ENV TRANSFORMERS_CACHE=/app/hf_cache

ENV KRONOS_MODEL_SIZE=small
ENV KRONOS_DEVICE=cpu
ENV KRONOS_SAMPLE_COUNT=5
ENV KRONOS_PRED_LEN=1
ENV PORT=5001

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s \
  CMD curl -f http://localhost:5001/health || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5001", "--workers", "1"]
