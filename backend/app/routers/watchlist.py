"""Watchlist management endpoints.

The active watchlist is stored as a Redis set (key: ``watchlist:tickers``).
If the key doesn't exist, the endpoints fall back to the WATCHLIST env var
so the system works out of the box with no setup.

GET  /api/v1/watchlist          — list all tickers
POST /api/v1/watchlist/{ticker} — add a ticker
DELETE /api/v1/watchlist/{ticker} — remove a ticker
"""
from __future__ import annotations

import logging
import os

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException

from app.auth.deps import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/watchlist",
    tags=["watchlist"],
    dependencies=[Depends(get_current_user)],
)

_REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
_WATCHLIST_KEY = "watchlist:tickers"
_DEFAULT_WATCHLIST = (
    "SMR,OKLO,LEU,NNE,VST,IONQ,RGTI,QUBT,PLTR,RKLB,"
    "SMCI,VRT,CRSP,FSLR,CCJ,LUNR,ANET,NBIS,HIMS,KULR"
)


async def _get_redis() -> aioredis.Redis:
    return aioredis.from_url(_REDIS_URL)


async def _load_tickers(r: aioredis.Redis) -> list[str]:
    members = await r.smembers(_WATCHLIST_KEY)
    if members:
        return sorted(m.decode() if isinstance(m, bytes) else m for m in members)
    # Fall back to env var; seed Redis on first access
    env_tickers = [t.strip() for t in os.environ.get("WATCHLIST", _DEFAULT_WATCHLIST).split(",") if t.strip()]
    if env_tickers:
        await r.sadd(_WATCHLIST_KEY, *env_tickers)
    return sorted(env_tickers)


@router.get("")
async def list_watchlist() -> dict:
    """Return the current watchlist tickers."""
    r = await _get_redis()
    try:
        tickers = await _load_tickers(r)
        return {"tickers": tickers, "count": len(tickers)}
    finally:
        await r.aclose()


@router.post("/{ticker}")
async def add_ticker(ticker: str) -> dict:
    """Add a ticker to the watchlist."""
    ticker = ticker.upper().strip()
    if not ticker or len(ticker) > 10:
        raise HTTPException(status_code=422, detail="Invalid ticker symbol")

    r = await _get_redis()
    try:
        # Ensure Redis key is seeded before adding
        await _load_tickers(r)
        added = await r.sadd(_WATCHLIST_KEY, ticker)
        tickers = await _load_tickers(r)
        return {
            "ticker": ticker,
            "added": bool(added),
            "message": f"{ticker} added" if added else f"{ticker} already in watchlist",
            "tickers": tickers,
        }
    finally:
        await r.aclose()


@router.delete("/{ticker}")
async def remove_ticker(ticker: str) -> dict:
    """Remove a ticker from the watchlist."""
    ticker = ticker.upper().strip()
    r = await _get_redis()
    try:
        removed = await r.srem(_WATCHLIST_KEY, ticker)
        tickers = await _load_tickers(r)
        return {
            "ticker": ticker,
            "removed": bool(removed),
            "message": f"{ticker} removed" if removed else f"{ticker} not in watchlist",
            "tickers": tickers,
        }
    finally:
        await r.aclose()
