#!/usr/bin/env python3
"""
End-to-end vitals analysis: cleaning, augmentation, summaries, correlation,
ML vs rule-based labels, and explicit decision rules.

Usage (from repo root):
  pip install -r model/requirements.txt
  python model/run_pipeline.py

Or from model/:
  python run_pipeline.py

Optional:
  python run_pipeline.py --data path/to/vitals_export.csv
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from health_rules import rule_status_series
from preprocessing import clean_frame, one_hot_status
from augmentation import bootstrap_expand
from analysis_stats import numeric_summary, status_value_counts, group_stats_by_status, correlation_matrix
from ml_train import FEATURES, train_and_evaluate, train_model_comparison
from sample_data import ensure_sample_csv


def decision_table_text() -> str:
    return """
Business rules (same as app healthLogic):
  IF temperature<30 OR temperature>45 OR heart_rate<30 OR heart_rate>220 OR spo2<70 OR spo2>100 -> INVALID -> Retake measurement
  IF spo2 < 90 OR temperature >= 39.5 OR heart_rate >= 140 -> CRITICAL -> Seek emergency care immediately
  ELIF temperature > 38.0 OR spo2 < 94                     -> ALERT    -> Visit the clinic immediately
  ELIF heart_rate > 100                                    -> WARNING  -> Rest and monitor your condition
  ELIF 37.3<=temperature<=38.0 OR 95<=heart_rate<=100 OR 94<=spo2<=95 -> OBSERVE -> Recheck soon
  ELSE                                                      -> SAFE     -> You are in good health
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Vitals data analysis & ML pipeline")
    parser.add_argument(
        "--data",
        type=Path,
        default=None,
        help="CSV with columns temperature, heart_rate, spo2 (optional: status, id, ...)",
    )
    parser.add_argument(
        "--sample-n",
        type=int,
        default=400,
        help="Rows for synthetic CSV if --data not provided or file missing",
    )
    parser.add_argument(
        "--augment-to",
        type=int,
        default=None,
        help="If set, bootstrap-expand cleaned data to this many rows for summary stats",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    data_path = (args.data or (root / "data" / "vitals.csv")).resolve()

    if not data_path.exists():
        if args.data is not None:
            raise SystemExit(f"Data file not found: {data_path}")
        print(f"No data at {data_path}; generating synthetic sample ({args.sample_n} rows).")
        ensure_sample_csv(data_path, n=args.sample_n)

    df = pd.read_csv(data_path)
    print("=== Load ===")
    print(f"Rows: {len(df)}, columns: {list(df.columns)}")

    df = df.copy()
    df["rule_status"] = rule_status_series(df)

    if "status" in df.columns:
        match = (df["status"].astype(str) == df["rule_status"].astype(str)).mean()
        print(f"\nStored status vs rule_status agreement: {match:.3%}")

    cleaned, report = clean_frame(df, drop_iqr_outliers=False, drop_clinical_extreme=True)
    print("\n=== Cleaning report ===")
    for k, v in report.items():
        print(f"  {k}: {v}")

    aug_n = args.augment_to or max(len(cleaned) * 3, len(cleaned) + 1)
    augmented = bootstrap_expand(cleaned, n_rows=aug_n, random_state=42)
    print(f"\n=== Augmentation (bootstrap, n={aug_n}) ===")
    print(f"Augmented rows: {len(augmented)} (from {len(cleaned)} cleaned rows)")

    print("\n=== Summary statistics (augmented vitals) ===")
    print(numeric_summary(augmented))

    print("\n=== Rule status counts (cleaned) ===")
    print(status_value_counts(cleaned, "rule_status"))

    print("\n=== Group analysis by rule_status (cleaned) ===")
    gs = group_stats_by_status(cleaned, "rule_status")
    print(gs if len(gs) else "(no data)")

    print("\n=== Correlation (cleaned numeric vitals) ===")
    cm = correlation_matrix(cleaned)
    print(cm if len(cm) else "(insufficient columns)")

    print("\n=== One-hot example (first 5 rule_status, cleaned) ===")
    if len(cleaned):
        oh, _ = one_hot_status(cleaned["rule_status"].head())
        print(oh)

    print("\n=== Decision / business rules ===")
    print(decision_table_text().strip())

    if len(cleaned) < 15:
        print("\n=== ML skipped (need more rows after cleaning; try --sample-n 500) ===")
        return

    print("\n=== Model comparison (same holdout split; Jupyter-style EDA) ===")
    comp = train_model_comparison(cleaned, target_col="rule_status", random_state=42)
    for name, payload in comp["results"].items():
        print(f"\n--- {name} ---")
        print(
            f"accuracy={payload['accuracy']:.4f}  macro_f1={payload['macro_f1']:.4f}  "
            f"alert_recall={payload['alert_recall']:.4f}"
        )

    print("\n=== Production model: logistic_regression (bundle / API path) ===")
    out = train_and_evaluate(cleaned, target_col="rule_status", random_state=42)
    payload = out["results"]["logistic_regression"]
    print(f"Holdout accuracy: {payload['accuracy']:.4f}")
    print(payload["report"])
    print(
        f"\nInterpretation: logistic regression learns boundaries from {FEATURES}. "
        "Other algorithms above are for comparison only."
    )


if __name__ == "__main__":
    main()
