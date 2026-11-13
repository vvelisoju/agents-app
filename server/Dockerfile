# Server image. Bundles Chromium for whatsapp-web.js.
# Prisma provider is "postgresql" — set DATABASE_URL to a postgres connection string.
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium ca-certificates fonts-liberation \
    libnss3 libatk-bridge2.0-0 libgtk-3-0 libasound2 libgbm1 \
 && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate

EXPOSE 4000
# Retry prisma db push until Postgres is ready (Railway starts DB and app simultaneously),
# then boot the server.
CMD sh -c "for i in 1 2 3 4 5; do npx prisma db push --skip-generate && break || (echo 'DB not ready, retrying in 5s...' && sleep 5); done && npx tsx src/index.ts"
