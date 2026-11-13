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
# Production image runs on PostgreSQL (dev/tests stay SQLite).
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
RUN npx prisma generate
RUN chmod +x docker-entrypoint.sh

EXPOSE 4000
# Apply the schema (fail the deploy if it can't sync), then start the server.
CMD ["sh", "docker-entrypoint.sh"]
