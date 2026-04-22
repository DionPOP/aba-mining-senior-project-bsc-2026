# FILE_ROLES.md (Current Code Mapping)

This document explains what each major file currently does and where to change behavior safely.

## 1) System Overview

Current system shape:
- Static frontend pages in `frontend/`
- Express API in `backend/`
- MySQL as source data store (`database/ABA.sql`)
- Python `py_arg` runner for formal semantics
- Optional Redis-backed async job queue for long-running PyArg and LLM calls

Request path at runtime:
1. Browser loads `frontend/*.html`.
2. Frontend JS calls `/api/...` endpoints.
3. Backend services fetch and shape DB data.
4. Backend optionally calls Python runner for semantics.
5. Backend optionally calls Ollama for NL explanation.
6. Frontend renders graph + semantics + text explanations.

## 2) Root-Level Files

- `README.md`
  - Setup/run/API guide aligned to current code.

- `FILE_ROLES.md`
  - This file.

- `package.json`
  - Node dependencies and scripts.
  - `npm start` runs `node backend/server.js`.

- `package-lock.json`
  - Locked dependency versions.

- `requirements.txt`
  - Python dependency list (currently `python-argumentation`).

- `.env.example`
  - Example env values used by backend.

- `Procfile`
  - Process declaration for deployment environments.

## 3) Database

- `database/ABA.sql`
  - Schema + seed data.
  - Includes:
    - `head` metadata table (topic/sentiment/claim)
    - topic tables such as `check_in`, `check_out`, `staff`, `price`
    - contrary tables `contrary_<topic_table>`

Backend logic assumes this schema shape. If schema/data changes, query/service logic may need updates.

## 4) Backend (`backend/`)

### 4.1 Entry and App Wiring

- `backend/server.js`
  - Loads `.env` manually from project root.
  - Creates Express app, CORS policy, JSON parser.
  - Serves `frontend/` statically.
  - Creates MySQL pool.
  - Instantiates query layer + services.
  - Registers routers:
    - review router
    - ABA router
  - Exposes `GET /api/health` and `/` -> `homepage.html`.

### 4.2 Routes

- `backend/routes/review.js`
  - `GET /api/review-data`
  - `GET /api/topic-ratios`
  - Thin route layer, delegates to `reviewService`.

- `backend/routes/aba.js`
  - `GET /api/aba-graph`
  - `POST /api/pyarg/evaluate`
  - `POST /api/pyarg/evaluate/jobs`
  - `GET /api/pyarg/evaluate/jobs/:jobId`
  - `POST /api/llm/translate-extension`
  - `POST /api/llm/translate-extension/jobs`
  - `GET /api/llm/translate-extension/jobs/:jobId`

### 4.3 Query Layer

- `backend/db/queries.js`
  - Centralized SQL access helpers.
  - Resolves topic table + contrary table from topic key.
  - Provides DB helpers used by services:
    - head claim lookup by topic/sentiment
    - top assumptions/propositions by claim
    - contrary joins
    - review rows and count aggregation
    - topic ratio source queries

### 4.4 Topic and Sentiment Normalization

- `backend/utils/normalizers.js`
  - `TOPIC_TABLES` source of truth for supported topics:
    - `check-in/check_in`
    - `check-out/check_out`
    - `staff`
    - `price`
  - Topic normalization helpers.
  - Sentiment normalization helpers (`Positive/Negative/All`).
  - Atom-type classifier by naming convention (`no_evident_*`, `have_evident_*`).

### 4.5 Review Service

- `backend/services/reviewService.js`
  - Builds payload for review category page.
  - For selected topic + sentiment:
    - resolves head claim
    - fetches main rows (`proposition`, `assumption`, `cnt`)
    - computes contrary proposition list ranked by opposite-claim counts
  - Computes topic ratio payload (`posTotal/negTotal` and percentages).

### 4.6 ABA Graph + Semantics + LLM Service

- `backend/services/abaGraphService.js`
  - Most complex module in backend.

Core responsibilities:
- Parse and validate `/api/aba-graph` query parameters.
- Build canonical framework from DB data.
- Construct graph nodes/edges/clusters/display rows.
- Construct PyArg payload (`language`, `assumptions`, `contraries`, `rules`).
- Build level-based framework layers (`layer1` or `layer2`).
- Execute PyArg evaluation (sync and async).
- Execute Ollama explanation generation (sync and async).
- Manage Redis-backed async job lifecycle.

Important behavior details:
- `layer_mode=layer1` -> max level 4.
- `layer_mode=layer2` -> max level 7.
- Async jobs require Redis env (`REDIS_URL` or `REDIS_TLS_URL`).
- LLM provider currently accepts only `ollama`.
- LLM model is allowlisted (`gemma3:4b`, `deepseek-r1:7b`, `qwen2.5:7b`).

### 4.7 Python Runner

- `backend/scripts/pyarg_runner.py`
  - Reads JSON payload from stdin.
  - Validates payload consistency.
  - Creates ABAF object via `py_arg`.
  - Computes extensions for requested semantics.
  - Computes accepted assumptions (Credulous/Skeptical).
  - Returns JSON on stdout.

Supported semantics in current script:
- Stable
- Preferred
- Conflict-Free
- Naive
- Admissible
- Complete
- SemiStable
- Grounded

## 5) Frontend (`frontend/`)

### 5.1 Pages

- `frontend/homepage.html`
  - Landing page.

- `frontend/review_category.html`
  - Topic cards + sentiment row panels + search.

- `frontend/pyarg.html`
  - Main ABA graph workspace.
  - Layer controls, semantics/strategy controls, graph panel, explanation cards.

- `frontend/aboutus.html`
  - About/team page.

### 5.2 Shared API Client

- `frontend/assets/js/api.js`
  - Builds candidate API base URLs.
  - Supports `api_base` query parameter override.
  - Retries across candidate bases.
  - Supports per-request timeout via `apiFetch` options.

### 5.3 Page Logic Scripts

- `frontend/assets/js/homepage.js`
  - Homepage interactions (slider and related UI).

- `frontend/assets/js/review_category.js`
  - Enables/disables topic cards.
  - Loads `/api/topic-ratios`.
  - Loads positive/negative rows via `/api/review-data`.
  - Renders row contraries and `Show` button.
  - Navigates to `pyarg.html` with query params.

- `frontend/assets/js/pyarg-page.js`
  - Main graph-page controller.
  - Reads URL parameters (`topic`, `supporting`, `layer_mode`, etc.).
  - Loads graph from `/api/aba-graph`.
  - Renders SVG graph (with count badges and level rows).
  - Requests semantics evaluation (prefers async job endpoint).
  - Requests LLM explanation and graph summary (prefers async job endpoint).
  - Polls job endpoints with timeout and progress handling.

- `frontend/assets/js/graph.js`
  - Graph utility helpers (shared rendering helpers used by graph page script).

### 5.4 Styles

- `frontend/assets/css/homepage.css`
- `frontend/assets/css/review_category.css`
- `frontend/assets/css/pyarg.css`
- `frontend/assets/css/aboutus.css`

## 6) API-to-UI Flow

### Flow A: Review category

1. User selects topic card.
2. `review_category.js` requests:
   - `/api/topic-ratios`
   - `/api/review-data` for positive/negative
3. User clicks `Show` on a proposition.
4. Browser opens `pyarg.html` with selected query params.

### Flow B: ABA graph page

1. `pyarg-page.js` reads query params.
2. Calls `/api/aba-graph`.
3. Draws graph nodes/edges based on response.
4. Sends generated framework payload to `/api/pyarg/evaluate/jobs` (or sync fallback path).
5. Polls job status and renders semantics outputs.
6. Sends explanation request to `/api/llm/translate-extension/jobs`.
7. Polls and renders natural-language explanations.

## 7) Where to Edit for Common Changes

- Add or remove supported topics:
  - `backend/utils/normalizers.js` (`TOPIC_TABLES`)
  - ensure DB tables exist

- Change review row shaping/ranking:
  - `backend/services/reviewService.js`

- Change ABA graph layering, attacks, or framework generation:
  - `backend/services/abaGraphService.js`

- Change semantics algorithm behavior:
  - `backend/scripts/pyarg_runner.py`

- Change endpoint contracts:
  - route file (`backend/routes/*.js`) + corresponding service

- Change graph page behavior/UI:
  - `frontend/assets/js/pyarg-page.js`
  - `frontend/assets/css/pyarg.css`
  - `frontend/pyarg.html`

## 8) Operational Notes

- No automated test suite is configured currently (`npm test` is placeholder).
- Async endpoints depend on Redis configuration.
- LLM path currently depends on Ollama endpoint availability.
