FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY python/ ./python/
COPY public/ ./public/

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
  && python3 -m venv /app/.venv \
  && /app/.venv/bin/python -m pip install --no-cache-dir -r python/requirements.txt \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
