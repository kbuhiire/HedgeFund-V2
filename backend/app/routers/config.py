"""Runtime configuration endpoints for CIO thresholds and signal quality gate.

Thresholds are stored in Redis (key: ``config:thresholds``) as a JSON hash so
they survive restarts and are shared across workers. Falls back to env/defaults
on first read.

GET /api/v1/config/thresholds        — read current thresholds
PUT /api/v1/config/thresholds        — update one or more thresholds
"""
from __future__ import annotations

import json
import logging
import os

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth.deps import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/config",
    tags=["config"],
    dependencies=[Depends(get_current_user)],
)

_REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
_CONFIG_KEY = "config:thresholds"


def _defaults() -> dict:
    return {
        "signal_quality_gate": float(os.environ.get("SIGNAL_QUALITY_GATE", "0.35")),
        "agent_variance_threshold": float(os.environ.get("AGENT_VARIANCE_THRESHOLD", "8.0")),
        "asymmetric_min_buy_count": int(os.environ.get("ASYMMETRIC_MIN_BUY_COUNT", "3")),
        "asymmetric_min_avg_confidence": float(os.environ.get("ASYMMETRIC_MIN_AVG_CONFIDENCE", "70.0")),
        "invest_min_conviction": int(os.environ.get("INVEST_MIN_CONVICTION", "40")),
        "monitor_min_conviction": int(os.environ.get("MONITOR_MIN_CONVICTION", "45")),
        "opportunity_dedup_ttl_seconds": int(os.environ.get("OPPORTUNITY_DEDUP_TTL_SECONDS", "3600")),
        "llm_daily_limit_usd": float(os.environ.get("LLM_DAILY_LIMIT_USD", "10.0")),
    }


async def _load_config(r: aioredis.Redis) -> dict:
    raw = await r.get(_CONFIG_KEY)
    if raw:
        stored = json.loads(raw)
        # Merge with defaults so new keys added in code are always present
        merged = _defaults()
        merged.update(stored)
        return merged
    defaults = _defaults()
    await r.set(_CONFIG_KEY, json.dumps(defaults))
    return defaults


class ThresholdUpdate(BaseModel):
    signal_quality_gate: float | None = Field(None, ge=0.0, le=1.0, description="Min composite score to pass quality gate (0–1)")
    agent_variance_threshold: float | None = Field(None, ge=0.0, description="Inter-agent variance that downgrades INVEST → MONITOR")
    asymmetric_min_buy_count: int | None = Field(None, ge=1, le=5, description="Min BUY votes to flag asymmetric opportunity")
    asymmetric_min_avg_confidence: float | None = Field(None, ge=0.0, le=100.0, description="Min avg BUY confidence for asymmetric flag (%)")
    invest_min_conviction: int | None = Field(None, ge=0, le=100, description="Min conviction score for INVEST verdict")
    monitor_min_conviction: int | None = Field(None, ge=0, le=100, description="Min conviction for MONITOR when consensus is neutral")
    opportunity_dedup_ttl_seconds: int | None = Field(None, ge=60, description="Per-ticker dedup window in seconds")
    llm_daily_limit_usd: float | None = Field(None, ge=0.0, description="Daily LLM spend cap in USD")


@router.get("/thresholds")
async def get_thresholds() -> dict:
    """Return current runtime thresholds."""
    r = aioredis.from_url(_REDIS_URL)
    try:
        config = await _load_config(r)
        return {"thresholds": config}
    finally:
        await r.aclose()


@router.put("/thresholds")
async def update_thresholds(updates: ThresholdUpdate) -> dict:
    """Update one or more runtime thresholds.

    Only fields explicitly provided (non-null) are changed.
    Workers read from Redis on each scan so changes take effect within the next
    scan cycle without restart.
    """
    r = aioredis.from_url(_REDIS_URL)
    try:
        config = await _load_config(r)
        patch = updates.model_dump(exclude_none=True)
        config.update(patch)
        await r.set(_CONFIG_KEY, json.dumps(config))
        logger.info("Thresholds updated: %s", patch)
        return {"thresholds": config, "updated": list(patch.keys())}
    finally:
        await r.aclose()
