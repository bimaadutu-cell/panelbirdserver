# BirdServer V1 — Server Open Fix

## Root cause
The server detail API was performing a PostgreSQL `UPDATE` while handling a `GET` request. On the hosted database this could produce a malformed parameter binding such as:

`update "servers" set "status" = $1, "pid" = $2, "updated_at" = $3 where "servers"."id" = $4`

with the PID value omitted, causing `/servers/:id` to return an error page instead of the server console.

## Fix
- `GET /api/v1/servers/:id` is now read-only.
- Runtime status comes from the local runtime metrics and is returned without writing to PostgreSQL.
- Start/stop/kill remain the operations responsible for persisting power state.
- Start runtime now persists PID `0` if the child process does not expose a PID, avoiding a nullable bind on the start path.
- The client keeps an already-loaded server page visible during transient polling errors.

## Validation
Run:

```bash
npm install
npm run typecheck
npm run build
```

Then deploy the resulting project and open `/servers/<server-id>`. The page should render the Console/File Manager/Backups/Databases/Schedules/Subusers/Startup interface without the previous `update servers ... params` error.
