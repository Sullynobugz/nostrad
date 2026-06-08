#!/bin/bash
# Lokale Entwicklungsumgebung starten
# Startet Backend + Dashboard gleichzeitig

set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "⚠️  Keine .env gefunden — kopiere .env.example"
  cp .env.example .env
  echo "→ Bitte .env mit API-Keys befüllen und erneut ausführen"
  exit 1
fi

echo "🔭 Nostrad Dev-Start"
echo "   Backend:   http://localhost:3000"
echo "   Dashboard: http://localhost:5173"
echo ""

# Backend + Dashboard parallel starten
npm run dev &
BACKEND_PID=$!

cd apps/dashboard
npm run dev &
DASHBOARD_PID=$!

trap "kill $BACKEND_PID $DASHBOARD_PID 2>/dev/null" EXIT
wait
