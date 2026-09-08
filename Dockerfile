FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public
RUN npx prisma generate 2>/dev/null || true
ENV NEXT_PUBLIC_BASE_PATH=/c/who-am-i
RUN npm run build
RUN mkdir -p /prisma-runtime && if [ -f prisma/schema.prisma ]; then cp -r prisma /prisma-runtime/ && cp package.json /prisma-runtime/ && cd /prisma-runtime && npm install prisma --no-save 2>/dev/null; fi

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /prisma-runtime /prisma-runtime
EXPOSE 3000
CMD if [ -f /prisma-runtime/prisma/schema.prisma ]; then if grep -qE 'provider[[:space:]]*=[[:space:]]*"mongodb"' /prisma-runtime/prisma/schema.prisma; then echo "[prisma] mongodb datasource detected - skipping db push (Prisma 6 CLI has no --url flag). Run prisma db push manually once to create indexes."; else cd /prisma-runtime; DB_URL="${DATABASE_URL:-file:/app/data/database.db}"; sed -i '/^\s*url\s*=/d' prisma/schema.prisma; npx prisma db push --url "$DB_URL" --accept-data-loss 2>/dev/null || true; if [ -f prisma/seed.sql ]; then apk add --no-cache sqlite 2>/dev/null; sqlite3 "$(echo $DB_URL | sed s/file://)" < prisma/seed.sql 2>/dev/null || true; fi; cd /app; fi; fi && node server.js
