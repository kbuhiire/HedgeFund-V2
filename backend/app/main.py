from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from app.auth.security import hash_password
from app.db.engine import AsyncSessionLocal, engine as async_engine
from app.db.models import User
from app.routers.auth import router as auth_router
from app.routers.config import router as config_router
from app.routers.demo import router as demo_router
from app.routers.events import router as events_router
from app.routers.opportunities import router as opportunities_router
from app.routers.pipeline import router as pipeline_router
from app.routers.signals import router as signals_router
from app.routers.watchlist import router as watchlist_router

_DEFAULT_EMAIL = os.environ.get("SEED_EMAIL", "")
_DEFAULT_PASSWORD = os.environ.get("SEED_PASSWORD", "")

logger = logging.getLogger(__name__)


async def _seed_default_user() -> None:
    if not _DEFAULT_EMAIL or not _DEFAULT_PASSWORD:
        return
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == _DEFAULT_EMAIL))
        if result.scalar_one_or_none() is None:
            session.add(
                User(
                    email=_DEFAULT_EMAIL,
                    hashed_password=hash_password(_DEFAULT_PASSWORD),
                )
            )
            await session.commit()
            logger.info("Seeded default user: %s", _DEFAULT_EMAIL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-warm DB connection pool so the first request doesn't pay cold-start latency
    async with async_engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    await _seed_default_user()
    yield
    await async_engine.dispose()


app = FastAPI(
    title="HedgeFund V2 API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "hedgefund-api"}


app.include_router(auth_router)
app.include_router(signals_router)
app.include_router(events_router)
app.include_router(opportunities_router)
app.include_router(pipeline_router)
app.include_router(demo_router)
app.include_router(watchlist_router)
app.include_router(config_router)
