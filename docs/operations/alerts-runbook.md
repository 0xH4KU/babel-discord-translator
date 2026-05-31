# Babel Alerts Runbook

This runbook covers the 0.1.0 operations surface: health endpoints, Prometheus metrics, provider fallback signals, runtime queue pressure, budget blocks, and dashboard session control.

## Signals

| Signal | Endpoint / Metric | Page When |
|---|---|---|
| Process down | `GET /livez` | Returns non-200 or times out for 2 minutes |
| Not ready | `GET /readyz` | Returns non-200 for 5 minutes |
| Degraded | `GET /healthz` | `status` is `degraded` for 10 minutes |
| Failure spike | `babel_translation_failures_total` | Increase is above normal traffic baseline |
| Budget blocks | `babel_budget_blocks_total` | Any sustained increase |
| Queue pressure | `babel_runtime_queue_depth`, `babel_runtime_rejections_total` | Queue remains non-zero or rejections increase |
| Provider failure | `babel_provider_requests_total{result="failure"}` | Provider failures increase for an enabled provider |
| Fallback churn | `babel_provider_fallback_total` | Fallbacks increase quickly |

## Prometheus Examples

```promql
increase(babel_translation_failures_total[5m]) > 5
increase(babel_budget_blocks_total[5m]) > 0
babel_runtime_queue_depth > 0
increase(babel_runtime_rejections_total[5m]) > 0
increase(babel_provider_requests_total{result="failure"}[5m]) > 3
increase(babel_provider_fallback_total[10m]) > 2
```

Tune thresholds to each server's normal traffic. Small instances should alert on queue pressure earlier because retries run inside acquired runtime permits.

## Triage Flow

1. Check `/livez`, `/readyz`, and `/healthz`.
2. Open the dashboard Overview tab and read the Operations guidance rows.
3. If provider errors are present, check provider mode, credentials, model names, and recent error logs.
4. If queue pressure is present, inspect runtime limits in Settings and recent traffic volume.
5. If budget blocks are present, inspect global and per-server budgets in Settings and Access.
6. If stale admin sessions are suspected, revoke them from Settings > Dashboard Sessions.
7. Check deployment logs for uncaught errors or repeated restart loops.

## Common Responses

| Symptom | Likely Cause | Response |
|---|---|---|
| `/livez` fails | Process crash, SQLite unavailable, config repository failure | Restart the service, then inspect logs and database path permissions |
| `/readyz` fails but `/livez` passes | Setup incomplete or enabled provider health probe fails | Complete provider config or switch to a healthy fallback provider |
| Provider auth errors | Expired or wrong API key, wrong GCP project, revoked credential | Rotate credentials and test from dashboard Translation Test |
| Queue rejections | Traffic burst, provider slowdown, limits too tight | Raise queue/concurrency carefully, or lower Discord usage temporarily |
| Budget blocks | Daily budget reached or estimate guard would overspend | Raise budget or wait for the daily reset |
| Cache hit rate collapses after deploy | Prompt/model/output-token config changed | Expected after cache-key version changes; monitor provider traffic |

## Release Checks

Before promoting a release:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm audit --audit-level=high
```

After deploy, verify:

```bash
curl -fsS http://localhost:3000/livez
curl -fsS http://localhost:3000/readyz
curl -fsS http://localhost:3000/metrics | head
```
