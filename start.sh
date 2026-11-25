#!/usr/bin/env bash
# Start the SmartFix backend (FastAPI on :8000) and frontend (Vite on :5173) together.
# Needs Postgres+PostGIS, RabbitMQ and Ollama running (see README).
# Works on Linux, macOS, and Windows (run from Git Bash or WSL).
set -e
cd "$(dirname "$0")"
trap 'kill 0' EXIT

# The venv layout differs by OS: bin/ on Linux/macOS, Scripts/ on Windows.
if [ -f backend/.venv/bin/python ]; then
  PY=.venv/bin/python
elif [ -f backend/.venv/Scripts/python.exe ]; then
  PY=.venv/Scripts/python.exe
else
  echo "No virtualenv found in backend/.venv. Create it first (see README)." >&2
  exit 1
fi

(cd backend && "$PY" -m uvicorn app.main:app --port 8000 --reload) &
(cd frontend && npx vite --port 5173) &
wait
