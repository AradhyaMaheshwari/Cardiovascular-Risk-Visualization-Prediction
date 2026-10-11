"""FastAPI service for the Cardio Risk Studio prototype.

Loads the user's finalized sklearn pipelines, validates and normalizes the 55
expected input features, and serves predictions plus approximate Kernel SHAP
explanations. The API intentionally does not persist incoming patient inputs.
"""
from __future__ import annotations

import json
import logging
import math
import sys
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Literal

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# The serialized pipelines refer to common.FE, so keep backend/common.py beside
# this module and run uvicorn from the backend directory (see README).
from common import FE  # noqa: F401  Ensures the pickle's custom class is importable.

APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
ASSETS_DIR = FRONTEND_DIR / "assets"
CONFIG_DIR = APP_DIR / "config"
MODEL_DIR = APP_DIR / "models"
TARGETS = ["Cath", "LAD", "LCX", "RCA"]
DISPLAY_NAMES = {
    "Cath": "Overall CAD",
    "LAD": "LAD · Left anterior descending",
    "LCX": "LCX · Left circumflex",
    "RCA": "RCA · Right coronary artery",
}

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cardio-risk-studio")

FEATURES: list[str] = json.loads((CONFIG_DIR / "feature_columns.json").read_text(encoding="utf-8"))
THRESHOLDS: dict[str, float] = json.loads((CONFIG_DIR / "thresholds.json").read_text(encoding="utf-8"))
SCHEMA: dict[str, Any] = json.loads((CONFIG_DIR / "feature_schema.json").read_text(encoding="utf-8"))
DEMO_PROFILE: dict[str, Any] = json.loads((CONFIG_DIR / "demo_profile.json").read_text(encoding="utf-8"))
CV_METRICS: dict[str, Any] = json.loads((CONFIG_DIR / "cv_metrics.json").read_text(encoding="utf-8"))
REFERENCE_PROFILE: dict[str, Any] = json.loads((CONFIG_DIR / "reference_profile.json").read_text(encoding="utf-8"))
BACKGROUND_PATH = CONFIG_DIR / "background_features.csv"
BACKGROUND = pd.read_csv(BACKGROUND_PATH).reindex(columns=FEATURES).astype(float)

BINARY_FEATURES = {
    "DM", "HTN", "Current Smoker", "EX-Smoker", "FH", "Obesity", "CRF", "CVA",
    "Airway disease", "Thyroid Disease", "CHF", "DLP", "Edema", "Weak Peripheral Pulse",
    "Lung rales", "Systolic Murmur", "Diastolic Murmur", "Typical Chest Pain", "Dyspnea",
    "Atypical", "Nonanginal", "Exertional CP", "LowTH Ang", "Q Wave", "St Elevation",
    "St Depression", "Tinversion", "LVH", "Poor R Progression",
}
FIELD_BY_KEY = {f["key"]: f for f in SCHEMA["fields"]}

models: dict[str, Any] = {}
explainer_cache: dict[str, Any] = {}

app = FastAPI(
    title="Cardio Risk Studio API",
    description=(
        "Educational cardiovascular modeling prototype. Outputs are model-estimated scores; "
        "they are not diagnoses or validated clinical probabilities."
    ),
    version="1.0.0",
)
app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")


class PredictRequest(BaseModel):
    features: Dict[str, Any]
    synthetic: bool = False


class ExplainRequest(BaseModel):
    features: Dict[str, Any]
    target: Literal["Cath", "LAD", "LCX", "RCA"] = "Cath"
    max_features: int = Field(default=8, ge=3, le=15)
    nsamples: int = Field(default=128, ge=64, le=256)


def load_models() -> None:
    """Load all finalized pipelines at process startup."""
    global models
    if models:
        return
    loaded: dict[str, Any] = {}
    for target in TARGETS:
        path = MODEL_DIR / f"{target}_model.pkl"
        if not path.exists():
            raise FileNotFoundError(f"Expected model file is missing: {path}")
        loaded[target] = joblib.load(path)
    models = loaded
    logger.info("Loaded four model pipelines: %s", ", ".join(models))


@app.on_event("startup")
def startup_event() -> None:
    load_models()


def _number(value: Any, feature: str) -> float:
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ValueError(f"{feature}: enter a value.")
    try:
        val = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{feature}: expected a numeric value.") from None
    if not math.isfinite(val):
        raise ValueError(f"{feature}: value must be finite.")
    field = FIELD_BY_KEY.get(feature, {})
    lo, hi = field.get("min"), field.get("max")
    if lo is not None and val < float(lo):
        raise ValueError(f"{feature}: must be at least {lo}.")
    if hi is not None and val > float(hi):
        raise ValueError(f"{feature}: must be no greater than {hi}.")
    return val


def _binary_value(value: Any, feature: str) -> float:
    if isinstance(value, str):
        s = value.strip().lower()
        if s in {"1", "y", "yes", "true", "present", "positive"}:
            return 1.0
        if s in {"0", "n", "no", "false", "absent", "negative"}:
            return 0.0
    val = _number(value, feature)
    if val not in (0.0, 1.0):
        raise ValueError(f"{feature}: choose No or Yes.")
    return val


def normalize_features(payload: Dict[str, Any]) -> pd.DataFrame:
    """Reproduce the encodings used by common.load() before model inference."""
    missing = [c for c in FEATURES if c not in payload]
    extra = sorted(set(payload) - set(FEATURES))
    if missing:
        preview = ", ".join(missing[:6])
        more = " …" if len(missing) > 6 else ""
        raise ValueError(f"Missing {len(missing)} required feature(s): {preview}{more}")
    if extra:
        raise ValueError(
            "Unexpected input column(s): " + ", ".join(extra[:8]) +
            ". Only the 55 training input features are accepted; target labels cannot be inputs."
        )

    row: dict[str, float] = {}
    for feature in FEATURES:
        value = payload[feature]
        if feature in BINARY_FEATURES:
            # The uploaded training pipeline receives numerical 0/1 values.
            row[feature] = _binary_value(value, feature)
        elif feature == "Sex":
            if isinstance(value, str):
                s = value.strip().lower()
                if s in {"male", "m"}:
                    row[feature] = 1.0
                elif s in {"female", "f", "fmale", "woman"}:
                    row[feature] = 0.0
                else:
                    raise ValueError("Sex: choose Male or Female.")
            else:
                row[feature] = _number(value, feature)
                if row[feature] not in (0.0, 1.0):
                    raise ValueError("Sex: choose Male or Female.")
        elif feature == "BBB":
            if isinstance(value, str):
                s = value.strip().lower()
                if s in {"n", "none", "no", "0", "absent"}:
                    row[feature] = 0.0
                elif s in {"lbbb", "rbbb", "y", "yes", "present", "1"}:
                    row[feature] = 1.0
                else:
                    raise ValueError("BBB: choose None, LBBB or RBBB.")
            else:
                row[feature] = _binary_value(value, feature)
        elif feature == "VHD":
            if isinstance(value, str):
                s = value.strip().lower()
                vals = {"n": 0.0, "none": 0.0, "no": 0.0, "mild": 1.0, "moderate": 2.0, "severe": 3.0}
                if s not in vals:
                    raise ValueError("VHD: choose None, Mild, Moderate or Severe.")
                row[feature] = vals[s]
            else:
                val = _number(value, feature)
                if val not in (0.0, 1.0, 2.0, 3.0):
                    raise ValueError("VHD: choose None, Mild, Moderate or Severe.")
                row[feature] = val
        else:
            row[feature] = _number(value, feature)

    # This feature is constant in every training record. Do not allow users to
    # ask the model to extrapolate from a value that was never observed.
    if row["Exertional CP"] != 0.0:
        raise ValueError("Exertional CP is fixed to No because it is constant in the training data.")

    if row["Function Class"] not in (0.0, 1.0, 2.0, 3.0):
        raise ValueError("Function Class must be one of 0, 1, 2 or 3.")
    if row["Region RWMA"] not in (0.0, 1.0, 2.0, 3.0, 4.0):
        raise ValueError("Region RWMA must be a code from 0 to 4.")

    if row["Length"] <= 0:
        raise ValueError("Height must be greater than zero.")
    # BMI was derived this way in the source worksheet, so keep it consistent.
    row["BMI"] = row["Weight"] / (row["Length"] / 100.0) ** 2
    if not math.isfinite(row["BMI"]):
        raise ValueError("BMI could not be computed from height and weight.")
    return pd.DataFrame([[row[c] for c in FEATURES]], columns=FEATURES, dtype=float)


def score_target(target: str, frame: pd.DataFrame) -> dict[str, Any]:
    model = models[target]
    try:
        class_index = list(model.classes_).index(1)
    except (AttributeError, ValueError):
        raise RuntimeError(f"Model {target} does not expose positive class 1.")
    score = float(model.predict_proba(frame)[0, class_index])
    threshold = float(THRESHOLDS[target])
    positive = bool(score >= threshold)
    metric = CV_METRICS.get(target, {})
    return {
        "target": target,
        "name": DISPLAY_NAMES[target],
        "score": score,
        "threshold": threshold,
        "prediction": int(positive),
        "classification": "Above threshold" if positive else "Below threshold",
        "class_label": "Positive class" if positive else "Negative class",
        "cv_roc_auc": metric.get("roc_auc"),
        "cv_balanced_accuracy": metric.get("balanced_accuracy"),
    }


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/cullet", include_in_schema=False)
def cullet() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "cullet.html")


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "models_loaded": len(models) == 4,
        "targets": TARGETS,
        "input_features": len(FEATURES),
        "model_family": "Soft-voting ensemble pipelines",
        "explainability": "Kernel SHAP with a local sensitivity fallback",
    }


@app.get("/api/schema")
def schema() -> dict[str, Any]:
    return {
        **SCHEMA,
        "thresholds": THRESHOLDS,
        "cvMetrics": CV_METRICS,
        "modelFamily": "Soft-voting ensemble pipelines",
        "trainingFeatureCount": len(FEATURES),
    }


@app.get("/api/demo")
def demo() -> dict[str, Any]:
    return {"features": {k: v for k, v in DEMO_PROFILE.items() if k != "synthetic"}, "synthetic": True}


@app.post("/api/predict")
def predict(request: PredictRequest) -> dict[str, Any]:
    try:
        frame = normalize_features(request.features)
        outputs = {target: score_target(target, frame) for target in TARGETS}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Prediction request failed")
        raise HTTPException(status_code=500, detail="Prediction failed. Check the server logs.") from exc
    return {
        "request_id": str(uuid.uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "synthetic": request.synthetic,
        "predictions": outputs,
        "feature_count": len(FEATURES),
        "notice": "Model-estimated scores for educational demonstration only; not a diagnosis or validated clinical probabilities.",
    }


def _shap_values(target: str, frame: pd.DataFrame, nsamples: int) -> tuple[np.ndarray, float, str]:
    """Return approximate Kernel SHAP values, falling back to reference sensitivity."""
    model = models[target]
    background = BACKGROUND.to_numpy(dtype=float)
    instance = frame.to_numpy(dtype=float)

    try:
        import shap  # Lazy import keeps normal prediction startup lightweight.

        explainer = explainer_cache.get(target)
        if explainer is None:
            def predict_positive(x: np.ndarray) -> np.ndarray:
                x2 = np.asarray(x, dtype=float)
                if x2.ndim == 1:
                    x2 = x2.reshape(1, -1)
                Xdf = pd.DataFrame(x2, columns=FEATURES)
                return model.predict_proba(Xdf)[:, list(model.classes_).index(1)]
            explainer = shap.KernelExplainer(predict_positive, background, link="identity")
            explainer_cache[target] = explainer

        values = explainer.shap_values(instance, nsamples=nsamples, silent=True, l1_reg=f"num_features({min(10, nsamples // 8)})")
        if isinstance(values, list):
            values = values[0]
        arr = np.asarray(values, dtype=float)
        if arr.ndim == 3:
            arr = arr[0, :, -1]
        elif arr.ndim == 2:
            arr = arr[0]
        elif arr.ndim != 1:
            raise ValueError(f"Unexpected SHAP output shape {arr.shape}")
        expected = np.asarray(explainer.expected_value, dtype=float).reshape(-1)
        base_value = float(expected[-1])
        if len(arr) != len(FEATURES) or not np.isfinite(arr).all():
            raise ValueError("SHAP returned invalid feature contributions.")
        return arr, base_value, f"Kernel SHAP (approximate; nsamples={nsamples})"
    except Exception as exc:
        logger.warning("Kernel SHAP failed for %s; using reference sensitivity: %s", target, exc)
        # Honest fallback: score delta when replacing one input with the
        # reference profile. This is not SHAP and is labeled as such in output.
        base = pd.DataFrame([[float(REFERENCE_PROFILE[c]) for c in FEATURES]], columns=FEATURES)
        base_score = float(model.predict_proba(base)[0, list(model.classes_).index(1)])
        current_score = float(model.predict_proba(frame)[0, list(model.classes_).index(1)])
        deltas = np.zeros(len(FEATURES), dtype=float)
        row = frame.iloc[0].copy()
        for i, c in enumerate(FEATURES):
            altered = frame.copy()
            altered.loc[altered.index[0], c] = float(REFERENCE_PROFILE[c])
            altered_score = float(model.predict_proba(altered)[0, list(model.classes_).index(1)])
            deltas[i] = current_score - altered_score
        return deltas, base_score, "Reference-profile sensitivity (fallback; not SHAP)"


@app.post("/api/explain")
def explain(request: ExplainRequest) -> dict[str, Any]:
    try:
        frame = normalize_features(request.features)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        score = float(models[request.target].predict_proba(frame)[0, list(models[request.target].classes_).index(1)])
        values, base_value, method = _shap_values(request.target, frame, request.nsamples)
        order = np.argsort(np.abs(values))[::-1][: request.max_features]
        contributions = []
        for idx in order:
            key = FEATURES[int(idx)]
            field = FIELD_BY_KEY.get(key, {})
            contributions.append({
                "key": key,
                "label": field.get("label", key),
                "value": float(values[idx]),
                "direction": "increases score vs baseline" if values[idx] > 0 else "decreases score vs baseline" if values[idx] < 0 else "near baseline",
                "patient_value": float(frame.iloc[0][key]),
                "reference_value": float(REFERENCE_PROFILE[key]),
            })
        return {
            "target": request.target,
            "target_name": DISPLAY_NAMES[request.target],
            "score": score,
            "base_value": base_value,
            "method": method,
            "nsamples": request.nsamples,
            "contributions": contributions,
            "notice": "Approximate model explanation. Contributions describe model behavior relative to its background data and are not causal effects or clinical evidence.",
        }
    except Exception as exc:
        logger.exception("Explanation request failed")
        raise HTTPException(status_code=500, detail="Could not generate an explanation for this input. Try again or use the model score without explanations.") from exc


# Export a simple static deployment health view through /docs and /openapi.json.
