# News Pulse — Topic-Clustered News Timeline

A full-stack take-home assessment implementation that ingests live RSS news, extracts article text, groups related stories using TF-IDF/cosine similarity, exposes REST APIs, and renders clusters on an interactive timeline.

## Architecture
- `scraper/` Python RSS ingestion, article extraction, TF-IDF clustering, MongoDB persistence.
- `backend/` Node.js/Express REST API and on-demand ingestion jobs.
- `frontend/` Next.js/React interactive timeline, source filters, cluster detail drawer, refresh workflow.
- MongoDB Atlas stores `articles` and `clusters`.

## News sources
BBC News, NPR, and The Guardian public RSS feeds.

## Topic grouping
The pipeline builds TF-IDF vectors from headline + summary + extracted body text and uses cosine similarity with an initial threshold of `0.30`. Articles above that threshold are grouped. Cluster labels are generated from the three highest average TF-IDF terms.

### Why this approach
It is explainable, lightweight, deterministic, and works without an external AI API. The threshold is intentionally configurable/tunable after inspecting live results.

### Limitation
Greedy threshold grouping compares new candidates primarily with the seed article, so a chain of semantically related articles may fragment. TF-IDF also depends on shared vocabulary and can miss paraphrased coverage of the same event.

## Local setup
### 1. MongoDB
Create a MongoDB Atlas database. Copy `scraper/.env.example` to `scraper/.env` and `backend/.env.example` to `backend/.env`; insert the same MongoDB URI.

### 2. Python pipeline
```bash
cd scraper
python -m venv venv
# Windows: venv\\Scripts\\activate
# macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
python pipeline.py
```

### 3. Backend
```bash
cd backend
npm install
npm run dev
```
API defaults to `http://localhost:5000`.

Required endpoints:
- `GET /clusters`
- `GET /clusters/:id`
- `GET /timeline`
- `POST /ingest/trigger`
- `GET /ingest/status/:jobId`

### 4. Frontend
Copy `frontend/.env.local.example` to `frontend/.env.local`.
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:3000`.

## Deployment
Recommended: frontend on Vercel, Node backend + Python pipeline on Render, database on MongoDB Atlas. Environment variables must be configured on hosting platforms rather than committed.

## Assumptions
- An article URL is treated as its stable identity and SHA-256 hashed for duplicate prevention.
- Missing/invalid publication dates fall back to ingestion time.
- Failed full-text extraction does not fail the ingestion run; headline + summary remain available for clustering.
- In-memory ingestion job state is sufficient for the assessment demo; production would persist jobs (e.g. Redis/database queue).

## Before submission
Tune the clustering threshold against actual live results, add your deployed URLs, and record the required 2–3 minute walkthrough.
