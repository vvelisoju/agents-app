# Server image. Bundles Chromium for whatsapp-web.js.
# The repo schema is SQLite for zero-setup dev; this image switches it to PostgreSQL
# at build time. Set DATABASE_URL to a postgres connection string.
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
# Production runs on PostgreSQL via the committed schema.postgres.prisma (dev/tests use
# SQLite via schema.prisma). DB-5: no more build-time sed swap.
RUN npx prisma generate --schema prisma/schema.postgres.prisma
RUN chmod +x docker-entrypoint.sh

EXPOSE 4000
# Apply pending migrations (prisma migrate deploy), then start the server.
CMD ["sh", "docker-entrypoint.sh"]
