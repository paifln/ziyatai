FROM node:24.21.0-bookworm-slim AS builder
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && npm run lint && npm test && npm run build && node scripts/build-worker.mjs

FROM node:24.21.0-trixie-slim AS base
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOME=/tmp
WORKDIR /app
RUN groupadd -g 1001 ziyatai && useradd -u 1001 -g ziyatai -M ziyatai

FROM base AS web
COPY --from=builder --chown=ziyatai:ziyatai /app/.next/standalone ./
COPY --from=builder --chown=ziyatai:ziyatai /app/.next/static ./.next/static
COPY --from=builder --chown=ziyatai:ziyatai /app/public ./public
COPY --from=builder --chown=ziyatai:ziyatai /app/dist/preflight.mjs ./preflight.mjs
COPY --from=builder --chown=ziyatai:ziyatai /app/apps/worker/parser.py ./apps/worker/parser.py
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER ziyatai
ENV HOSTNAME=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["sh","-c","node preflight.mjs && exec node server.js"]

FROM base AS worker
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=builder --chown=ziyatai:ziyatai /app/dist ./dist
COPY --from=builder --chown=ziyatai:ziyatai /app/apps/worker ./apps/worker
COPY --from=builder --chown=ziyatai:ziyatai /app/migrations ./migrations
USER ziyatai
CMD ["sh","-c","node dist/preflight.mjs && exec node dist/worker.mjs"]
