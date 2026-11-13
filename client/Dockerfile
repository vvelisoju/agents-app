# ── Stage 1: build the React SPA ───────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# VITE_API_URL must be empty when nginx proxies /api/ internally (same VPS).
# Pass a full URL only for split deployment (client on CDN, server on a separate host).
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# ── Stage 2: serve with nginx ───────────────────────────────────────────────
FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
