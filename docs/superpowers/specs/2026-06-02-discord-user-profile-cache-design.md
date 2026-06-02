# Discord User Profile Cache Design

## Goal

Show Discord users as recognizable people in dashboard user-facing tables while keeping Discord user ID as the only authorization key.

## Scope

This feature applies to both Babel and Babel Pocket. Babel Pocket uses it in user whitelist, per-user budgets, and user language preferences. Babel uses it in user language preferences and any future user-scoped dashboard surfaces.

The feature does not change authorization, budget enforcement, or translation behavior. User IDs remain the durable identifier. Username, global name, display name, and avatar URL are cached metadata for operators.

## Data Model

Add a SQLite table named `discord_user_profiles`:

- `user_id TEXT PRIMARY KEY`
- `username TEXT NOT NULL`
- `global_name TEXT`
- `display_name TEXT NOT NULL`
- `avatar_url TEXT NOT NULL`
- `fetched_at TEXT NOT NULL`
- `last_seen_at TEXT`

`display_name` is `globalName`, then `username`, then `userId`. `avatar_url` may be an empty string if Discord does not return an avatar URL.

## Backend Design

Create a focused repository for profile persistence. It supports reading profiles by user ID and upserting profiles from Discord user objects.

Create a dashboard resolver that accepts a Discord `Client`, a repository, and a set of user IDs. It reads cached profiles, refreshes missing or stale profiles with `client.users.fetch(userId)`, writes successful fetches, and returns a `Record<string, DiscordUserProfile>`. Refresh failures do not fail the dashboard request.

The dashboard APIs that expose user IDs include a `profiles` object:

- `/api/user-prefs` returns `{ prefs, count, profiles }`.
- Babel Pocket `/api/user-budgets` returns `{ budgets, profiles }`.
- Existing object-keyed budget data remains available through `budgets` to keep frontend handling explicit.

Interactions can later call the same repository to remember active users, but the first implementation focuses on dashboard correctness and stability.

## Frontend Design

Dashboard rows render a compact user identity block:

- Avatar image from cached profile, falling back to `genAvatar(userId)`.
- Primary text from `displayName`, falling back to `username`, then user ID.
- Secondary text as the Discord user ID.

Search includes user ID, display name, username, and global name.

If no profile exists, the UI keeps the current behavior: generated avatar and user ID text.

## Error Handling

Discord fetch failures are logged at debug or warning level without exposing secrets. The API response still succeeds with any profiles already available. Invalid or empty user IDs are ignored.

## Testing

Tests cover:

- SQLite migration creates the profile table.
- Repository can upsert and retrieve profiles.
- Dashboard user preference API returns profile data.
- Babel Pocket user budget API returns budget data and profiles.
- Frontend helper behavior is covered indirectly by API response tests and existing dashboard render tests.
