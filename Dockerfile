FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Dashboard bauen ──────────────────────────────────────────────────────────
FROM node:22-alpine AS dashboard-builder

WORKDIR /app/dashboard

COPY apps/dashboard/package*.json ./
RUN npm ci

COPY apps/dashboard/ ./
RUN npm run build

# ── Production Image ─────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=dashboard-builder /app/dashboard/dist ./apps/dashboard/dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
