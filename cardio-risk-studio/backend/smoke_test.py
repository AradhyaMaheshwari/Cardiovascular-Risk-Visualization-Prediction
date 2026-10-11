"""Smoke-test the Cardio Risk Studio API without starting a network server.

Run from the backend directory after installing requirements:
    python smoke_test.py
Optional (slower; calculates Kernel SHAP where supported):
    python smoke_test.py --explain
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from fastapi.testclient import TestClient

# Keep the serialized pipelines' custom common.FE class importable.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import main  # noqa: E402


def main_test() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--explain", action="store_true", help="also test the slower explainability endpoint")
    args = parser.parse_args()

    failures: list[str] = []
    with TestClient(main.app) as client:
        health = client.get("/api/health")
        if health.status_code != 200:
            failures.append(f"/api/health returned {health.status_code}")
        else:
            body = health.json()
            if not body.get("models_loaded") or body.get("input_features") != 55:
                failures.append(f"Unexpected health payload: {body}")

        schema_response = client.get("/api/schema")
        if schema_response.status_code != 200:
            failures.append(f"/api/schema returned {schema_response.status_code}")
            schema = {}
        else:
            schema = schema_response.json()
            if len(schema.get("fields", [])) != 55:
                failures.append("Expected exactly 55 input fields in schema")

        demo_response = client.get("/api/demo")
        if demo_response.status_code != 200:
            failures.append(f"/api/demo returned {demo_response.status_code}")
            features = {}
        else:
            features = demo_response.json().get("features", {})
            if len(features) != 55:
                failures.append(f"Expected 55 demo inputs; received {len(features)}")

        predict_response = client.post("/api/predict", json={"features": features, "synthetic": True})
        if predict_response.status_code != 200:
            failures.append(f"/api/predict returned {predict_response.status_code}: {predict_response.text[:300]}")
        else:
            predictions = predict_response.json().get("predictions", {})
            for target in ("Cath", "LAD", "LCX", "RCA"):
                prediction = predictions.get(target)
                if not prediction:
                    failures.append(f"Prediction missing for {target}")
                elif not (0 <= float(prediction["score"]) <= 1):
                    failures.append(f"Invalid score for {target}: {prediction['score']}")
            print("Synthetic demo predictions:")
            for target, prediction in predictions.items():
                print(
                    f"  {target}: score={prediction['score']:.3f}, "
                    f"threshold={prediction['threshold']:.2f}, class={prediction['prediction']}"
                )

        bad_features = {**features, "Cath": 1}
        leak_response = client.post("/api/predict", json={"features": bad_features})
        if leak_response.status_code != 422:
            failures.append("API did not reject target leakage (extra 'Cath' input)")

        for path in ("/", "/assets/styles.css", "/assets/app.js", "/assets/heart3d.js", "/assets/heartFallback.js"):
            response = client.get(path)
            if response.status_code != 200:
                failures.append(f"{path} returned {response.status_code}")

        if args.explain and features:
            explain_response = client.post(
                "/api/explain",
                json={"features": features, "target": "Cath", "max_features": 5, "nsamples": 64},
            )
            if explain_response.status_code != 200:
                failures.append(f"/api/explain returned {explain_response.status_code}: {explain_response.text[:300]}")
            else:
                print(f"Explanation method: {explain_response.json().get('method')}")

    if failures:
        print("\nSMOKE TEST FAILED")
        for failure in failures:
            print(f" - {failure}")
        return 1
    print("\nSMOKE TEST PASSED: UI routes, schema, four model predictions, and leakage rejection.")
    if args.explain:
        print("Explainability endpoint also tested.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main_test())
