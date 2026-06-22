# Guild-Scoped User Language Preferences Design

## Goal

Babel Guild should store user language preferences per Discord server. A user's `/setlang` choice in one server must not affect the same user in another server.

## Scope

- Store preferences by `guildId + userId -> language`.
- Use guild-scoped preferences for Babel Guild translation target resolution.
- Show dashboard preferences grouped by server.
- Support clearing one user's preference in one server and batch-clearing selected server/user pairs.
- Keep legacy rows during migration, but do not treat legacy global preferences as active guild preferences.

## Behavior

`/setlang` and `/mylang` only read and write preferences when the interaction has a `guildId`. Babel Guild commands are server-scoped, so this matches the product model.

Translation target priority becomes:

1. Explicit target language option.
2. Stored language for `guildId + userId`.
3. Discord locale.
4. `auto`.

The dashboard `/api/user-prefs` response returns a flat list of preference entries with `guildId`, `guildName`, `userId`, and `language`, plus profile data keyed by user id. The frontend groups entries by server name/id for display.

## Data

The SQLite `user_language_preferences` table changes from `user_id PRIMARY KEY` to:

```sql
PRIMARY KEY (guild_id, user_id)
```

Existing rows migrate to `guild_id = ''` so upgrades do not discard data. New repository methods only use non-empty guild ids for guild-scoped operations.

## Tests

- Store tests cover same user in two guilds.
- Repository tests cover `guildId` delegation.
- Target language tests cover guild-specific lookup and locale fallback without a guild preference.
- Setlang command tests cover guild id passed to repository.
- Dashboard API tests cover grouped entry payload and scoped deletes.
- Asset tests cover frontend handling of `entry.guildId`.
