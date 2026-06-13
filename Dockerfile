# ---- Build Stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps/babel-guild/package.json ./apps/babel-guild/package.json
COPY apps/babel-pocket/package.json ./apps/babel-pocket/package.json
COPY scripts/prepare-husky.js ./scripts/prepare-husky.js
RUN npm ci
COPY apps/ ./apps/
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN npm run build

# ---- Runtime Stage ----
FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache sqlite
RUN addgroup -S babel && adduser -S babel -G babel

COPY --from=build /app/dist ./dist
COPY --from=build /app/apps ./apps
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./tsconfig.base.json
COPY scripts/prepare-husky.js ./scripts/prepare-husky.js
RUN npm ci --omit=dev && npm cache clean --force

RUN mkdir -p data && chown babel:babel data

USER babel

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- "http://localhost:${PORT:-3000}/livez" || exit 1

# Run node directly: `npm start` would keep a resident npm process (~40MB RSS)
# in the container for the whole lifetime, roughly doubling billed memory on
# usage-priced hosts. The default V8 heap cap keeps GC aggressive for this small
# workload; override the BABEL_NODE_* values for larger communities.
CMD ["sh", "-c", "node --max-old-space-size=${BABEL_NODE_MAX_OLD_SPACE_MB:-64} --max-semi-space-size=${BABEL_NODE_MAX_SEMI_SPACE_MB:-4} dist/src/index.js"]
