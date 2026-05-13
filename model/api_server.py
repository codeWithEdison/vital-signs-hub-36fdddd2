"""FastAPI endpoint for model inference.

The DB write was moved to the Lovable Cloud edge function `persist-vital`,
which uses SUPABASE_SERVICE_ROLE_KEY auto-injected by Cloud. That means
this local server no longer needs any Supabase credentials.

Flow:
  1. Client (frontend or device) POSTs vitals to /predict on this server.
  2. This server returns the prediction JSON.
  3. Client then POSTs that JSON + vital_id to the `persist-vital` edge
     function, which performs the privileged UPDATE on public.vitals.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from predict_final import load_bundle, predict_hybrid


class PredictRequest(BaseModel):
    temperature: float = Field(..., description="Body temperature in Celsius")
    heart_rate: int = Field(..., ge=0)
    spo2: int = Field(..., ge=0)


app = FastAPI(title="Vitals Prediction API", version="2.0.0")
_bundle: dict[str, Any] | None = None
_bundle_error: str | None = None


def _ensure_bundle_loaded() -> dict[str, Any]:
    global _bundle, _bundle_error
    if _bundle is not None:
        return _bundle
    try:
        _bundle = load_bundle(Path(__file__).resolve().parent / "model_bundle.joblib")
        _bundle_error = None
        return _bundle
    except Exception as exc:
        _bundle_error = str(exc)
        raise HTTPException(
            status_code=503,
            detail=(
                "Model bundle failed to load. Rebuild model_bundle.joblib with current sklearn. "
                f"Original error: {exc}"
            ),
        ) from exc


@app.get("/health")
def health() -> dict[str, str]:
    if _bundle_error:
        return {"status": "degraded", "bundle": "error"}
    return {"status": "ok", "bundle": "ready"}


@app.post("/predict")
def predict(payload: PredictRequest) -> dict[str, Any]:
    bundle = _ensure_bundle_loaded()
    return predict_hybrid(
        bundle,
        temperature=payload.temperature,
        heart_rate=payload.heart_rate,
        spo2=payload.spo2,
    )
