#!/bin/bash
# Kronos-Service lokal starten (ohne Docker)
# Voraussetzung: Python 3.10+, pip

set -e
cd "$(dirname "$0")/../kronos_service"

# Virtualenv anlegen falls nicht vorhanden
if [ ! -d ".venv" ]; then
  echo "📦 Erstelle Python-Virtualenv..."
  python3 -m venv .venv
fi

source .venv/bin/activate

echo "📦 Installiere Dependencies..."
pip install -q -r requirements.txt

echo ""
echo "🔭 Kronos Service startet auf http://localhost:5001"
echo "   Erster Start lädt Modell von HuggingFace (~100MB)..."
echo ""

KRONOS_MODEL_SIZE=${KRONOS_MODEL_SIZE:-small} \
KRONOS_DEVICE=${KRONOS_DEVICE:-cpu} \
uvicorn app:app --host 0.0.0.0 --port 5001 --reload
