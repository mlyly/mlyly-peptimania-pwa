# Peptimania PWA + embedded notification relay
#
# The app is still local-first: only `/v1/*` (Web Push relay) needs a server.
# The SQLite file must live on a persistent volume, mounted at `/data`.
#
#   docker build -t peptimania .
#   docker run -p 3000:3000 -v peptimania-data:/data \
#     -e VAPID_PUBLIC_KEY=... -e VAPID_PRIVATE_KEY=... \
#     -e VAPID_SUBJECT=mailto:you@example.com peptimania

FROM node:26-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM node:26-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:26-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NOTIFICATIONS_DB_PATH=/data/notifications.sqlite

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

# SQLite (WAL) needs a writable directory. Named volumes inherit this
# ownership; with a host bind mount, make the mounted directory writable by
# the `node` user (uid 1000).
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
