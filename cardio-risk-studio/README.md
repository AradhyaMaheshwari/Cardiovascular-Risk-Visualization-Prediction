# Cardio Risk Studio

An interactive cardiovascular modeling prototype that serves the four finalized user-provided scikit-learn pipelines, provides a clinical-feature intake drawer, and maps model outputs onto a procedurally generated interactive 3D coronary-heart schematic.

> **Educational prototype only.** Model-estimated scores and threshold classifications are not diagnoses, are not validated clinical risk probabilities, and must not be used to direct patient care. The 3D heart is a stylized schematic; this dataset does not locate individual lesions within anatomy.

## What's included

- **Web UI:** responsive dashboard, patient input workflow for all 55 expected model features, four output cards, cross-validation model card, score inspector, and explainability panel.
- **3D renderer:** Three.js/WebGL scene with rotatable/zoomable heart and separately selectable LAD, LCX, and RCA tubes. Vessel tube colors respond to the corresponding model score. If the Three.js CDN cannot be reached, an interactive vector schematic fallback is used.
- **API:** FastAPI endpoints for health, schema, synthetic demo profile, model prediction, and approximate Kernel SHAP explanation.
- **Final model pipelines:** the four `.pkl` files supplied in this conversation, with `common.py` retained beside the backend to provide the custom `FE` transformer referenced by the pickles.
- **Configuration:** feature order, thresholds, input schema, user-provided CV metrics, a synthetic reference profile, and 24 feature-only background rows for SHAP.

## Run locally on Windows

Use Python 3.12 and an internet connection for package installation and (for full WebGL) loading Three.js from the CDN.

1. Extract the project ZIP.
2. Open PowerShell in the extracted `cardio-risk-studio` folder.
3. Create and activate a virtual environment:

   ```powershell
   py -3.12 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

4. Install backend dependencies:

   ```powershell
   python -m pip install --upgrade pip
   python -m pip install -r backend/requirements.txt
   ```

5. Start the app from the backend folder:

   ```powershell
   cd backend
   python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
   ```

6. Open **http://127.0.0.1:8000**. The API docs are at **http://127.0.0.1:8000/docs**.

The Cullet hot-glass landing page is available at **http://127.0.0.1:8000/cullet**.

Run `uvicorn` from the `backend` directory because the serialized models reference the custom Python transformer as `common.FE`. Do not remove or rename `backend/common.py` unless you intentionally migrate/re-save the pipelines.

## Test the service

With the virtual environment activated, run `cd backend` followed by `python smoke_test.py` for a compact API/model smoke test. Use `python smoke_test.py --explain` to additionally exercise the slower explanation endpoint.

- `GET /api/health` — backend and model load status.
- `GET /api/schema` — feature definitions, CV metrics, and thresholds.
- `GET /api/demo` — synthetic median/mode-like example profile.
- `POST /api/predict` — four model scores and classifications.
- `POST /api/explain` — approximate Kernel SHAP explanation for one selected target.

The demo profile is synthetic and must remain labelled as such. Inputs are not persisted by this app; the current implementation does not save patient submissions to a database or log request payloads.

## Deployment to Render

This repository is designed as a single web service: FastAPI serves both the JSON API and the static frontend on the same origin. That avoids a separate frontend build and avoids CORS configuration for the standard deployment.

1. Push the complete extracted folder to a GitHub repository. Keep `backend/models/`, `backend/common.py`, and `backend/config/` in the repository because they are required at runtime.
2. In Render, create a new **Web Service** and connect the repository.
3. Set the build command to:

   ```bash
   pip install -r backend/requirements.txt
   ```

4. Set the start command to:

   ```bash
   cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT
   ```

5. Set the health check path to `/api/health`.
6. Deploy. Once it is live, open the service URL and check `/api/health` before testing a prediction.

A `render.yaml` Blueprint file is included for reference. If deploying using Render's Blueprint workflow, review the service name and settings before creating the service.

## Model and feature handling

- The API accepts exactly the 55 input columns in `backend/config/feature_columns.json`; it rejects extra target columns to avoid target leakage.
- The API reproduces the training encodings for Sex, yes/no fields, BBB, and VHD; model pipelines perform their saved feature engineering and preprocessing.
- BMI is recomputed from Weight and Length, as in the source data.
- `Exertional CP` is fixed to No because this feature was constant in the training workbook.
- Thresholds in `backend/config/thresholds.json` are the supplied training/CV thresholds: Cath 0.65, LAD 0.49, LCX 0.39, RCA 0.35.
- The displayed CV ROC-AUC values come from the supplied `cv_metrics.csv`; they are development cross-validation results, not external validation or independent test performance.
- The score is displayed on a 0–100 visual scale for convenience. It must not be read as a calibrated clinical probability.

## 3D scene notes

The heart mesh and great vessels are generated in Three.js, with separate user-selectable coronary tubes for LAD, LCX, and RCA. They are positioned for visualization only. Model outputs are target-level classifications/scores, not spatial lesion labels, so the renderer does **not** claim to locate stenoses or depict measured narrowing.

Three.js is imported from jsDelivr by `frontend/index.html`. If you want a fully offline build, vendor the same Three.js version and its controls module into the project and update the import map. The fallback schematic still renders if the CDN cannot be loaded, but the full WebGL scene requires the CDN.

## Explainability notes

The explain button uses `shap.KernelExplainer` with a 24-row feature-only background sample and a bounded approximate sample count. This can take a few seconds. If SHAP fails at runtime, the API falls back to a clearly labelled reference-profile sensitivity calculation; that fallback is **not SHAP**. Feature contributions describe model behaviour, not causation.

## Important operational notes

- Do not upload real patient-identifiable information to a public demo. The app is not security-reviewed for clinical use.
- Do not describe the prototype as clinically validated.
- Keep the held-out test results, cross-validation results, and model-score estimates distinct in project documentation.
- Keep model artifacts and the source training encoder code versioned together.
