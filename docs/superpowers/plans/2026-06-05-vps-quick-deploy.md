# VPS Quick Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Docker/VPS self-host deployment easier with a guided Ubuntu installer and shorter Docker documentation.

**Architecture:** Keep the runtime image and app code unchanged. Add a conservative shell installer that prepares `.env`, starts Docker Compose, checks liveness, and prints explicit next steps without overwriting secrets or registering Discord commands automatically.

**Tech Stack:** Bash, Docker Compose, Markdown docs, Vitest deployment smoke tests.

---

### Task 1: Deployment Smoke Tests

**Files:**
- Modify: `tests/deployment-config.test.ts`

- [ ] Add tests that require `scripts/vps-install.sh` to exist, use strict shell flags, preserve existing `.env`, run `docker compose up -d --build`, check `/livez`, and print register command guidance.
- [ ] Add tests that require `docs/operations/docker.md` to lead with `Quick VPS Deploy`.
- [ ] Add tests that require `.env.example` to document `BABEL_DB_PATH`, `NODE_ENV=production`, and profile selection for VPS/Docker.

### Task 2: Installer Script

**Files:**
- Create: `scripts/vps-install.sh`

- [ ] Implement an idempotent Bash script with `set -euo pipefail`.
- [ ] Check for Docker and Docker Compose.
- [ ] Copy `.env.example` to `.env` only when `.env` is absent.
- [ ] Warn when placeholders remain.
- [ ] Start Compose with `docker compose up -d --build`.
- [ ] Poll `http://localhost:${DASHBOARD_PORT:-3000}/livez`.
- [ ] Print dashboard URL, logs command, and matching register command for Guild or Pocket.

### Task 3: Docker Docs And Env Example

**Files:**
- Modify: `docs/operations/docker.md`
- Modify: `.env.example`

- [ ] Rewrite the top of Docker docs around a first-run quick path.
- [ ] Keep full update, backup, manual Docker, and migration operations.
- [ ] Add concise VPS/Docker comments to `.env.example`.

### Task 4: Verification

**Files:**
- No production file changes.

- [ ] Run targeted deployment config tests.
- [ ] Run typecheck.
- [ ] Run full test suite if targeted checks pass.
