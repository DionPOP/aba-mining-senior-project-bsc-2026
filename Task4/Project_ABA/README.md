# Project_ABA

Argument-Based Analysis (ABA) web app for exploring hotel-review reasoning:
- `frontend`: static HTML/CSS/JS pages
- `backend`: Node.js API + MySQL queries + Python `py_arg` runner

## Current Structure

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
|     |- js/
|     `- images/
|- database/
|  `- ABA.sql
|- requirements.txt
|- package.json
`- package-lock.json
```

## Tech Stack

- Node.js (Express + mysql2)
- MySQL
- Python + `python-argumentation` (`py_arg`)
- Static frontend (no bundler)

## Prerequisites

- Node.js 18+ (recommended 20 LTS)
- MySQL 8+
- Python 3.10+
- pip

## Installation

```bash
npm install
python -m pip install -r requirements.txt
```

## Database Setup

1. Create database/user:

```sql
CREATE DATABASE IF NOT EXISTS ABA;
CREATE USER IF NOT EXISTS 'aba'@'localhost' IDENTIFIED BY 'aba12345';
CREATE USER IF NOT EXISTS 'aba'@'127.0.0.1' IDENTIFIED BY 'aba12345';
GRANT ALL PRIVILEGES ON ABA.* TO 'aba'@'localhost';
GRANT ALL PRIVILEGES ON ABA.* TO 'aba'@'127.0.0.1';
FLUSH PRIVILEGES;
```

2. Import SQL:

```bash
mysql -u aba -p ABA < database/ABA.sql
```

## Environment Variables

Backend loads `.env` automatically from project root.

```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=aba
DB_PASSWORD=aba12345
DB_NAME=ABA
PYTHON_EXECUTABLE=python

# Optional LLM providers
OPENAI_API_KEY=
GEMINI_API_KEY=
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_TRANSLATE_MODEL=qwen2.5
LLM_TRANSLATE_MODEL=gpt-4o-mini
GEMINI_TRANSLATE_MODEL=gemini-2.5-pro
```

## Run

### 1) Start backend

```bash
npm start
```

Backend runs on:
- `http://localhost:3000`

### 2) Serve frontend

```bash
python -m http.server 5500 --directory frontend
```

Open:
- `http://localhost:5500/homepage.html`
- `http://localhost:5500/review_category.html?type=positive`
- `http://localhost:5500/review_category.html?type=negative`

If backend is on another host, add `api_base` in URL:
- `review_category.html?type=positive&api_base=http://<BACKEND_HOST>:3000`

## Supported Review Topics (Current)

Backend currently supports:
- `check-in`
- `check-out`
- `staff`
- `price`

(`taxi`, `location`, `food`, `room`, etc. are not active in backend topic mapping yet.)

## API Endpoints

### Health
- `GET /api/health`

### Review endpoints
- `GET /api/topic-ratios`
- `GET /api/review-data?topic=<topic>&sentiment=<positive|negative>`

### ABA graph endpoint
- `GET /api/aba-graph`

### PyArg evaluate endpoint
- `POST /api/pyarg/evaluate`

Body (example):

```json
{
  "language": ["happy", "eating", "good_food", "not_eating"],
  "assumptions": ["eating"],
  "contraries": { "eating": "not_eating" },
  "rules": [
    { "name": "Rule1", "premises": ["good_food", "eating"], "conclusion": "happy" }
  ],
  "query": "happy",
  "semantics_specification": "Preferred",
  "strategy_specification": "Credulous"
}
```

### LLM translation endpoint
- `POST /api/llm/translate-extension`

Used by `pyarg.html` for:
- extension natural-language explanation
- graph summary bullets

Model/provider behavior:
- explicit `model` can route provider (`gpt-4o`, `gemini-2.5-pro`, `qwen2.5`, `gemma3:4b`)
- fallback order (auto): Ollama -> OpenAI -> Gemini

## Frontend Flow

1. `homepage.html`: landing page + slider  
2. `review_category.html`: choose topic and supporting proposition  
3. click `Show` -> opens `pyarg.html` with query params  
4. `pyarg.html` calls:
   - `/api/aba-graph`
   - `/api/pyarg/evaluate`
   - `/api/llm/translate-extension` (optional LLM)

## Quick Checks

```bash
curl http://localhost:3000/api/health
curl "http://localhost:3000/api/topic-ratios"
```

## Notes

- No automated tests are configured in `package.json` yet.
- `requirements.txt` currently contains:
  - `python-argumentation`
