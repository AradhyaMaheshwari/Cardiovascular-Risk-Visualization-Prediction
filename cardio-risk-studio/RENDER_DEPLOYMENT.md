# Render quick deployment

Use the repository root as the service root. `render.yaml` is included.

- Build: `pip install -r backend/requirements.txt`
- Start: `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`
- Health check: `/api/health`

The web app and API are served from the same service. `main.py` serves `frontend/index.html`, so there is no separate frontend build step.
