# ---- Build Stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY scripts/prepare-husky.js ./scripts/prepare-husky.js
RUN npm ci
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN npm run build

# ---- Runtime Stage ----
FROM node:22-alpine
WORKDIR /app

RUN addgroup -S babel && adduser -S babel -G babel

COPY --from=build /app/dist ./dist
COPY package.json package-lock.json ./
COPY scripts/prepare-husky.js ./scripts/prepare-husky.js
RUN npm ci --omit=dev && npm cache clean --force

RUN mkdir -p data && chown babel:babel data

USER babel

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3000/livez || exit 1

CMD ["node", "dist/src/index.js"]
