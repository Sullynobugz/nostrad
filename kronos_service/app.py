"""
Nostrad — Kronos Service
FastAPI-Wrapper um das Kronos Foundation Model.
Exponiert /predict für KronosEngine in kronosEngine.ts (KRONOS_MODE=python).
"""

import os
import sys
import math
import logging
from typing import Optional
from contextlib import asynccontextmanager

import numpy as np
import pandas as pd
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Kronos-Modell aus dem geklonten Repo laden
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "kronos"))
from model import KronosTokenizer, Kronos, KronosPredictor

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("kronos-service")

# ── Konfiguration ─────────────────────────────────────────────────────────────
MODEL_SIZE   = os.environ.get("KRONOS_MODEL_SIZE", "small")   # mini | small | base
DEVICE       = os.environ.get("KRONOS_DEVICE", "cpu")          # cpu | cuda | mps
SAMPLE_COUNT = int(os.environ.get("KRONOS_SAMPLE_COUNT", "5")) # Mehr Samples = höhere Confidence-Qualität
PRED_LEN     = int(os.environ.get("KRONOS_PRED_LEN", "1"))     # 1 = nächste Kerze (bei Tageskerzen = 24h)
PORT         = int(os.environ.get("PORT", "5001"))

MODEL_CONFIGS = {
    "mini":  {"tokenizer": "NeoQuasar/Kronos-Tokenizer-2k",   "model": "NeoQuasar/Kronos-mini",  "max_context": 2048},
    "small": {"tokenizer": "NeoQuasar/Kronos-Tokenizer-base",  "model": "NeoQuasar/Kronos-small", "max_context": 512},
    "base":  {"tokenizer": "NeoQuasar/Kronos-Tokenizer-base",  "model": "NeoQuasar/Kronos-base",  "max_context": 512},
}

# ── Globaler Predictor (wird beim Start geladen) ──────────────────────────────
predictor: Optional[KronosPredictor] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global predictor
    cfg = MODEL_CONFIGS.get(MODEL_SIZE, MODEL_CONFIGS["small"])
    log.info(f"Lade Kronos-{MODEL_SIZE} auf {DEVICE}...")

    tokenizer = KronosTokenizer.from_pretrained(cfg["tokenizer"])
    model     = Kronos.from_pretrained(cfg["model"])

    if DEVICE == "cuda" and torch.cuda.is_available():
        model = model.cuda()
    elif DEVICE == "mps" and torch.backends.mps.is_available():
        model = model.to("mps")

    predictor = KronosPredictor(model, tokenizer, max_context=cfg["max_context"])
    log.info(f"Kronos-{MODEL_SIZE} bereit — sample_count={SAMPLE_COUNT}, pred_len={PRED_LEN}")
    yield
    log.info("Kronos Service beendet")

app = FastAPI(title="Kronos Service", version="1.0.0", lifespan=lifespan)

# ── Request / Response Models ─────────────────────────────────────────────────

class Candle(BaseModel):
    date:   str
    open:   float
    high:   float
    low:    float
    close:  float
    volume: float = 0.0

class PredictRequest(BaseModel):
    symbol:  str
    candles: list[Candle]
    pred_len: Optional[int] = None   # überschreibt KRONOS_PRED_LEN wenn gesetzt

class PredictResponse(BaseModel):
    kronos_direction: str         # bullish | bearish | neutral
    kronos_score:     int         # 0-100
    confidence:       int         # 0-100
    horizon:          str         # "24h" | "7d"
    reasoning:        str
    mode:             str         # immer "python"
    predicted_change_pct: float   # Vorhergesagte Kursveränderung in %
    current_price:    float
    predicted_price:  float

# ── Hauptendpunkt ─────────────────────────────────────────────────────────────

@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    if predictor is None:
        raise HTTPException(503, "Kronos-Modell noch nicht geladen")

    if len(req.candles) < 10:
        raise HTTPException(400, f"Mindestens 10 Candles erforderlich, erhalten: {len(req.candles)}")

    effective_pred_len = req.pred_len or PRED_LEN

    # ── DataFrame vorbereiten ─────────────────────────────────────────────────
    df = pd.DataFrame([{
        "open":   c.open,
        "high":   c.high,
        "low":    c.low,
        "close":  c.close,
        "volume": c.volume,
        "amount": c.volume * c.close,  # Approximation
    } for c in req.candles])

    # Timestamps
    x_timestamp = pd.Series(pd.to_datetime([c.date for c in req.candles]))

    # Zukünftige Timestamps extrapolieren (für den Predictor nötig)
    last_ts   = x_timestamp.iloc[-1]
    delta     = x_timestamp.iloc[-1] - x_timestamp.iloc[-2]
    y_timestamp = pd.Series([last_ts + delta * (i + 1) for i in range(effective_pred_len)])

    current_close = req.candles[-1].close

    # ── Kronos-Prediction mit mehreren Samples für Confidence ────────────────
    all_predictions: list[pd.DataFrame] = []

    for _ in range(SAMPLE_COUNT):
        try:
            pred = predictor.predict(
                df=df,
                x_timestamp=x_timestamp,
                y_timestamp=y_timestamp,
                pred_len=effective_pred_len,
                T=1.0,
                top_p=0.9,
                sample_count=1,
                verbose=False,
            )
            all_predictions.append(pred)
        except Exception as e:
            log.warning(f"Sample fehlgeschlagen: {e}")

    if not all_predictions:
        raise HTTPException(500, "Alle Kronos-Samples fehlgeschlagen")

    # ── Auswertung: Richtung, Score, Confidence ───────────────────────────────
    # Vorhergesagter Close der letzten Prediction-Kerze (= Ende des Horizonts)
    predicted_closes = [p["close"].iloc[-1] for p in all_predictions]
    mean_predicted   = float(np.mean(predicted_closes))
    std_predicted    = float(np.std(predicted_closes)) if len(predicted_closes) > 1 else 0.0

    predicted_change_pct = (mean_predicted - current_close) / current_close * 100

    # Richtung
    if predicted_change_pct > 0.3:
        direction = "bullish"
    elif predicted_change_pct < -0.3:
        direction = "bearish"
    else:
        direction = "neutral"

    # Score: Stärke des Signals (Magnitude der Vorhersage)
    # 0.5% Änderung → Score ~40, 1% → ~60, 2% → ~80, 5%+ → 95+
    magnitude = abs(predicted_change_pct)
    score = int(min(30 + magnitude * 25, 98))

    # Confidence: Konsistenz der Samples (niedrige Varianz = hohe Confidence)
    if std_predicted == 0 or current_close == 0:
        confidence = 80
    else:
        relative_std = std_predicted / abs(current_close)
        # relative_std < 0.001 → confidence ~90, > 0.05 → confidence ~30
        confidence = int(max(20, min(92, 90 - relative_std * 1000)))

    # Horizon basierend auf pred_len
    horizon = f"{effective_pred_len * 24}h" if effective_pred_len <= 7 else f"{effective_pred_len}d"

    reasoning = (
        f"Kronos-{MODEL_SIZE} ({SAMPLE_COUNT} Samples): "
        f"Vorhersage {predicted_change_pct:+.2f}% ({current_close:.4f} → {mean_predicted:.4f}). "
        f"Sample-Streuung: ±{std_predicted:.4f} ({len(all_predictions)}/{SAMPLE_COUNT} erfolgreich)."
    )

    log.info(f"[{req.symbol}] {direction} {predicted_change_pct:+.2f}% | score={score} conf={confidence}")

    return PredictResponse(
        kronos_direction=direction,
        kronos_score=score,
        confidence=confidence,
        horizon=horizon,
        reasoning=reasoning,
        mode="python",
        predicted_change_pct=round(predicted_change_pct, 4),
        current_price=current_close,
        predicted_price=round(mean_predicted, 6),
    )

@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": f"Kronos-{MODEL_SIZE}",
        "device": DEVICE,
        "ready": predictor is not None,
    }
