# syntax=docker/dockerfile:1.7
# EmlakSoft üretim imajı (Hetzner/Coolify). Derleme: scripts/sunucu/deploy.sh
# Sırlar imaja GİRMEZ: next build yalnız BuildKit gizli bağlamasıyla (--secret id=appenv)
# üretim env'ini okur (NEXT_PUBLIC_* değerleri istemci paketine gömülür, gerisi çalışma anında Coolify env'inden gelir).

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# package.json "packageManager" ile aynı npm (yeni npm kilit dosyasındaki isteğe bağlı wasm paketlerinde katı).
RUN --mount=type=cache,target=/root/.npm npm install -g npm@11.6.2 && npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS build
WORKDIR /app
# Saat dilimi (B076): derlemede üretilen statik çıktı da Türkiye saatiyle biçimlenir (çalışma aşamasıyla aynı).
ENV NEXT_TELEMETRY_DISABLED=1 \
    TZ=Europe/Istanbul
# Derleme yığını: uygulama büyüdükçe varsayılan V8 sınırı yetmiyor (yalnız build aşaması; çalışma imajı etkilenmez).
ENV NODE_OPTIONS=--max-old-space-size=7168
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG RELEASE_SHA=unknown
RUN --mount=type=secret,id=appenv,required=true \
    set -a && . /run/secrets/appenv && set +a && \
    export RELEASE_SHA="$RELEASE_SHA" && \
    npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
# TZ (B076): SSR'daki timeZone'suz Intl/toLocale* çıktısı ve sunucu yerel saati (setHours/getDate) Türkiye saatine
# eşitlenir; UTC konteynerde 14:00 randevu 11:00, gece 00-03 araması önceki gün görünüyordu. Node ICU saat dilimi
# verisini kendisi taşır (tzdata paketi gerekmez). Kod yine de TZ'ye güvenmez: tarih biçimi src/lib/format.ts,
# gün/ay sınırı src/lib/clock.ts (timezone-contract.test.ts yeni timeZone'suz çağrıyı reddeder).
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=Europe/Istanbul \
    PORT=3000 \
    HOSTNAME=0.0.0.0
ARG RELEASE_SHA=unknown
ENV RELEASE_SHA=$RELEASE_SHA
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs \
    && apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD curl -fsS -o /dev/null http://127.0.0.1:3000/robots.txt || exit 1
CMD ["node", "server.js"]
