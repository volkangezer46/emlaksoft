# EmlakSoft EİDS posta alıcısı (EP3). Kurulum: scripts/sunucu/install-eids-inbound.sh
# Node 24: TypeScript tip ayıklama ile `node server.ts` doğrudan çalışır (derleme adımı yok).
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.ts ./
USER node
# Konteyner içinde ayrıcalıksız port; compose host 25 -> 2525 eşler.
ENV EIDS_SMTP_PORT=2525
EXPOSE 2525
CMD ["node", "server.ts"]
