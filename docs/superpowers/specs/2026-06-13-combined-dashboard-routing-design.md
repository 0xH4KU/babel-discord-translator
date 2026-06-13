# Combined Dashboard Routing Design

## Summary

Combined mode should keep the low-cost Railway shape: one Node process, two Discord clients, one SQLite database, one dashboard password. It should not make Guild and Pocket management feel like one blended dashboard.

When `BABEL_APP=combined`, Babel will expose a lightweight product chooser at `/`, visually matching the existing GitHub Pages demo chooser: two cards, one for Babel Guild and one for Babel Pocket. Each card opens a path-scoped dashboard:

- `/guild` for Babel Guild management
- `/pocket` for Babel Pocket management

Direct links should work. If an operator opens `/guild` or `/pocket` while unauthenticated, Babel shows the same password login and then returns them to the requested product dashboard.

## Goals

- Make combined deployments feel like two clean management entrances.
- Keep one shared Railway service and one shared dashboard password.
- Prevent accidental cross-product edits by scoping dashboard UI and API capability responses to the selected path.
- Preserve existing single-product behavior for `BABEL_APP=guild` and `BABEL_APP=pocket`.
- Keep health and metrics endpoints stable for Railway and monitoring.
- Update operator documentation so combined mode is described consistently.

## Non-Goals

- Do not split the SQLite database again.
- Do not create separate dashboard passwords or separate session stores.
- Do not add a new hosted routing service, reverse proxy, or second Railway service.
- Do not redesign the dashboard visual system beyond the chooser and scoped labels needed for clarity.

## Routes

### Combined Mode

| Route | Behavior |
| --- | --- |
| `/` | Login if needed, then show a two-card product chooser. |
| `/guild` | Babel Guild dashboard. If unauthenticated, show login and return to `/guild` after success. |
| `/pocket` | Babel Pocket dashboard. If unauthenticated, show login and return to `/pocket` after success. |
| `/guild/api/*` | Guild-scoped dashboard API. Capability-gated to Guild features. |
| `/pocket/api/*` | Pocket-scoped dashboard API. Capability-gated to Pocket features. |
| `/api/*` | Compatibility API for the currently loaded root UI. In combined mode, the frontend should prefer path-scoped APIs. |
| `/livez`, `/readyz`, `/healthz`, `/metrics` | Stay at root and remain unauthenticated where they are unauthenticated today. |

### Single-Product Mode

Single-product deployments keep today's behavior:

- `/` opens the single product dashboard.
- Existing `/api/*` endpoints continue to work.
- `/guild` and `/pocket` do not become required in single-product mode.
- The first implementation will not add single-product `/guild` or `/pocket` redirects, so existing operator URLs stay unchanged.

## UX

The combined chooser should mirror `docs/demo/index.html`:

- Dark dashboard background.
- One title and one short subtitle.
- Two large cards:
  - Babel Guild: server-install dashboard with guild access, per-server budgets, glossary, and webhook-oriented controls.
  - Babel Pocket: user-install dashboard with user allowlist, pending owners, and user budget controls.

The chooser appears only after authentication when `BABEL_APP=combined`. Operators who have bookmarked `/guild` or `/pocket` should rarely see the chooser.

Each product dashboard should clearly identify the selected product in the title/header. It should expose only the product-specific capability surface:

- Guild path shows guild access, guild budgets, guild glossary, and Guild-oriented labels.
- Pocket path shows user access, pending owner review, user budgets, and Pocket-oriented labels.
- Shared settings such as provider configuration and runtime queue limits may remain available, but labels must make it clear that these affect both products in a combined deployment.

## Server Design

`createDashboardApp` already receives both:

- a default `profile`
- an array of available `profiles`

The server should derive a dashboard scope from the request path in combined mode:

- root chooser scope: no product API scope
- Guild scope: `BABEL_GUILD_PROFILE`
- Pocket scope: `BABEL_POCKET_PROFILE`

The existing auth/session middleware remains shared. Product scoping should affect:

- serialized profile returned by capabilities
- capability flags returned by capabilities
- route availability where a route only applies to Guild or Pocket
- which Discord client is used for Guild or Pocket data

The implementation should avoid duplicating the entire Express app. Prefer mounting scoped routers or passing a scope resolver into existing route handlers, so shared health/auth/session code remains single-source.

## Frontend Design

The frontend should learn its current dashboard scope from `window.location.pathname` and request the matching API base:

- `/guild` uses `/guild/api`
- `/pocket` uses `/pocket/api`
- `/` uses `/api` only for auth/setup checks and chooser boot

After successful login:

- if the user started on `/guild`, stay on `/guild`
- if the user started on `/pocket`, stay on `/pocket`
- if the user started on `/`, show the chooser

The product chooser can live inside `src/public/index.html` as a new view, using existing CSS primitives where possible. It should not be a marketing landing page; it is an operational selector.

## Data And Safety

No data migration is required for this feature. Combined deployments continue using one SQLite file.

The main safety risk is accidentally sending a Pocket management request through Guild capabilities or vice versa. Tests must cover:

- combined `/guild/api/capabilities` returns Guild profile and Guild-only feature flags
- combined `/pocket/api/capabilities` returns Pocket profile and Pocket-only feature flags
- unauthenticated direct deep links still require login
- health and metrics remain available at root
- single-product `/api/capabilities` stays backward compatible

## Documentation

Update these docs so operators see one consistent story:

- `README.md`
- `docs/operations/deployment.md`
- `docs/operations/railway.md`
- `docs/operations/docker.md`

The docs should say:

- `BABEL_APP=combined` runs both products in one process and one SQLite database.
- Combined dashboard management uses `/guild` and `/pocket` as separate entrances.
- `/` shows a chooser in combined mode.
- `/livez`, `/readyz`, `/healthz`, and `/metrics` stay at root.

## Acceptance Criteria

- In combined mode, `/` shows a chooser with Babel Guild and Babel Pocket cards after login.
- In combined mode, `/guild` opens a Guild-scoped dashboard after login.
- In combined mode, `/pocket` opens a Pocket-scoped dashboard after login.
- In combined mode, `/guild/api/capabilities` and `/pocket/api/capabilities` return different product profiles and feature flags.
- In single-product mode, existing `/` and `/api/*` behavior remains unchanged.
- Documentation describes combined dashboard routing consistently.
