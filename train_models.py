"""Train and compare leakage-safe Track A classifiers."""

from pathlib import Path
import pickle

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


# Fix: Point to the actual location of the dataset
DATA = Path("/home/shreshth/Cardiovascular-Risk-Visualization-Prediction/Datasets/extention of Z-Alizadeh sani dataset.xlsx")
OUTPUT = Path("models")
TARGETS = ["Cath", "LAD", "LCX", "RCA"]
LEAKAGE = {"Cath", "LAD", "LCX", "RCA"}


def make_pipeline_for(X, classifier):
    numeric = X.select_dtypes(include="number").columns
    categorical = X.columns.difference(numeric)
    prep = ColumnTransformer([
        ("numeric", make_pipeline(SimpleImputer(strategy="median"), StandardScaler()), numeric),
        ("categorical", make_pipeline(SimpleImputer(strategy="most_frequent"), OneHotEncoder(handle_unknown="ignore")), categorical),
    ])
    return make_pipeline(prep, classifier)


def main():
    df = pd.read_excel(DATA, sheet_name="Sheet 1 - Table 1")
    df["Sex"] = df["Sex"].replace({"Fmale": "Female"})
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    candidates = {
        "logistic": LogisticRegression(max_iter=2000, class_weight="balanced"),
        "random_forest": RandomForestClassifier(n_estimators=300, class_weight="balanced", random_state=42),
    }
    OUTPUT.mkdir(exist_ok=True)

    for target in TARGETS:
        rows = df[target].astype(str).str.strip().str.lower()
        y = rows.map({"normal": 0, "stenotic": 1, "cad": 1})
        valid = y.notna()
        y = y[valid].astype(int)
        X = df.loc[valid].drop(columns=list(LEAKAGE))
        if y.nunique() != 2 or y.value_counts().min() < 5:
            raise ValueError(f"{target}: need at least 5 examples of each class for 5-fold CV")

        results = []
        for name, classifier in candidates.items():
            model = make_pipeline_for(X, classifier)
            probabilities = cross_val_predict(model, X, y, cv=cv, method="predict_proba")[:, 1]
            predicted = probabilities >= 0.5

            roc_auc = roc_auc_score(y, probabilities)
            results.append((roc_auc, name, {
                "accuracy": accuracy_score(y, predicted),
                "precision": precision_score(y, predicted, zero_division=0),
                "recall": recall_score(y, predicted, zero_division=0),
                "f1": f1_score(y, predicted, zero_division=0),
                "roc_auc": roc_auc,
            }))

        _, best_name, metrics = max(results, key=lambda result: result[0])
        best = make_pipeline_for(X, candidates[best_name]).fit(X, y)
        with (OUTPUT / f"{target.lower()}_model.pkl").open("wb") as f:
            pickle.dump({
                "model": best,
                "features": list(X.columns),
                "positive_label": "CAD" if target == "Cath" else "Stenotic",
            }, f)
        print(f"{target}: selected {best_name}; 5-fold metrics: {metrics}")


if __name__ == "__main__":
    main()