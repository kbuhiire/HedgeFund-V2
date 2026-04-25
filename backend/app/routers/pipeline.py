"""Pipeline control endpoints: trigger real data ingest + market scan.

POST /api/v1/pipeline/run           — backfill data and run a full scan
POST /api/v1/pipeline/scan/{ticker} — on-demand single-ticker scan
GET  /api/v1/pipeline/status        — check pipeline health
GET  /api/v1/pipeline/spend         — LLM daily spend summary
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db.deps import get_session
from app.db.models import AgentVerdictRecord, CIODecisionRecord, DetectedSignal
from app.tasks.celery_app import app as celery_app

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/pipeline",
    tags=["pipeline"],
    dependencies=[Depends(get_current_user)],
)

_REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")


@router.post("/run")
async def run_pipeline(
    days_back: int = 30,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Trigger a full pipeline run with real market data.

    1. Clears any demo data from DB (signals, verdicts, decisions)
    2. Dispatches ingest tasks (price backfill, fundamentals, insider, news)
    3. Dispatches market scan (after ingest completes)

    Args:
        days_back: Days of price history to backfill (default 30).
    """
    # 1. Clear all demo data — signals, verdicts, and CIO decisions
    demo_signal_result = await session.execute(
        delete(DetectedSignal).where(DetectedSignal.source == "demo")
    )
    # Find demo opportunity IDs (they all start with a ticker followed by a
    # timestamp, but the most reliable way is to look at signals first and
    # derive the IDs, or just delete all rows from agent_verdicts /
    # cio_decisions that correspond to demo runs by checking the source field
    # on signals. Since verdicts/decisions don't carry a source tag, we delete
    # by opportunity_id prefix matching the demo ticker set.
    demo_tickers = ["NVDA", "PLTR", "CRWD", "TSLA", "SMCI"]
    for ticker in demo_tickers:
        await session.execute(
            delete(AgentVerdictRecord).where(
                AgentVerdictRecord.opportunity_id.like(f"{ticker}:%")
            )
        )
        await session.execute(
            delete(CIODecisionRecord).where(
                CIODecisionRecord.opportunity_id.like(f"{ticker}:%")
            )
        )
    await session.commit()
    logger.info("Cleared %d demo signal rows and associated verdicts/decisions", demo_signal_result.rowcount)

    # 2. Dispatch ingest tasks — price with backfill, others immediately
    price_task = celery_app.send_task(
        "app.tasks.ingest_price.run",
        kwargs={"days_back": days_back},
    )
    fundamentals_task = celery_app.send_task("app.tasks.ingest_fundamentals.run")
    insider_task = celery_app.send_task("app.tasks.ingest_insider.run")
    news_task = celery_app.send_task("app.tasks.ingest_news.run")

    # 3. Dispatch scan with a countdown to let ingest complete first
    scan_task = celery_app.send_task(
        "app.tasks.scan_market.run",
        countdown=15,  # 15s delay to let ingest tasks finish
    )

    return {
        "status": "pipeline_triggered",
        "tasks": {
            "ingest_price": price_task.id,
            "ingest_fundamentals": fundamentals_task.id,
            "ingest_insider": insider_task.id,
            "ingest_news": news_task.id,
            "scan_market": scan_task.id,
        },
        "days_back": days_back,
    }


@router.post("/scan/{ticker}")
async def scan_ticker(ticker: str) -> dict:
    """Trigger an on-demand ingest + scan for a single ticker.

    Immediately ingest price, fundamentals, news, and insider data for the
    given ticker, then run the market scanner. This bypasses the beat schedule
    so you can get signals for any symbol instantly.

    Args:
        ticker: Stock symbol to scan (e.g. "AAPL", "NVDA").
    """
    ticker = ticker.upper().strip()
    if not ticker or len(ticker) > 10:
        raise HTTPException(status_code=422, detail="Invalid ticker symbol")

    price_task = celery_app.send_task(
        "app.tasks.ingest_price.run",
        kwargs={"days_back": 30, "tickers_override": [ticker]},
    )
    fund_task = celery_app.send_task(
        "app.tasks.ingest_fundamentals.run",
        kwargs={"tickers_override": [ticker]},
    )
    insider_task = celery_app.send_task(
        "app.tasks.ingest_insider.run",
        kwargs={"tickers_override": [ticker]},
    )
    news_task = celery_app.send_task(
        "app.tasks.ingest_news.run",
        kwargs={"tickers_override": [ticker]},
    )
    scan_task = celery_app.send_task(
        "app.tasks.scan_market.run",
        kwargs={"tickers_override": [ticker]},
        countdown=10,
    )

    return {
        "status": "scan_triggered",
        "ticker": ticker,
        "tasks": {
            "ingest_price": price_task.id,
            "ingest_fundamentals": fund_task.id,
            "ingest_insider": insider_task.id,
            "ingest_news": news_task.id,
            "scan_market": scan_task.id,
        },
    }


@router.get("/status")
async def pipeline_status() -> dict:
    """Check pipeline health — last scan time, data freshness, queue depth."""
    import redis.asyncio as aioredis

    r = aioredis.from_url(_REDIS_URL)
    try:
        last_scan = await r.get("scanner:last_scan_at")
        pass_rate = await r.get("scanner:last_pass_rate")
        total = await r.get("scanner:last_total")
        queue_len = await r.llen("opportunity_queue")

        return {
            "last_scan_at": last_scan.decode() if last_scan else None,
            "last_pass_rate": float(pass_rate) if pass_rate else None,
            "tickers_scanned": int(total) if total else None,
            "queue_depth": queue_len,
        }
    finally:
        await r.aclose()


@router.get("/spend")
async def llm_spend() -> dict:
    """Return today's LLM spend summary from Redis."""
    import redis.asyncio as aioredis
    from datetime import datetime, timezone

    r = aioredis.from_url(_REDIS_URL)
    try:
        today = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
        raw = await r.get(f"llm:spend:{today}")
        current = float(raw) if raw else 0.0
        daily_limit = float(os.environ.get("LLM_DAILY_LIMIT_USD", "10.0"))
        return {
            "date": today,
            "current_spend_usd": round(current, 4),
            "daily_limit_usd": daily_limit,
            "remaining_usd": round(max(0.0, daily_limit - current), 4),
            "utilisation_pct": round(current / daily_limit * 100, 1) if daily_limit > 0 else 0.0,
        }
    finally:
        await r.aclose()
