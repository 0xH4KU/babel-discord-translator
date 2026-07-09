# Setup Doctor Dashboard Design

## Goal

Add a manual Setup Doctor button inside the authenticated dashboard so operators can run one setup check when something feels wrong. The check should explain whether Discord, commands, providers, SQLite, budgets, and webhook prerequisites look usable.

## Scope

- Add one dashboard button: `Run Doctor`.
- Add one authenticated API endpoint: `POST /api/setup-doctor/run`.
- Return check rows with `status`, `title`, `detail`, and optional `action`.
- Use `pass`, `warn`, `fail`, and `skipped` statuses.
- Do not run automatically, poll in the background, auto-fix settings, register commands, or send webhook messages.

## Checks

Discord token checks the already logged-in Discord client. Because the dashboard currently starts after Discord login succeeds, this catches disconnected or wrong-profile runtime state, not a startup token failure.

Commands uses the existing `getCommandsForProfile()` definitions as the expected list. It reads Discord global application commands with the app id and bot token resolved by `resolveRegistrationEnv()`, then reports missing expected command names. Missing app id or token returns `skipped` with an action to set the registration env vars.

Providers reuse the existing readiness health logic. Enabled providers are probed the same way `/readyz` probes them, and disabled providers stay skipped.

SQLite runs a short write/delete transaction against `app_config` with a reserved `__setup_doctor_probe__` key. This tests the real database file without adding a new table.

Budget validates the current dashboard config values already used by translation accounting: token prices and global/default daily budgets must be non-negative. A zero budget is reported as `warn`, because it is valid but means unlimited spend.

Webhook only applies to Babel Guild. The first available guild channel is inspected for the bot's `ManageWebhooks` permission when possible. If no guild/channel is available, the check is skipped with an action. Babel Pocket reports skipped because it does not use webhook output.

## API Shape

```json
{
  "ok": false,
  "timestamp": "2026-07-09T00:00:00.000Z",
  "checks": [
    {
      "id": "sqlite",
      "status": "pass",
      "title": "SQLite writable",
      "detail": "Database accepted a write/delete probe."
    }
  ]
}
```

`ok` is true only when no check returns `fail`. Warnings do not block `ok`.

## UI

Add a compact card or toolbar row on the existing dashboard screen. The button calls the endpoint only when clicked, shows a loading state, then renders the returned rows. The frontend reuses existing toast and API helpers.

## Error Handling

Each check catches its own error and returns a failed row with a sanitized message. One broken external check should not prevent SQLite or budget checks from running.

## Tests

- Unit-test the doctor result builder for pass, warn, fail, and skipped rows.
- Dashboard API test covers auth, CSRF, and a successful mocked doctor response.
- Frontend smoke coverage stays limited to asset build unless the UI helper gains non-trivial branching.
