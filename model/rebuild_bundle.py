"""Rebuild model_bundle.joblib using current Python/sklearn versions."""

from __future__ import annotations

from pathlib import Path

import joblib
import pandas as pd

from health_rules import rule_status_series
from ml_train import train_and_evaluate
from preprocessing import clean_frame
from sample_data import ensure_sample_csv


def load_dataset(data_path: Path) -> pd.DataFrame:
    if not data_path.exists():
        ensure_sample_csv(data_path, n=800)
    df = pd.read_csv(data_path)
    rename_map = {
        "ID": "id",
        "Temperature (°C)": "temperature",
        "Heart Rate (bpm)": "heart_rate",
        "SpO2 (%)": "spo2",
        "Status": "status",
        "Recommendation": "recommendation",
        "Timestamp": "created_at",
    }
    df = df.rename(columns=rename_map)
    df.columns = [c.strip() for c in df.columns]
    required = ["temperature", "heart_rate", "spo2"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    return df


def main() -> None:
    root = Path(__file__).resolve().parent
    data_dir = root / "data"
    export_candidates = sorted(data_dir.glob("vitals_export_*.csv"), key=lambda p: p.stat().st_mtime, reverse=True)
    data_path = export_candidates[0] if export_candidates else (data_dir / "vitals.csv")

    df = load_dataset(data_path)
    df["rule_status"] = rule_status_series(df)
    cleaned, report = clean_frame(df, drop_iqr_outliers=False, drop_clinical_extreme=True)
    if len(cleaned) < 15:
        raise ValueError(f"Not enough rows after cleaning: {len(cleaned)}")

    out = train_and_evaluate(cleaned, target_col="rule_status", random_state=42)
    model = out["models"]["logistic_regression"]
    label_encoder = out["label_encoder"]
    payload = {
        "model": model,
        "label_encoder": label_encoder,
        "meta": {
            "source_file": data_path.name,
            "rows_loaded": int(len(df)),
            "rows_cleaned": int(len(cleaned)),
            "clean_report": report,
            "selected_model": "logistic_regression",
            "accuracy": float(out["results"]["logistic_regression"]["accuracy"]),
        },
    }

    out_path = root / "model_bundle.joblib"
    joblib.dump(payload, out_path)
    print(f"Saved: {out_path}")
    print(f"Source: {data_path.name}")
    print(f"Accuracy (logistic_regression): {payload['meta']['accuracy']:.4f}")


if __name__ == "__main__":
    main()
