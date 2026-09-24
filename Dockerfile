FROM node:22-bookworm

# Install Python
RUN apt-get update \
    && apt-get install -y python3 python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# -----------------------------
# Backend dependencies
# -----------------------------

COPY backend/package*.json ./backend/

WORKDIR /app/backend

RUN npm ci

# -----------------------------
# Python dependencies
# -----------------------------

WORKDIR /app

COPY scraper/requirements.txt ./scraper/

RUN python3 -m venv /app/scraper/venv

RUN /app/scraper/venv/bin/pip install --no-cache-dir \
    -r /app/scraper/requirements.txt

# -----------------------------
# Application source
# -----------------------------

COPY backend ./backend
COPY scraper ./scraper

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["node", "backend/src/server.js"]