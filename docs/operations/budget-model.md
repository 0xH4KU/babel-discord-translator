# Babel Budget Model

This document explains how Babel Guild and Babel Pocket enforce monthly translation
spending limits and monthly Babel Lens image quotas. Translation budgets are expressed
in USD per UTC calendar month and are calculated from the configured input and output
token prices.

## Shared Rules

- `0` means unlimited.
- A budget is considered exhausted when current cost is greater than or equal to the
  limit.
- Before a translation runs, Babel estimates the request cost. If current cost plus
  the estimate is greater than or equal to the relevant limit, the request is blocked.
- The monthly counter resets at the start of each UTC calendar month. Short windows are
  rolling and do not reset at a fixed clock time.

Because Babel blocks at `>= limit`, a user or server may be stopped slightly before the
dashboard appears to land exactly on the configured number.

## Rolling Fair-Use Limits

Every finite translation budget is enforced through three nested windows:

| Window         | Default share of monthly budget | Behavior                 |
| -------------- | ------------------------------- | ------------------------ |
| Rolling 5 hour | 5%                              | Short burst protection   |
| Rolling 7 day  | 30%                             | Sustained-use protection |
| UTC month      | 100%                            | Fixed hard ceiling       |

The 5-hour percentage, 7-day percentage, and fair-share multiplier are deployment
settings. They must satisfy `0 < 5-hour <= 7-day <= 100`; the monthly percentage is
always 100 and cannot be changed. Babel stores rolling usage in one-minute buckets, so
the short-window boundary has up to one minute of conservative rounding.

For Pocket, the same three windows apply independently to the user's budget and to the
shared Global Safety Budget. A request must fit under both.

For Guild, each translating user also receives a dynamic share of the server's active
budget window:

```text
user window limit = server window limit * min(1, fair-share multiplier / active users)
```

The default multiplier is `1.5`. Active users are distinct users with a successful
translation in that server during the previous rolling 7 days; the current requester is
included even when this is their first request. Failed translations do not consume
usage. For example, with three active users the default individual ceiling is 50% of
each server window. This is a ceiling, not a reservation: unused shares remain available
to other users subject to their own ceiling and the server ceiling.

Deployment defaults are configured in Settings. Each Guild can override any of the
three configurable values in Access; an empty value inherits the deployment default.
Guild overrides are independent from custom monthly budgets.

## Babel Pocket

Babel Pocket uses user-install access. Its budget model has two layers:

1. Per-user monthly budget
2. Global Safety Budget

### Per-User Monthly Budget

Each user in the User Whitelist can have a custom budget. This is the maximum that
specific user can spend in one month.

If a user does not have a custom budget, Babel uses the default user monthly budget from
configuration. If that default is `0`, the user has no individual cap, but the Global
Safety Budget can still stop them.

### Global Safety Budget

The Global Safety Budget is a shared safety cap across all Pocket user-install usage.
It is not a per-user default. It is the maximum total Pocket spend for the month.

For example:

| User | Per-user budget |
| ---- | --------------- |
| A    | `$0.20`         |
| B    | `$0.20`         |
| C    | `$0.20`         |

If Global Safety Budget is `$0.50`, all three users together cannot spend `$0.60`.
If A spends `$0.20` and B spends `$0.20`, the shared Pocket total is `$0.40`.
C still has a personal `$0.20` limit, but the global cap has less than `$0.10`
remaining before Babel starts blocking requests.

The result is intentionally conservative:

- A user can be blocked by their own user budget.
- A user can also be blocked by the shared Global Safety Budget.
- The sum of all user budgets may be higher than the Global Safety Budget. This is
  allowed and works like overbooking, because not every allowed user is expected to
  spend their full personal budget every month.

### Pocket Dashboard Labels

- Settings: `Global Safety Budget`
- Access tab: per-user budget controls in `User Whitelist`
- Overview: `Monthly Budget` shows shared Pocket usage against the Global Safety Budget

## Babel Guild

Babel Guild uses server-install access. Its budget model is based on Discord servers.

There are two kinds of guild/server budget behavior:

1. Servers with a custom budget
2. Servers without a custom budget

### Servers With Custom Budgets

When a server has a custom monthly budget, that server uses its own independent budget
and usage counter.

Example:

| Server | Budget  |
| ------ | ------- |
| A      | `$0.20` |
| B      | `$0.75` |

Server A can spend up to its own `$0.20`. Server B can spend up to its own `$0.75`.
They do not consume each other's server budget.

If a server custom budget is set to `0`, that server is unlimited.

### Servers Without Custom Budgets

Servers without custom budgets use the Global Monthly Budget. This is a shared pool for
all non-custom-budget servers.

Example:

| Server | Budget mode          |
| ------ | -------------------- |
| A      | Global               |
| B      | Global               |
| C      | `$0.20` custom       |
| D      | `0` custom unlimited |

If the Global Monthly Budget is `$0.50`:

- A and B share the same `$0.50` pool.
- C has its own `$0.20` pool.
- D is unlimited.

Custom-budget server usage is excluded from the shared global pool. This prevents a
server with its own budget from consuming budget intended for servers that use the
global default.

### Guild Dashboard Labels

- Settings: `Global Monthly Budget`
- Access tab: per-server budget controls in the server whitelist
- Overview: `Server Budgets` shows custom server budgets and global-budget servers

## Quick Comparison

| Product | Individual cap       | Shared cap            | What shares the cap            |
| ------- | -------------------- | --------------------- | ------------------------------ |
| Pocket  | User budget          | Global Safety Budget  | All Pocket users               |
| Guild   | Custom server budget | Global Monthly Budget | Servers without custom budgets |

In short:

- Pocket is `per-user cap + shared safety cap`.
- Guild is `custom server caps + shared global pool for non-custom servers`.

## Upgrade From Daily Budgets

The SQLite migration converts existing daily translation budgets to monthly budgets as
`monthly = daily * 30`, including global, default-user, per-server, and per-user values.
An existing `0` remains unlimited. The schema migration runs automatically at startup;
back up the SQLite database before upgrading. Existing monthly usage remains the hard
ceiling immediately after upgrade, while rolling windows begin with newly recorded
minute-level usage.

## Babel Lens Image Quotas

Lens quotas are separate from translation token budgets and reset by UTC month.
The global monthly image limit in Settings is always a hard ceiling across Lens usage.
Access can optionally add a second ceiling for a Guild server or Pocket user:

| Product | Scoped counter | No override       | Scoped limit `0`             |
| ------- | -------------- | ----------------- | ---------------------------- |
| Guild   | Discord server | Global limit only | Disable Lens for that server |
| Pocket  | Install owner  | Global limit only | Disable Lens for that user   |

Unlike translation budgets, a Lens limit of `0` means disabled, not unlimited. A request
must fit under both the global and scoped limits when an override exists. Babel reserves
both counters in one SQLite transaction immediately before an outbound Cloud Vision
request. OCR cache hits and callers joining the same in-flight OCR request do not consume
another image.
