# Babel Monorepo Design

## Goal

Merge `babel-pocket` into this repository as a monorepo while keeping two product apps:

- **Babel Guild**: server/guild install Discord translator for communities.
- **Babel Pocket**: user-install Discord translator for individuals and trusted friends.

The repository remains named `babel-discord-translator` and becomes the canonical home for both apps.

## Product Boundaries

### Babel Guild

Babel Guild keeps the current server-oriented behavior:

- Message context menu command named `Babel`.
- Slash commands including `/translate`, `/setlang`, `/mylang`, and `/help`.
- Guild allowlist as the primary access model.
- Per-guild budgets and global daily budget.
- Server glossary support.
- Public `/translate` workflow through webhook output.
- Existing dashboard capabilities for server access, budgets, glossary, usage, logs, sessions, health, and provider configuration.

### Babel Pocket

Babel Pocket keeps the user-install behavior from `/Users/HAKU/github/babel/babel-pocket`:

- Message context menu command named `Babel Pocket`.
- User Install command registration with Guild, Bot DM, and Private Channel contexts.
- Slash commands `/setlang`, `/mylang`, and `/help`.
- No public `/translate` command.
- User allowlist as the primary access model.
- Per-user budgets plus default user daily budget.
- Pending user-install owner tracking for unauthorized users seen by the app.
- Private context-menu translation responses only.

## Monorepo Layout

The target layout is:

```text
babel-discord-translator/
  apps/
    babel-guild/
      src/
      scripts/
      public/
      locales/
      package.json
    babel-pocket/
      src/
      scripts/
      public/
      locales/
      package.json
  packages/
    core/
    discord/
    observability/
    persistence/
    providers/
    dashboard/
  tests/
  package.json
  package-lock.json
  tsconfig.base.json
```

The first implementation pass may keep some package boundaries coarse to reduce migration risk, but new code should move toward this layout rather than adding more root-level `src` modules.

## Package Responsibilities

### `packages/core`

Owns product-agnostic translation behavior:

- Translation cache and cache key generation.
- Cooldown handling.
- Language detection and same-language checks.
- Translation service orchestration.
- Prompt resolution.
- Runtime translation limiter.
- User language preferences.
- Guild glossary abstractions, without deciding whether the active app exposes glossary features.

`core` accepts a request scope object and app capabilities. It does not hardcode "Guild" or "Pocket" product names.

### `packages/providers`

Owns provider integration:

- Vertex AI client.
- OpenAI-compatible client.
- Provider orchestrator.
- Provider error classification, retry handling, and sanitized diagnostics.

### `packages/persistence`

Owns durable storage and repositories:

- SQLite connection and migrations.
- Legacy JSON import/export compatibility.
- Config repository.
- Usage repositories.
- Guild budget repository.
- User budget repository.
- Pending user-install owner repository.
- Session repository storage.
- Discord user profile cache.

Migrations must be additive. Existing Babel Guild deployments with migration ids through the current schema must continue to boot without data loss. Pocket-only tables are added to the shared schema so a single database engine can support either app.

### `packages/observability`

Owns operational primitives:

- Structured logger.
- Translation/error log ring buffer.
- App metrics.
- Health, readiness, and liveness helpers.
- Graceful shutdown.

### `packages/discord`

Owns Discord-facing shared helpers:

- Message extraction.
- Discord message formatting.
- Shared Discord command messages.
- Common command handler helpers.

App-specific command registration stays in each app.

### `packages/dashboard`

Owns reusable dashboard server pieces:

- Express app construction.
- Auth/session/CSRF helpers.
- Shared health, logs, monitor, pricing, setup, sessions, and provider routes.
- Static asset serving helpers.
- Capability-driven route registration.

App-specific dashboard capabilities are injected. Babel Guild enables guild access, guild budgets, glossary, and `/translate` documentation. Babel Pocket enables user access, user budgets, pending user-install owners, and user-install documentation.

## App Composition

Each app has a small entrypoint that wires shared packages together.

### Babel Guild Composition

The Guild app creates:

- Discord client.
- Shared translation service with `accessMode: 'guild'`.
- Webhook service for public `/translate`.
- Dashboard with guild capabilities enabled.
- Command handlers for `Babel`, `/translate`, `/setlang`, `/mylang`, and `/help`.
- Register script for guild/server install commands.

### Babel Pocket Composition

The Pocket app creates:

- Discord client.
- Shared translation service with `accessMode: 'user-install'`.
- Dashboard with user-install capabilities enabled.
- Command handlers for `Babel Pocket`, `/setlang`, `/mylang`, and `/help`.
- Register script for User Install commands and contexts.

Pocket does not construct the webhook service because it does not expose public `/translate`.

## Shared Scope Model

Translation, usage, runtime limiting, and logging use one normalized scope:

```ts
export interface TranslationScope {
    guildId?: string | null;
    actorUserId: string;
    billingUserId?: string | null;
}
```

Rules:

- Babel Guild usually sets `guildId` and leaves `billingUserId` null.
- Babel Pocket sets `billingUserId` to the user-install owner from `authorizingIntegrationOwners['1']`, falling back to the interaction user id.
- Usage records global usage plus the active billing scope.
- Runtime limiting keys by `billingUserId` when present, otherwise by `actorUserId`, and optionally by `guildId`.
- Structured logs include both actor and billing user fields when they differ.

## Access And Budget Model

Access checks become capability-driven:

```ts
type AccessMode = 'guild' | 'user-install';
```

For `guild` mode:

- A request is authorized when its guild id is in `allowedGuildIds`.
- Budget lookup uses guild budget first, then global daily budget.

For `user-install` mode:

- A request is authorized when its billing user id is in `allowedUserIds`.
- Unauthorized billing user ids are recorded in `pending_user_install_owners`.
- Budget lookup uses user budget first, then `defaultUserDailyBudgetUsd`, while still enforcing the global daily budget as an instance safety cap.

## Large File Refactoring

The migration should improve maintainability while preserving behavior.

### `dashboard.ts`

Split into focused route modules:

- `dashboard/app.ts`: Express app creation and middleware.
- `dashboard/routes/auth.ts`: login, logout, session, CSRF.
- `dashboard/routes/config.ts`: setup, provider, prompt, runtime config.
- `dashboard/routes/access.ts`: guild or user access routes based on capabilities.
- `dashboard/routes/usage.ts`: global, guild, and user usage endpoints.
- `dashboard/routes/monitor.ts`: health, stats, logs, translation test.
- `dashboard/routes/version.ts`: version and update checks.
- `dashboard/capabilities.ts`: app capability definitions.

### `store.ts`

Split persistence responsibilities:

- Config value reads/writes.
- Budget storage.
- Usage storage.
- Glossary storage.
- User preference storage.
- Session/profile storage stays in dedicated repositories.
- Snapshot/import/export helpers.

### `translation-service.ts`

Split orchestration from decisions:

- Access decision.
- Target language decision.
- Input validation.
- Cache admission.
- Provider execution.
- Usage and metrics recording.
- Response formatting.

The public factory remains easy to consume by app entrypoints.

### `usage.ts`

Split usage into:

- Usage scope normalization.
- Cost calculation.
- Budget selection.
- Daily rollover/history archiving.
- Stats projection for dashboard.

## Testing Strategy

Use test-first changes for behavior-affecting work.

Minimum coverage:

- Babel Guild command registration still includes `Babel` and `/translate`.
- Babel Pocket command registration includes User Install integration types and excludes `/translate`.
- Shared translation service authorizes guild requests.
- Shared translation service authorizes user-install requests by billing owner.
- Unauthorized Pocket billing owners are recorded as pending.
- Usage records global plus guild or user scope correctly.
- User budget fallback and global budget safety cap are both enforced.
- SQLite migrations create guild and user tables without breaking existing data.
- Dashboard capability routes expose guild-only features in Babel Guild and user-only features in Babel Pocket.
- Build, typecheck, lint, and tests run from the monorepo root.

## Migration Strategy

1. Add workspace/package scaffolding without changing runtime behavior.
2. Rename the current app surface to Babel Guild in docs, dashboard labels, and package metadata where appropriate.
3. Import Pocket-specific tests and code into isolated app/package locations.
4. Extract shared packages behind compatibility exports so existing tests can move gradually.
5. Introduce the shared scope/access/budget model.
6. Split the largest files as they are touched by the merge.
7. Update build, dev, register, lint, typecheck, and test scripts for root and per-app workflows.
8. Update deployment docs to explain the two apps and how to select the desired app.

## Backward Compatibility

- Existing Babel Guild data remains valid.
- Existing root deployment docs should keep a clear upgrade path.
- The old `Babel` command name remains for Babel Guild to avoid surprising current users.
- The main package/repository name remains `babel-discord-translator`.
- Public APIs used by tests may move, but app behavior and dashboard endpoints should remain stable unless explicitly app-specific.

## Non-Goals

- Rewriting the dashboard frontend into a new framework.
- Changing translation provider behavior beyond package extraction.
- Changing Discord permissions or adding privileged intents.
- Creating a hosted multi-tenant service.
- Removing existing Babel Guild features.

## Risks

- Package extraction can create circular dependencies between dashboard, persistence, and core.
- SQLite migration ordering must stay compatible with existing deployments.
- Dashboard capability splitting can accidentally expose Pocket-only routes in Guild or Guild-only routes in Pocket.
- Register scripts can overwrite the wrong command surface if app selection is unclear.
- Large file splitting can become a broad refactor if not tied to tests.

## Acceptance Criteria

- `babel-discord-translator` is a monorepo with two apps: Babel Guild and Babel Pocket.
- Shared translation, providers, cache, language detection, logging, metrics, health, and persistence logic are not duplicated between apps.
- Babel Guild preserves current server/guild behavior.
- Babel Pocket preserves user-install behavior from the Pocket repository.
- The largest touched files are split into focused modules as part of the merge.
- Root scripts can build, typecheck, lint, and test the repository.
- Per-app scripts can run and register each app independently.
- Documentation clearly explains repository name, app names, deployment choices, and migration notes.
