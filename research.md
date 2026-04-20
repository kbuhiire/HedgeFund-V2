# HedgeFund-V2 Backend — Research Summary

## Overview

HedgeFund-V2 is an **AI-assisted equity signal and analysis pipeline**. Its backend autonomously ingests market data (prices, fundamentals, insider trades, news), detects tradeable signals, and then routes high-quality opportunities through a multi-persona LLM committee that produces a deterministic CIO investment decision (`INVEST`, `MONITOR`, or `PASS`).

The system is designed around an event-driven, queue-based architecture:

- A **FastAPI** HTTP layer exposes data and pipeline-control endpoints plus a Server-Sent Events stream.
- **Celery** workers (backed by Redis) handle all async processing — scheduled ingestion, signal scanning, and the LLM analysis fan-out.
- **TimescaleDB** (PostgreSQL extension) stores all time-series market data and decision records as hypertables.
- **Redis** serves as the Celery broker/backend, SSE event bus, deduplication store, inter-task coordination, and LLM spend tracker.
- **OpenAI** (`gpt-4o`) powers five named investor personas via LangGraph, each seeing only a partitioned slice of the market data.

---

## Tech Stack

| Layer | Technology |
|---|---|
| API framework | FastAPI + Uvicorn, `sse-starlette` |
| Task queue | Celery 5.x, Redis broker/backend |
| Database | PostgreSQL 16 / TimescaleDB (`sqlalchemy-timescaledb`) |
| ORM | SQLAlchemy 2.x (async `asyncpg` for API, sync `psycopg2` for Celery) |
| Schema validation | Pydantic v2 |
| Migrations | Alembic |
| LLM orchestration | LangGraph (`langgraph==1.1.3`), OpenAI Python SDK |
| Market data | `yfinance` |
| HTTP resilience | `httpx`, `tenacity` |
| Cache / pub-sub | Redis 7 |
| Infrastructure | Docker Compose: TimescaleDB, Redis, `api`, `celery_worker`, `celery_beat` |

---

## Project Structure

```
backend/
├── Dockerfile                        # python:3.12-slim image
├── requirements.txt                  # all Python dependencies
├── alembic.ini
├── alembic/
│   ├── env.py                        # rewrite asyncpg → psycopg2 for migrations
│   └── versions/
│       ├── 0001_initial_schema.py    # base hypertables (price, fundamentals, insider, news)
│       ├── 0002_detected_signals.py  # detected_signals hypertable
│       └── 0003_agent_verdicts.py    # agent_verdicts + cio_decisions hypertables
└── app/
    ├── main.py                       # FastAPI app, router includes, /health
    ├── db/
    │   ├── models.py                 # 7 SQLAlchemy/TimescaleDB models
    │   ├── engine.py                 # async + sync engine from DATABASE_URL
    │   └── deps.py                   # get_session() FastAPI dependency
    ├── routers/
    │   ├── signals.py                # GET /api/v1/signals[/{ticker}]
    │   ├── events.py                 # GET /api/v1/events/stream (SSE)
    │   ├── opportunities.py          # GET /api/v1/opportunities[/{id}]
    │   ├── pipeline.py               # POST /api/v1/pipeline/run, GET /api/v1/pipeline/status
    │   └── demo.py                   # (NOT mounted — demo endpoints)
    ├── schemas/
    │   └── financial.py              # Pydantic FinancialSnapshot — connector output contract
    ├── connectors/
    │   ├── base.py                   # Abstract DataConnector
    │   ├── yfinance_connector.py     # Active: used by all ingest tasks
    │   ├── fmp.py                    # FMPConnector (implemented, not wired)
    │   └── massive.py                # MassiveConnector (implemented, not wired)
    ├── signals/
    │   ├── scorer.py                 # Weighted composite score [0,1]
    │   ├── quality_gate.py           # Threshold gate (default 0.35)
    │   ├── queue.py                  # Redis RPUSH + SET NX dedup
    │   └── detectors/
    │       ├── volume_spike.py       # SQL window z-score on price_ohlcv
    │       ├── price_breakout.py     # Price gap / breakout logic
    │       ├── sector_momentum.py    # Sector peer relative momentum
    │       ├── insider_cluster.py    # Cluster of insider buy events
    │       └── news_catalyst.py      # Keyword ILIKE on news_items
    ├── tasks/
    │   ├── celery_app.py             # Celery app, beat schedule, worker_ready hook
    │   ├── ingest_price.py           # OHLCV ingest (yfinance, every 5 min)
    │   ├── ingest_fundamentals.py    # Fundamentals ingest (daily 06:00 UTC, 24h cache)
    │   ├── ingest_insider.py         # Insider trades (daily 07:00 UTC, 7d cache)
    │   ├── ingest_news.py            # News headlines (every 15 min, dedup)
    │   ├── scan_market.py            # Run detectors → persist signals → enqueue
    │   └── analyse_opportunity.py    # BLPOP consumer → LLM fan-out → committee
    ├── agents/
    │   ├── graph.py                  # Single-node LangGraph with Redis context
    │   ├── partitioner.py            # Information asymmetry: per-persona data buckets
    │   ├── loader.py                 # Load .md prompt, inject {{data_context_json}}
    │   └── personas/
    │       ├── buffett.md
    │       ├── munger.md
    │       ├── ackman.md
    │       ├── cohen.md
    │       └── dalio.md
    ├── analysis/
    │   ├── committee.py              # Regime detection + weighted vote aggregation
    │   ├── asymmetric.py             # Asymmetric opportunity flag (≥3 BUY, avg conf ≥70%)
    │   ├── variance.py               # Inter-agent confidence standard deviation
    │   └── cio.py                    # Deterministic CIO rules → INVEST/MONITOR/PASS
    ├── llm/
    │   ├── wrapper.py                # OpenAI structured output, SpendTracker
    │   └── exceptions.py             # LLM-specific exceptions
    └── events/
        └── publisher.py              # Redis Pub/Sub on channel pipeline:events
```

---

## Data Pipeline Architecture

```mermaid
flowchart TD
    subgraph ingest [Ingest - Celery Beat]
        A1[ingest_price\nevery 5 min]
        A2[ingest_fundamentals\ndaily 06:00 UTC]
        A3[ingest_insider\ndaily 07:00 UTC]
        A4[ingest_news\nevery 15 min]
    end

    subgraph db [TimescaleDB Hypertables]
        B1[(price_ohlcv)]
        B2[(fundamentals)]
        B3[(insider_trades)]
        B4[(news_items)]
        B5[(detected_signals)]
        B6[(agent_verdicts)]
        B7[(cio_decisions)]
    end

    subgraph scan [Scan - Celery Beat every 15 min]
        C1[volume_spike detector]
        C2[price_breakout detector]
        C3[sector_momentum detector]
        C4[insider_cluster detector]
        C5[news_catalyst detector]
        C6[composite scorer]
        C7{quality gate\n>= 0.35?}
    end

    subgraph queue [Redis]
        D1[opportunity_queue\nRPUSH / BLPOP]
        D2[opp:dedup:{ticker}\nSET NX TTL 3600s]
        D3[pipeline:events\nPub/Sub]
    end

    subgraph analyse [Analyse - consume_queue long-running task]
        E1[fan_out\nstore opportunity JSON]
        E2[run_persona_agent\nbuffett]
        E3[run_persona_agent\nmunger]
        E4[run_persona_agent\nackman]
        E5[run_persona_agent\ncohen]
        E6[run_persona_agent\ndalio]
        E7[LangGraph\ngpt-4o structured output]
        E8[Redis verdict hash\n+ HINCRBY counter]
    end

    subgraph committee [Committee - run_committee]
        F1[load 5 verdicts]
        F2[asymmetric flag\n3+ BUY + avg conf >= 70%]
        F3[regime detection\n+ weighted vote]
        F4[CIO decision\nINVEST / MONITOR / PASS]
    end

    A1 --> B1
    A2 --> B2
    A3 --> B3
    A4 --> B4

    B1 --> C1
    B1 --> C2
    B1 --> C3
    B3 --> C4
    B4 --> C5

    C1 & C2 & C3 & C4 & C5 --> C6
    C6 --> C7
    C7 -->|pass| D2
    C7 -->|fail| B5
    D2 --> D1
    C7 -->|all signals| B5

    D1 -->|BLPOP| E1
    E1 --> E2 & E3 & E4 & E5 & E6
    E2 & E3 & E4 & E5 & E6 --> E7
    E7 --> E8
    E8 -->|counter >= 5| F1

    F1 --> F2
    F2 --> F3
    F3 --> F4
    F4 --> B6
    F4 --> B7
    F4 --> D3
```

---

## API Endpoints

All routes are served by Uvicorn on port `8000`. The base prefix for versioned routes is `/api/v1`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{"status":"ok","service":"hedgefund-api"}` |
| `GET` | `/api/v1/signals` | List `DetectedSignal` rows; filters: `ticker`, `signal_type`, `passed_gate`; `limit` max 500; ordered by `detected_at` desc |
| `GET` | `/api/v1/signals/{ticker}` | Same as above scoped to a single ticker; `limit` max 200 |
| `GET` | `/api/v1/events/stream` | **Server-Sent Events** — subscribes to Redis `pipeline:events` channel and streams JSON events to clients |
| `GET` | `/api/v1/opportunities` | Lists `CIODecisionRecord` ordered by `conviction_score` desc; optional `final_verdict` filter (`INVEST`/`MONITOR`/`PASS`); includes `risk_rating` from `decision_json` |
| `GET` | `/api/v1/opportunities/{opportunity_id}` | Full CIO decision JSON + all agent verdicts for that ID; 404 if no CIO row |
| `POST` | `/api/v1/pipeline/run` | Deletes demo signals (`source == "demo"`), then fires Celery tasks: `ingest_price`, `ingest_fundamentals`, `ingest_insider`, `ingest_news`, then `scan_market` with a 15-second countdown |
| `GET` | `/api/v1/pipeline/status` | Reads Redis keys: `scanner:last_scan_at`, `scanner:last_pass_rate`, `scanner:last_total`, and `LLEN opportunity_queue` |

> **Not mounted**: `POST /api/v1/demo/run` is implemented in `routers/demo.py` but is not included in `main.py`.

---

## Database Models

All tables are TimescaleDB **hypertables** (time-partitioned). Composite primary keys include the time column plus business keys to support hypertable upserts.

| Table | Time Column | Key Fields | Purpose |
|---|---|---|---|
| `price_ohlcv` | `timestamp` | `ticker`, `source` | OHLCV bars — open, high, low, close, volume |
| `fundamentals` | `timestamp` | `ticker` | P/E ratio, revenue, net income, EPS, debt-to-equity, FCF, market cap |
| `insider_trades` | `timestamp` | `ticker`, `insider_name`, `trade_type` | Insider name, trade type, shares count, dollar value |
| `news_items` | `timestamp` | `ticker`, `headline` | Headline, summary, optional sentiment score, source URL |
| `detected_signals` | `detected_at` | `ticker`, `signal_type` | Per-detector score, composite score, `passed_gate` bool, JSON detail, source (`scanner`/`demo`) |
| `agent_verdicts` | `analysed_at` | `opportunity_id`, `persona` | LLM verdict JSON per persona (direction, confidence, rationale) |
| `cio_decisions` | `decided_at` | `opportunity_id` | Final decision, conviction score, allocation %, full `decision_json` |

---

## Signal Detection

Each market scan runs five detectors against the database, then merges their outputs into a single composite score.

### Detectors

| Detector | Data Source | Method |
|---|---|---|
| `volume_spike` | `price_ohlcv` | SQL window z-score; flags if current volume deviates significantly from rolling average |
| `price_breakout` | `price_ohlcv` | Gap/breakout logic on recent OHLCV bars |
| `sector_momentum` | `price_ohlcv` + `SECTOR_MAP` env | Computes ticker return relative to sector peers; configurable via `SECTOR_MAP` JSON env var |
| `insider_cluster` | `insider_trades` | Flags when multiple insiders buy within `INSIDER_CLUSTER_WINDOW_DAYS`; minimum cluster size controlled by `MIN_INSIDER_CLUSTER_SIZE` |
| `news_catalyst` | `news_items` | Keyword `ILIKE` search on headlines using `NEWS_CATALYST_KEYWORDS` env list |

### Scoring & Gate

1. `scorer.py` computes a **weighted composite score** in `[0, 1]` across all detector outputs. Individual detector weights are configurable via `WEIGHT_*` environment variables.
2. `quality_gate.py` applies a threshold (default `0.35`, override via `SIGNAL_QUALITY_GATE`). Signals that fail are still written to `detected_signals` with `passed_gate=False`.
3. Signals that pass are **enqueued** to Redis `opportunity_queue` via `RPUSH`, with a `SET NX` dedup key per ticker (`opp:dedup:{ticker}`) that expires after `OPPORTUNITY_DEDUP_TTL_SECONDS` (default 3600s). This prevents the same ticker from flooding the analysis queue within an hour.

---

## Agent Analysis System

### Persona Agents

Five named investor personas are each implemented as a Markdown prompt template in `app/agents/personas/`:

- **Buffett** — long-term value, margin of safety
- **Munger** — mental models, inversion thinking
- **Ackman** — activist, concentrated positions
- **Cohen** — quantitative, momentum-aware
- **Dalio** — macro, risk parity

Each persona is run as a separate Celery task (`run_persona_agent`), meaning all five run **concurrently**.

### Information Partitioning

`partitioner.py` implements **information asymmetry**: each persona only receives the data buckets it is allowed to see. The four buckets are `fundamentals`, `price_action`, `news`, and `insider_trades`. No persona sees the full picture — this is intentional to simulate a real investment committee where each member has a different information edge.

### LangGraph Graph

`agents/graph.py` defines a single-node LangGraph graph. The node:

1. Retrieves the opportunity JSON from Redis.
2. Calls `partitioner.py` to filter data for the given persona.
3. Renders the persona's `.md` prompt via `loader.py`, injecting `{{data_context_json}}`.
4. Calls `llm_call_with_persona_parsed` (OpenAI structured output against `AgentVerdict.model_json_schema()`).
5. Returns an `AgentVerdict` (direction, confidence score, rationale).

Results are stored in a **Redis hash** and a `HINCRBY` counter increments per opportunity. When the counter reaches 5, `run_committee` is triggered.

### Committee & CIO Decision

Once all five verdicts are collected:

1. **`asymmetric.evaluate_asymmetric`** — flags the opportunity if ≥ 3 verdicts are `BUY` and average `BUY` confidence ≥ 70%.
2. **`committee.detect_regime`** — determines the current market regime and applies regime-based weights to each persona's vote, producing a `CommitteeReport`.
3. **`cio.make_cio_decision`** — applies deterministic rules to produce a `CIODecision`:
   - `INVEST` — strong committee consensus + asymmetric flag
   - `MONITOR` — partial consensus or borderline confidence
   - `PASS` — weak signal, high variance, or conflicting verdicts
4. Results are **merged** into `agent_verdicts` and `cio_decisions` hypertables.
5. A pipeline event is **published** to Redis `pipeline:events` (consumed by the SSE stream).
6. Redis keys for the opportunity (blob, verdict hash, counter) are **deleted** to clean up.

### LLM Spend Tracking

`llm/wrapper.py` gates all OpenAI calls through a `SpendTracker` that reads/writes `llm:spend:YYYY-MM-DD` in Redis. The default daily spend limit is **$10 USD** and can be overridden per call. If the limit is exceeded, the LLM call is blocked and a custom exception is raised.

---

## Background Jobs

### Celery Beat Schedule

| Task | Schedule |
|---|---|
| `app.tasks.ingest_price.run` | Every **300 s** (5 min) |
| `app.tasks.ingest_news.run` | Every **900 s** (15 min) |
| `app.tasks.scan_market.run` | Every **`SCAN_INTERVAL_SECONDS`** (default 900 s) |
| `app.tasks.ingest_fundamentals.run` | Daily at **06:00 UTC** |
| `app.tasks.ingest_insider.run` | Daily at **07:00 UTC** |

### Long-Running Consumer

On **`worker_ready`** signal (i.e., whenever a Celery worker starts), `consume_queue` is dispatched once. This task runs an **infinite loop** using `BLPOP opportunity_queue 30` — it blocks for up to 30 seconds waiting for items, calls `fan_out` for each job received, and loops forever. This means analysis is always live as long as a worker is running.

---

## External Integrations

| Integration | Status | Usage |
|---|---|---|
| **Yahoo Finance** (`yfinance`) | Active | All five ingest tasks use `YFinanceConnector` for OHLCV, fundamentals, insider trades, and news |
| **OpenAI** (`gpt-4o`) | Active | Persona agents via structured chat completions; cost tracked in Redis |
| **Redis** | Active | Celery broker/backend; `pipeline:events` pub/sub; `opportunity_queue`; dedup keys; verdict hashes; opportunity blobs; LLM spend keys; scanner stats |
| **TimescaleDB** | Active | Primary persistent store for all market data and decision records |
| **FMP** (financialmodelingprep.com) | Implemented, not wired | `connectors/fmp.py` provides the same `FinancialSnapshot` contract via HTTP + `tenacity` retries; requires `FMP_API_KEY`; not called by any ingest task |
| **Massive.com** (Polygon-style API) | Implemented, not wired | `connectors/massive.py` — same contract; requires `MASSIVE_API_KEY`; not called by any ingest task |

---

## Configuration & Environment

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | Async SQLAlchemy URL (`postgresql+asyncpg://...`). The engine module rewrites it to sync for Alembic/Celery tasks. |
| `OPENAI_API_KEY` | Used by the OpenAI SDK (`AsyncOpenAI()` default env pickup). |

### Common (with defaults)

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://redis:6379/0` | Used by Celery, publisher, queue, spend tracker |
| `WATCHLIST` | Large built-in list | Comma-separated tickers for ingest + scan |
| `SCAN_INTERVAL_SECONDS` | `900` | Celery beat scan frequency |
| `SIGNAL_QUALITY_GATE` | `0.35` | Minimum composite score to enqueue an opportunity |
| `WEIGHT_VOLUME_SPIKE` | (set in scorer) | Per-detector weight in composite score |
| `WEIGHT_PRICE_BREAKOUT` | (set in scorer) | Per-detector weight |
| `WEIGHT_SECTOR_MOMENTUM` | (set in scorer) | Per-detector weight |
| `WEIGHT_INSIDER_CLUSTER` | (set in scorer) | Per-detector weight |
| `WEIGHT_NEWS_CATALYST` | (set in scorer) | Per-detector weight |
| `VOLUME_ZSCORE_THRESHOLD` | (detector default) | Z-score threshold for volume spike detector |
| `GAP_THRESHOLD` | (detector default) | Minimum gap size for price breakout detector |
| `MIN_INSIDER_CLUSTER_SIZE` | (detector default) | Minimum number of insiders in a cluster |
| `INSIDER_CLUSTER_WINDOW_DAYS` | (detector default) | Look-back window for insider clustering |
| `NEWS_CATALYST_KEYWORDS` | (detector default) | Comma-separated keyword list for news catalyst |
| `SECTOR_MAP` | None (optional) | JSON mapping tickers to sectors for sector momentum |
| `SECTOR_MOMENTUM_THRESHOLD` | (detector default) | Minimum relative outperformance |
| `SECTOR_MIN_COVERAGE` | (detector default) | Minimum number of sector peers required |
| `OPPORTUNITY_DEDUP_TTL_SECONDS` | `3600` | Per-ticker dedup window for opportunity queue |
| `AGENT_VARIANCE_THRESHOLD` | `8.0` | Inter-agent confidence std dev threshold (logged, does not block committee) |

### Optional Connector Keys

| Variable | Description |
|---|---|
| `FMP_API_KEY` | Required only if `FMPConnector` is instantiated |
| `MASSIVE_API_KEY` | Required only if `MassiveConnector` is instantiated |

### Docker Compose

The `docker-compose.yml` at the repo root defines four services: `timescaledb` (pg16), `redis`, `api`, and `celery_worker`/`celery_beat`. The `api` service runs `alembic upgrade head` then starts Uvicorn. All three app services load `env_file: .env` from the repo root.

---

## Known Gaps & Implementation Notes

| Area | Observation |
|---|---|
| **Authentication** | There is **no auth** on the FastAPI app — no API keys, no JWT, no `HTTPBearer`. The API is open to any client that can reach it on the network. |
| **Demo router** | `routers/demo.py` implements `POST /api/v1/demo/run` but is **never included** in `main.py`. It is unreachable at runtime. |
| **Demo cleanup** | `pipeline/run` deletes rows from `detected_signals` where `source == "demo"`, but does **not** clean up corresponding `agent_verdicts` or `cio_decisions` demo rows. |
| **`nest_asyncio`** | Imported inside an exception fallback path in `analyse_opportunity.py` but is **not listed** in `requirements.txt`. Will raise `ImportError` if that path is hit. |
| **Flower** | Listed in `requirements.txt` but there is **no Flower service** in `docker-compose.yml`. Celery task monitoring via Flower requires a manual setup. |
| **FMP / Massive connectors** | Both are fully implemented with retry logic but are **not referenced** by any active ingest task. Switching connectors requires code changes. |
| **`AGENT_VARIANCE_THRESHOLD`** | The variance check is computed and logged but does **not block** the committee pipeline if variance is high. It is purely informational. |
| **Lifespan hooks** | `main.py` defines an async `lifespan` context but the body is a placeholder (`pass`). No startup/shutdown logic is executed (e.g., no pre-warming of DB pool). |
| **`consume_queue` concurrency** | `consume_queue` is a long-running infinite loop dispatched as a regular Celery task. If multiple workers start simultaneously, multiple consumers will compete on the same `BLPOP` queue — which is actually fine for Redis `BLPOP` semantics, but it is not explicitly documented or controlled. |
