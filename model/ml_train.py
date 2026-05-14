"""Train and evaluate classifiers against rule-derived labels."""

from __future__ import annotations

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, f1_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler

FEATURES = ["temperature", "heart_rate", "spo2"]


def build_preprocess() -> ColumnTransformer:
    return ColumnTransformer(
        [("scale", StandardScaler(), FEATURES)],
        remainder="drop",
    )


def _split_metrics(y_test, pred, le: LabelEncoder) -> dict[str, float | str]:
    acc = accuracy_score(y_test, pred)
    f1_macro = float(f1_score(y_test, pred, average="macro", zero_division=0))
    classes = list(le.classes_)
    if "ALERT" in classes:
        alert_idx = classes.index("ALERT")
        y_alert = (y_test == alert_idx).astype(int)
        pred_alert = (pred == alert_idx).astype(int)
        alert_recall = float(recall_score(y_alert, pred_alert, zero_division=0))
    else:
        alert_recall = 0.0
    report = classification_report(
        y_test,
        pred,
        target_names=le.classes_,
        zero_division=0,
    )
    return {
        "accuracy": acc,
        "macro_f1": f1_macro,
        "alert_recall": alert_recall,
        "report": report,
    }


def train_and_evaluate(df: pd.DataFrame, target_col: str = "rule_status", random_state: int = 42):
    """Fit **logistic regression** only (production / bundle path)."""
    X = df[FEATURES]
    y = df[target_col].astype(str)
    le = LabelEncoder()
    y_enc = le.fit_transform(y)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y_enc, test_size=0.25, stratify=y_enc, random_state=random_state
    )

    name = "logistic_regression"
    clf = LogisticRegression(max_iter=1000, random_state=random_state)
    pipe = Pipeline([("prep", build_preprocess()), ("clf", clf)])
    pipe.fit(X_train, y_train)
    pred = pipe.predict(X_test)
    results = {name: _split_metrics(y_test, pred, le)}
    fitted = {name: pipe}

    return {
        "label_encoder": le,
        "results": results,
        "models": fitted,
        "X_test": X_test,
        "y_test": y_test,
    }


def train_model_comparison(df: pd.DataFrame, target_col: str = "rule_status", random_state: int = 42):
    """
    Same split as production training, but fit several algorithms for **EDA / Jupyter only**.
    The app and `model_bundle.joblib` still use logistic regression from `train_and_evaluate`.
    """
    X = df[FEATURES]
    y = df[target_col].astype(str)
    le = LabelEncoder()
    y_enc = le.fit_transform(y)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y_enc, test_size=0.25, stratify=y_enc, random_state=random_state
    )

    classifiers: list[tuple[str, object]] = [
        ("logistic_regression", LogisticRegression(max_iter=1000, random_state=random_state)),
        (
            "random_forest",
            RandomForestClassifier(
                n_estimators=120,
                max_depth=14,
                random_state=random_state,
                n_jobs=-1,
            ),
        ),
        (
            "hist_gradient_boosting",
            HistGradientBoostingClassifier(
                max_iter=120,
                max_depth=6,
                learning_rate=0.08,
                random_state=random_state,
            ),
        ),
    ]

    results: dict[str, dict] = {}
    fitted: dict[str, Pipeline] = {}

    for name, clf in classifiers:
        pipe = Pipeline([("prep", build_preprocess()), ("clf", clf)])
        pipe.fit(X_train, y_train)
        pred = pipe.predict(X_test)
        results[name] = _split_metrics(y_test, pred, le)
        fitted[name] = pipe

    return {
        "label_encoder": le,
        "results": results,
        "models": fitted,
        "X_test": X_test,
        "y_test": y_test,
    }


def choose_best_model(results: dict[str, dict]) -> str:
    """Pick model by highest macro_f1, then alert_recall, then accuracy (for comparison tables)."""
    if not results:
        raise ValueError("results must not be empty")

    def score_tuple(model_name: str) -> tuple[float, float, float]:
        r = results[model_name]
        return (
            float(r.get("macro_f1", 0.0)),
            float(r.get("alert_recall", 0.0)),
            float(r.get("accuracy", 0.0)),
        )

    return max(results.keys(), key=score_tuple)
