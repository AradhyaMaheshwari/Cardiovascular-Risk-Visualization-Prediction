# Render quick deployment

Use the repository root as the service root. `render.yaml` is included.

- Build: `pip install -r backend/requirements.txt && cd frontend && npm ci && npm run build`
- Start: `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`
- Health check: `/api/health`

The web app and API are served from the same service. FastAPI serves the built React navigation from `frontend/dist` and the existing dashboard assets from `frontend/assets`. React UI components belong in `frontend/src/components/ui`; the `@/components/ui` alias resolves there.
