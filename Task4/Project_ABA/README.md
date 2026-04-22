# Project_ABA (Current Codebase Guide)

Project_ABA is a hotel-review argument analysis system with:
- Static frontend pages (`frontend/`)
- Node.js API backend (`backend/`)
- MySQL data source (`database/ABA.sql`)
- Python semantics runner (`backend/scripts/pyarg_runner.py` using `py_arg`)

This README reflects the current code behavior in this repository.

## Architecture

1. User opens frontend pages (served by Express static middleware or any static server).
2. Frontend calls backend APIs:
   - review data endpoints
   - ABA graph endpoint
   - PyArg evaluation endpoints
   - LLM explanation endpoints
3. Backend reads topic tables + contrary tables from MySQL.
4. Backend builds canonical ABA graph/framework in `abaGraphService`.
5. Backend evaluates semantics via Python (`pyarg_runner.py`).
6. Frontend renders graph layers, semantics result, and optional LLM summaries.

## Repository Structure

```text
Project_ABA/
|- backend/
|  |- db/
|  |  `- queries.js
|  |- routes/
|  |  |- aba.js
|  |  `- review.js
|  |- scripts/
|  |  `- pyarg_runner.py
|  |- services/
|  |  |- abaGraphService.js
|  |  `- reviewService.js
|  |- utils/
|  |  `- normalizers.js
|  `- server.js
|- frontend/
|  |- homepage.html
|  |- review_category.html
|  |- pyarg.html
|  |- aboutus.html
|  `- assets/
|     |- css/
|     `- js/
|- database/
|  `- ABA.sql
|- .env.example
|- FILE_ROLES.md
|- README.md
|- Procfile
|- package.json
|- package-lock.json
`- requirements.txt
```

## Tech Stack

- Node.js (Express 5, `mysql2`, `cors`, `redis`)
- MySQL 8+
- Python 3 + `python-argumentation` (`py_arg`)
- Vanilla HTML/CSS/JS frontend (no bundler)

## Prerequisites

- Node.js 18+
- MySQL 8+
- Python 3.10+
- pip

## Installation

```bash
npm install
python -m pip install -r requirements.txt
```

## Database Setup

1. Create DB/user (example):

```sql
CREATE DATABASE IF NOT EXISTS ABA;
CREATE USER IF NOT EXISTS 'aba'@'localhost' IDENTIFIED BY 'aba12345';
CREATE USER IF NOT EXISTS 'aba'@'127.0.0.1' IDENTIFIED BY 'aba12345';
GRANT ALL PRIVILEGES ON ABA.* TO 'aba'@'localhost';
GRANT ALL PRIVILEGES ON ABA.* TO 'aba'@'127.0.0.1';
FLUSH PRIVILEGES;
```

2. Import schema/data:

```bash
mysql -u aba -p ABA < database/ABA.sql
```

## Environment Variables

Backend loads `.env` from project root.

Core server and DB:

```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=aba
DB_PASSWORD=aba12345
DB_NAME=ABA
CORS_ORIGINS=http://localhost:3000,http://localhost:5500
JSON_BODY_LIMIT=20mb
```

Python / PyArg behavior:

```env
PYTHON_EXECUTABLE=python
PYARG_MAX_STDOUT_BYTES=2097152
PYARG_INCLUDE_DEBUG_FIELDS=0
PYARG_MAX_EXTENSIONS=200
PYARG_RAW_LOG_ENABLED=1
PYARG_RAW_LOG_STDOUT=1
PYARG_RAW_LOG_FILE=logs/pyarg_raw.jsonl
PYARG_RAW_EXCEL_FILE=logs/pyarg_raw.csv
PYARG_LOG_DEDUP_ENABLED=1
PYARG_LOG_DEDUP_TTL_SEC=86400
LOG_ROTATE_MAX_BYTES=10485760
LOG_ROTATE_KEEP=3
```

LLM (currently Ollama only):

```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_TRANSLATE_MODEL=gemma3:4b
LLM_GRAPH_SUMMARY_LOG_FILE=logs/llm_graph_summary.jsonl
LLM_GRAPH_SUMMARY_EXCEL_FILE=logs/llm_graph_summary.csv
LLM_GRAPH_SUMMARY_DEDUP_ENABLED=1
LLM_GRAPH_SUMMARY_DEDUP_TTL_SEC=604800
```

Async job storage (required for `.../jobs` endpoints):

```env
REDIS_URL=redis://...              # or REDIS_TLS_URL=rediss://...
ASYNC_JOB_REDIS_PREFIX=aba:job
REDIS_TLS_REJECT_UNAUTHORIZED=0
LLM_JOB_TTL_MS=300000
LLM_JOB_MAX=120
PYARG_JOB_TTL_MS=1200000
PYARG_JOB_MAX=120
```

Important:
- If `REDIS_URL` is not set, async job endpoints return errors.
- Sync endpoints (`/api/pyarg/evaluate`, `/api/llm/translate-extension`) still work without Redis.

PyArg raw logging:
- Backend logs raw PyArg request/response/error for both sync and async evaluation paths.
- Default stdout log prefix: `[pyarg_raw]` (useful on Heroku log stream).
- Default file log path: `logs/pyarg_raw.jsonl` (local/dev convenience).
- Excel-friendly file log path: `logs/pyarg_raw.csv`.
- Logging is written immediately when payload is received (`status=received`), without waiting for extension output.
- Duplicate writes are suppressed per payload fingerprint (default enabled):
  - `PYARG_LOG_DEDUP_ENABLED=1`
  - `PYARG_LOG_DEDUP_TTL_SEC=86400` (1 day)
- Large file protection (applies to both PyArg and LLM log files):
  - `LOG_ROTATE_MAX_BYTES=10485760` (10MB, rotate when size is >= this value)
  - `LOG_ROTATE_KEEP=3` (keep `file`, `file.1`, `file.2`, `file.3`)
- Each entry is grouped by sections:
  - `meta`: timestamp/status/size/time
  - `stdin_input`: keys sent to Python stdin
    - `language`
    - `assumptions`
    - `contraries`
    - `rules`
    - `query`
    - `semantics_specification`
    - `strategy_specification`
  - `stdout_output` (success) or `error` (failure)
  - `payload_raw` (full original payload)

Heroku note:
- Prefer reading from stdout logs (`heroku logs --tail | findstr pyarg_raw`) because dyno filesystem is ephemeral.

LLM graph-summary logging:
- When `task=graph_summary`, backend appends one JSON line per request/response to:
  - `logs/llm_graph_summary.jsonl` (default), or
  - path from `LLM_GRAPH_SUMMARY_LOG_FILE`
- Backend also appends Excel-compatible CSV rows to:
  - `logs/llm_graph_summary.csv` (default), or
  - path from `LLM_GRAPH_SUMMARY_EXCEL_FILE`
- Duplicate writes are suppressed per graph fingerprint (default enabled):
  - `LLM_GRAPH_SUMMARY_DEDUP_ENABLED=1`
  - `LLM_GRAPH_SUMMARY_DEDUP_TTL_SEC=604800` (7 days)
- Each log line includes:
  - full `request` payload (including `graphNodes` and `graphEdges`)
  - `llm_input` prompts sent to model
  - `llm_output` on success or `error` on failure

## Run

Start backend (also serves frontend static files):

```bash
npm start
```

If you want async job endpoints (`/api/*/jobs`) in local development, start Redis first.

PowerShell example:

```powershell
docker start aba-redis
$env:REDIS_URL="redis://127.0.0.1:6379"
npm start
```

Open:
- `http://localhost:3000/`
- `http://localhost:3000/review_category.html?type=positive`
- `http://localhost:3000/review_category.html?type=negative`

Alternative static serving is possible, but not required because Express already serves `frontend/`.

## Supported Topics

Backend topic mapping is currently limited to:
- `check-in` / `check_in`
- `check-out` / `check_out`
- `staff`
- `price`

Other topics in DB/UI are not supported by backend mapping unless added in `backend/utils/normalizers.js`.

## API Endpoints

### Health
- `GET /api/health`

Response example:

```json
{ "ok": true, "db": true }
```

### Review Data
- `GET /api/topic-ratios`
- `GET /api/review-data?topic=<topic>&sentiment=<positive|negative>`

### ABA Graph
- `GET /api/aba-graph`

Key query params used by backend:
- `topic` (required)
- `supporting` (required)
- `sentiment` = `positive|negative|all` (default `all`)
- `k` (default 8, max 50)
- `attack_mode` = `all|cross` (default `all`)
- `attack_depth` = `1|2` (default `1`)
- `layer_mode` = `layer1|layer2` (default `layer2`)
- `focus_only` = `1|0|true|false|yes|no` (default true)
- `show_all_contrary` = boolean-like
- `semantics` (default `Preferred`)
- `strategy` = `Credulous|Skeptical` (default `Credulous`)

Notes:
- `layer1` keeps levels up to 4.
- `layer2` keeps levels up to 7 (full graph).

### PyArg Evaluate (Sync)
- `POST /api/pyarg/evaluate`

Expected body shape:

```json
{
  "language": ["a", "b", "c"],
  "assumptions": ["a"],
  "contraries": { "a": "not_a" },
  "rules": [
    { "name": "Rule1", "premises": ["a", "b"], "conclusion": "c" }
  ],
  "query": "c",
  "semantics_specification": "Preferred",
  "strategy_specification": "Credulous"
}
```

Supported semantics in Python runner:
- `Stable`
- `Preferred`
- `Conflict-Free`
- `Naive`
- `Admissible`
- `Complete`
- `SemiStable`
- `Grounded`

### PyArg Evaluate (Async Job)
- `POST /api/pyarg/evaluate/jobs` -> returns `202` with `job_id`
- `GET /api/pyarg/evaluate/jobs/:jobId` -> job status/result

### LLM Explanation (Sync)
- `POST /api/llm/translate-extension`

Notes:
- `LLM_PROVIDER` currently supports only `ollama`.
- Model is allowlisted in backend:
  - `gemma3:4b`
  - `deepseek-r1:7b`
  - `qwen2.5:7b`

### LLM Explanation (Async Job)
- `POST /api/llm/translate-extension/jobs` -> returns `202` with `job_id`
- `GET /api/llm/translate-extension/jobs/:jobId` -> job status/result

## Frontend Flow

1. `homepage.html`: entry page.
2. `review_category.html`:
   - loads topic ratios
   - loads positive/negative proposition rows
   - sends selected row to graph page via query string
3. `pyarg.html` (`frontend/assets/js/pyarg-page.js`):
   - loads `/api/aba-graph`
   - renders layered argument graph
   - requests semantics via PyArg (prefers async jobs)
   - requests natural-language explanation via LLM (prefers async jobs)

## Quick Checks

```bash
curl http://localhost:3000/api/health
curl "http://localhost:3000/api/topic-ratios"
curl "http://localhost:3000/api/review-data?topic=staff&sentiment=positive"
```

## Troubleshooting

- `Unsupported topic` on `/api/aba-graph`:
  - topic is not mapped in `TOPIC_TABLES`.

- `Missing topic tables`:
  - DB import incomplete or wrong DB selected.

- PyArg errors:
  - verify Python + `python-argumentation` installation.
  - set `PYTHON_EXECUTABLE` if command name differs.

- Async job endpoints fail immediately:
  - set `REDIS_URL` (or `REDIS_TLS_URL`).

- LLM request fails:
  - ensure Ollama is running at `OLLAMA_BASE_URL`.
  - use allowlisted model names above.

## Additional Documentation

- Detailed file-by-file responsibilities: `FILE_ROLES.md`
