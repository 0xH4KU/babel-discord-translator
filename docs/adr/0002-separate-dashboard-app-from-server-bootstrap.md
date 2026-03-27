# ADR 0002: Separate Dashboard App Construction From HTTP Server Bootstrap

Status: accepted on March 27, 2026

## Context

- The dashboard previously mixed Express app construction and socket binding in one code path.
- That made testing harder because route behavior, middleware, and auth setup could not be exercised without also starting a listening server.
- The runtime also needed better shutdown control for Docker/PM2 and clearer startup logging.

## Decision

- Keep dashboard route/middleware construction in `createDashboardApp(...)`.
- Start the actual HTTP listener in a separate `startDashboardServer(...)` function.
- Treat the HTTP server as a lifecycle concern owned by the entrypoint, not by the dashboard route module itself.

## Consequences

Positive:

- Tests can build an app instance without binding a port unless they explicitly want to.
- Startup and shutdown are easier to reason about because the server object is created and disposed in one place.
- The production artifact for local, PM2, and Docker runs stays consistent: one compiled entrypoint wires app creation, server startup, and graceful shutdown.

Tradeoffs:

- Startup wiring is slightly more explicit because callers must remember to invoke both app construction and server startup.
- Dependency injection becomes more visible in the entrypoint, which adds some boilerplate but improves boundaries.

## Follow-Up Notes

- This decision also supports future process separation work because the dashboard app can eventually be hosted by a different bootstrap without rewriting route construction.
