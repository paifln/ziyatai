FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS source
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run licenses:generate && npm run typecheck && npm run lint && npm test

FROM source AS builder
ARG UPLOAD_ORIGIN
ENV UPLOAD_ORIGIN=$UPLOAD_ORIGIN
RUN npm run build

FROM source AS worker-build
RUN node scripts/build-worker.mjs

FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55 AS base
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends ca-certificates libstdc++6 libatomic1 && rm -rf /var/lib/apt/lists/*
COPY --from=source /usr/local/bin/node /usr/local/bin/node
COPY --from=source /usr/local/LICENSE /usr/local/share/doc/node/LICENSE
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOME=/tmp
WORKDIR /app
RUN groupadd -g 1001 ziyatai && useradd -u 1001 -g ziyatai -M ziyatai

FROM base AS web
COPY --from=builder --chown=ziyatai:ziyatai /app/.next/standalone ./
COPY --from=worker-build --chown=ziyatai:ziyatai /app/dist/preflight.mjs ./preflight.mjs
COPY --from=builder --chown=ziyatai:ziyatai /app/apps/worker/parser.py ./apps/worker/parser.py
USER ziyatai
ENV HOSTNAME=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["sh","-c","node preflight.mjs && exec node server.js"]

FROM base AS worker
COPY --from=source /app/package.json /app/package-lock.json ./
COPY --from=worker-build --chown=ziyatai:ziyatai /app/dist ./dist
COPY --from=source --chown=ziyatai:ziyatai /app/apps/worker ./apps/worker
COPY --from=source --chown=ziyatai:ziyatai /app/migrations ./migrations
COPY --from=source /app/public/licenses.txt ./THIRD_PARTY_NOTICES.txt
USER ziyatai
CMD ["sh","-c","node dist/preflight.mjs && exec node dist/worker.mjs"]
