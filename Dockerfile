# ---- Build Stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Runtime Stage ----
FROM node:20-alpine
WORKDIR /app

RUN addgroup -S babel && adduser -S babel -G babel

COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN mkdir -p data && chown babel:babel data

USER babel

EXPOSE 3000

CMD ["node", "src/index.js"]
