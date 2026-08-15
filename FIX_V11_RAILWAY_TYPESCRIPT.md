# BirdServer V11 Railway TypeScript Fix

Fixed `src/app/api/v1/servers/[id]/route.ts` for Next.js 16.

The previous file contained runtime/process/file-system helpers but did not export
valid HTTP route handlers. Next.js therefore failed with:

`RouteHandlerConfig<"/api/v1/servers/[id]">`

The route now exports only `GET` and `DELETE`; runtime logic stays in
`src/lib/agent/engine.ts`.

The GET endpoint also reconciles the database status with the real runtime PID,
and DELETE stops the process and releases the allocation before deleting the DB row.
