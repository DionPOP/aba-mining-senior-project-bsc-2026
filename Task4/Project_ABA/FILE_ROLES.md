# Project File Roles (Detailed)

This document explains what each major file does, how files connect, and where to make changes safely.

If you are new to this repository, read this file together with `README.md`.

---

## 1) High-Level Architecture

The project is a classic **static frontend + API backend + MySQL + Python semantics engine** setup:

1. Users open static pages in `frontend/`.
2. Frontend JavaScript calls backend REST APIs (`backend/server.js` + routes).
3. Backend reads review/argument data from MySQL (`backend/db/queries.js`).
4. For ABA semantics, backend calls Python (`backend/scripts/pyarg_runner.py`) via child process.
5. Backend returns graph/semantics JSON to frontend.
6. Frontend renders graph and optional LLM summaries.

---

## 2) Root-Level Files

- `README.md`  
  Main project guide: setup, run commands, environment variables, API overview.

- `FILE_ROLES.md`  
  This file. Detailed role map of source files and how they interact.

- `package.json`  
  Node project manifest:
  - runtime dependencies (`express`, `mysql2`, `cors`)
  - scripts (`npm start` -> `node backend/server.js`)
  - metadata.

- `package-lock.json`  
  Exact dependency lockfile for reproducible npm installs.

- `requirements.txt`  
  Python packages required by the semantics runner (`python-argumentation` / `py_arg`).

---

## 3) Database

- `database/ABA.sql`  
  SQL schema + seed/import data for the ABA/review domain.
  This is the source of truth for database structure used by backend queries.

When backend behavior appears wrong, verify:
1. expected tables/columns exist in imported schema, and
2. topic-specific tables contain matching data.

---

## 4) Backend Folder (`backend/`)

### 4.1 Entry Point

- `backend/server.js`  
  Main API server bootstrap:
  - loads `.env` from project root
  - creates Express app
  - configures JSON + CORS middleware
  - creates MySQL pool
  - wires query layer, services, and routes
  - exposes health endpoint (`/api/health`)
  - starts listening on `PORT` (default `3000`)

This is the place to change server-wide middleware, app boot logic, and environment defaults.

---

### 4.2 Routes Layer (`backend/routes/`)

Routes are intentionally thin; they delegate business logic to services.

- `backend/routes/review.js`  
  Review-focused endpoints:
  - `GET /api/review-data`
  - `GET /api/topic-ratios`
  Handles request/response and error wrapping only.

- `backend/routes/aba.js`  
  ABA-focused endpoints:
  - `GET /api/aba-graph`
  - `POST /api/pyarg/evaluate`
  - `POST /api/llm/translate-extension`
  Also maps backend errors to HTTP status/payloads.

If you add a new endpoint, define the route here, then put business logic in a service.

---

### 4.3 Services Layer (`backend/services/`)

Services contain business logic and orchestration.

- `backend/services/reviewService.js`  
  Builds response models for review pages:
  - resolves topic/sentiment
  - fetches main rows and contraries
  - computes/sorts ratio data
  - shapes payload for frontend consumption

- `backend/services/abaGraphService.js`  
  Core engine for ABA page logic:
  - builds ABA graph data from DB
  - selects relevant claim/support/attack structures
  - prepares payload for Python semantics
  - executes Python semantics runner (`pyarg_runner.py`)
  - runs LLM translation/summarization routing:
    - Ollama
    - OpenAI
    - Gemini
  - returns unified payload used by `pyarg.html`

If graph behavior, semantics output, or LLM summary format changes, this is usually the file to edit.

---

### 4.4 Query Layer (`backend/db/`)

- `backend/db/queries.js`  
  Centralized SQL access layer.
  Encapsulates table lookups and query functions used by both services.

Purpose:
1. keep SQL out of route handlers,
2. avoid duplicate query strings,
3. make data logic easier to test/refactor.

---

### 4.5 Utility Layer (`backend/utils/`)

- `backend/utils/normalizers.js`  
  Shared normalization and mapping utilities:
  - topic normalization
  - sentiment normalization (`Positive/Negative/All`)
  - head claim extraction helper
  - atom type classification helper

This file also controls which topics are currently mapped to active backend tables.

---

### 4.6 Python Bridge (`backend/scripts/`)

- `backend/scripts/pyarg_runner.py`  
  Standalone Python executable that:
  - reads JSON from stdin
  - validates payload (`language`, `assumptions`, `contraries`, `rules`, semantics/strategy)
  - constructs ABA framework via `py_arg`
  - computes extensions for selected semantics
  - computes accepted assumptions (`Credulous`/`Skeptical`)
  - returns JSON to stdout

Node calls this script through `child_process.spawn`.

Use this file for semantics-level algorithm behavior changes.

---

## 5) Frontend Folder (`frontend/`)

The frontend is static (no React/Vite/Webpack).  
Each page loads direct JS/CSS files from `frontend/assets/`.

### 5.1 HTML Pages

- `frontend/homepage.html`  
  Landing page with hotel info and image slider.

- `frontend/review_category.html`  
  Topic browser page:
  - shows category cards
  - loads supporting/contrary rows
  - includes search/filter UI
  - has `Show` buttons that navigate to `pyarg.html` with query params

- `frontend/pyarg.html`  
  Main ABA visualization page:
  - graph canvas
  - semantics/strategy controls
  - explanation panels
  - guide/legend UI
  - optional LLM summary area

- `frontend/aboutus.html`  
  Team/about page.

---

### 5.2 Frontend JavaScript (`frontend/assets/js/`)

- `api.js`  
  Shared API client helper:
  - resolves API base URL (`api_base` query param support)
  - fallback strategy across candidate bases
  - exposes `apiFetch` to page scripts

- `homepage.js`  
  Slider behavior for landing page:
  - next/prev controls
  - dots navigation
  - autoplay
  - basic touch gestures

- `review_category.js`  
  Main logic for category page:
  - enables/disables topic cards
  - fetches topic ratios and review data
  - renders rows + contraries
  - supports search/filter
  - builds URL to `pyarg.html`

- `graph.js`  
  Shared graph rendering utilities (text sizing/wrapping and common SVG helpers).

- `semantics.js`  
  Shared semantics helpers:
  - normalize extensions
  - compute accepted assumptions
  - render token lists
  - build preferred payload/count lookup helpers

- `pyarg-page.js`  
  Largest frontend logic module:
  - reads URL query params
  - loads graph payload from backend
  - builds/updates interactive SVG graph
  - supports node/edge interactions
  - invokes semantics evaluation endpoint
  - invokes LLM translation/summary endpoint
  - updates UI cards and explanation panels

When behavior in `pyarg.html` changes, edits are usually in this file.

---

### 5.3 Frontend CSS (`frontend/assets/css/`)

- `homepage.css`  
  Styles for homepage layout, slider, and stats section.

- `review_category.css`  
  Styles for review category page and its table/tag UI.

- `pyarg.css`  
  Styles for ABA graph page, controls, cards, legends, and responsive behavior.

- `aboutus.css`  
  Styles for about/team page.

---

### 5.4 Images (`frontend/assets/images/`)

Contains page assets (hotel photos, team photos, background textures).

---

## 6) Data and Request Flow (Practical)

### Flow A: Review list page

1. User opens `review_category.html?type=positive` (or negative).
2. `review_category.js` calls:
   - `GET /api/topic-ratios`
   - `GET /api/review-data?...`
3. User clicks `Show` on a row.
4. Browser navigates to `pyarg.html` with `topic/sentiment/supporting` in query string.

### Flow B: ABA graph page

1. `pyarg-page.js` reads query params.
2. Calls `GET /api/aba-graph` to get graph and metadata.
3. Renders graph in SVG and UI panels.
4. Calls `POST /api/pyarg/evaluate` for selected semantics/strategy.
5. Optional: calls `POST /api/llm/translate-extension` for natural-language explanation and summary.

---





