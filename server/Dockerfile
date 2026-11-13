# Server image. Bundles Chromium for the whatsapp-web.js channel (not needed if you
# only use the WhatsApp Cloud API later). For PostgreSQL, change the datasource
# provider in prisma/schema.prisma to "postgresql" and set DATABASE_URL accordingly.
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
# Sync schema, then boot. (Swap db push for `prisma migrate deploy` once you add migrations.)
CMD sh -c "npx prisma db push --skip-generate && npx tsx src/index.ts"
