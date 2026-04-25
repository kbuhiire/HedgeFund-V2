# Improvements v1 — ft-improvements branch

## Backend

### CIO Variance-Based Verdict Downgrade
**File:** `backend/app/analysis/cio.py`

When inter-agent confidence scores diverge too much, the INVEST verdict is no longer reliable. A new rule downgrades `INVEST → MONITOR` when the inter-agent variance score exceeds a configurable threshold (default `8.0`, tunable via `AGENT_VARIANCE_THRESHOLD` env var or the new config API). High variance is logged with the exact score and threshold for observability.

---

### On-Demand Single-Ticker Scan
**File:** `backend/app/routers/pipeline.py`

New endpoint: `POST /api/v1/pipeline/scan/{ticker}`

Triggers a full ingest (price 30d, fundamentals, insider, news) + market scan for a single symbol immediately, bypassing the beat schedule. Useful for testing a new ticker or getting an instant signal without waiting for the next scheduled run.

All four ingest tasks and the scan task now accept a `tickers_override: list[str]` argument so they can operate on a subset of tickers instead of the full watchlist.

---

### LLM Spend Endpoint
**File:** `backend/app/routers/pipeline.py`

New endpoint: `GET /api/v1/pipeline/spend`

Returns today's accumulated LLM spend from Redis against the configured daily cap (`LLM_DAILY_LIMIT_USD`, default `$10`), including utilisation percentage. The frontend polls this every 30 seconds and displays it in the header.

---

### Improved Demo Data Cleanup
**File:** `backend/app/routers/pipeline.py`

When a full pipeline run is triggered, demo data is now fully purged — including `AgentVerdictRecord` and `CIODecisionRecord` rows (previously only `DetectedSignal` rows were deleted), preventing stale demo data from appearing alongside real signals.

---

### Runtime Configuration API
**File:** `backend/app/routers/config.py` *(new)*

Two endpoints backed by a Redis key (`config:thresholds`):

- `GET /api/v1/config/thresholds` — return all current threshold values
- `PUT /api/v1/config/thresholds` — patch one or more thresholds

Changes take effect on the next scan cycle without a restart. Thresholds exposed:

| Key | Description | Default |
|---|---|---|
| `signal_quality_gate` | Min composite score to pass gate | 0.35 |
| `agent_variance_threshold` | Variance that downgrades INVEST → MONITOR | 8.0 |
| `asymmetric_min_buy_count` | Min BUY votes for asymmetric flag | 3 |
| `asymmetric_min_avg_confidence` | Min avg BUY confidence for asymmetric flag | 70% |
| `invest_min_conviction` | Min conviction for INVEST verdict | 40 |
| `monitor_min_conviction` | Min conviction for MONITOR (neutral consensus) | 45 |
| `opportunity_dedup_ttl_seconds` | Per-ticker dedup window | 3600 |
| `llm_daily_limit_usd` | Daily LLM spend cap | $10 |

---

### Watchlist Management API
**File:** `backend/app/routers/watchlist.py` *(new)*

Dynamic watchlist CRUD stored in Redis (`watchlist:tickers`). Falls back to the `WATCHLIST` env var on first access so no setup is required.

- `GET /api/v1/watchlist` — list tickers
- `POST /api/v1/watchlist/{ticker}` — add ticker
- `DELETE /api/v1/watchlist/{ticker}` — remove ticker

---

### Signals — Detail JSON Auto-Parsing
**File:** `backend/app/routers/signals.py`

The `detail` field on `SignalResponse` was sometimes returned as a raw JSON string. A Pydantic `model_validator` now automatically parses it to a dict so frontend consumers always receive a structured object. A `source` field was also added to the response.

---

### Demo Router Authentication
**File:** `backend/app/routers/demo.py`

The demo router now requires authentication (`get_current_user` dependency), preventing unauthenticated access to demo pipeline triggers.

---

### Startup / Shutdown Improvements
**File:** `backend/app/main.py`

- DB connection pool is pre-warmed on startup (`SELECT 1`) to eliminate first-request cold-start latency.
- `engine.dispose()` is called on shutdown for clean connection teardown.
- New routers registered: `demo`, `watchlist`, `config`.

---

## Frontend

### Dashboard Layout Overhaul
**File:** `frontend/src/components/layout/DashboardLayout.tsx`

The three-panel layout was significantly extended:

- **Header** now contains: brand, a center ticker search bar, pipeline controls (DEMO + RUN buttons with live stats), a settings gear, and the SSE status indicator (labels updated to LIVE / OFFLINE).
- **Middle panel** is now tabbed: `Live Feed` | `Signals`.
- **Right panel** is now tabbed: `Opportunities` | `Watchlist`.

---

### Ticker Search Bar
**Component:** `TickerSearchBar` (in `DashboardLayout.tsx`)

A search-style input in the header. Typing a symbol and pressing Enter (or waiting for the scan button) calls `POST /api/v1/pipeline/scan/{ticker}` and shows a toast confirmation. The input expands on focus and clears after a successful scan.

---

### Pipeline Stats Bar
**Component:** `PipelineStats` (in `DashboardLayout.tsx`)

Polls `/api/v1/pipeline/status` and `/api/v1/pipeline/spend` every 30 seconds and renders:
- Last scan time and pass rate
- Queue depth (highlighted in yellow when non-zero)
- LLM spend vs. daily limit (turns red above 80% utilisation)
- DEMO and RUN pipeline buttons with loading states

---

### Signal Explorer
**File:** `frontend/src/components/signals/SignalExplorer.tsx` *(new)*

A full-featured signal browser in the middle-panel Signals tab:
- Displays all detected signals with type-coloured badges and composite/detector score bars
- Filter by gate status (All / Passed / Failed) and signal type
- Sort by detection time, composite score, or detector score
- Each row expands to show raw detector detail key-values

---

### Watchlist Panel
**File:** `frontend/src/components/watchlist/WatchlistPanel.tsx` *(new)*

The right-panel Watchlist tab for managing the Redis-backed watchlist:
- Add / remove tickers with keyboard-friendly input
- Filter/search within the current list
- Per-ticker "SCAN" button triggers an on-demand single-ticker scan

---

### CIO Threshold Settings Drawer
**File:** `frontend/src/components/settings/ThresholdDrawer.tsx` *(new)*

A slide-out sheet opened from the settings gear in the header. Provides slider controls for all runtime thresholds (signal gate, variance, asymmetric flags, conviction thresholds, dedup TTL, daily spend limit). Unsaved changes accumulate locally and are sent in a single `PUT /api/v1/config/thresholds` call. Changes take effect on the next scan cycle — no restart required.

---

### OpportunitySheet — Committee Consensus View
**File:** `frontend/src/components/inspect/OpportunitySheet.tsx`

The detail sheet for an opportunity was enhanced with two new sections above the agent breakdown:

1. **Consensus Bar** — stacked proportional bar showing the distribution of agent verdicts (BUY / HOLD / PASS etc.) with a colour legend.
2. **Variance Badge** — green badge when agents converged well; orange warning badge when inter-agent variance is high, explaining that the verdict was downgraded from INVEST to MONITOR.

Additional fixes: `VERY_HIGH` risk rating now renders as red (destructive); key catalysts use a trending-up icon instead of a plain bullet.

---

### OpportunityCard — Clickable + Price Outcome
**File:** `frontend/src/components/output/OpportunityCard.tsx`

- Cards are now clickable — clicking anywhere on a card opens the OpportunitySheet for that opportunity.
- A price outcome badge is shown when price data is available: displays the % change since the decision was made with a trending-up (green) or trending-down (red) arrow.

---

### Price Change Hook
**File:** `frontend/src/hooks/usePriceChange.ts` *(new)*

`usePriceChange(ticker, decidedAt)` fetches recent price signals for a ticker and computes the percentage price change between the closest signal to `decidedAt` and the most recent signal, giving a lightweight outcome tracker without a dedicated price endpoint.

---

### Toast Notifications
**Files:** `frontend/src/store/pipelineStore.ts`, `frontend/src/App.tsx`

- A dark-themed `Toaster` (sonner) is mounted at the app root.
- INVEST decisions fire a 10-second success toast; MONITOR decisions fire a 5-second info toast — ensuring high-signal pipeline output is visible even when the user is on another tab.
- Action feedback throughout the UI (pipeline run, demo, ticker add/remove, threshold save) also uses toasts.

---

## Dependencies

| Package | Change |
|---|---|
| `sonner` | Added to frontend — toast notification library |
