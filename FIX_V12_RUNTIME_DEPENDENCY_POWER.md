# BirdServer V12 — Runtime Dependency & Power Action Fix

## Fixed
- Startup settings now have a real PATCH API handler. This removes the previous 405/`Failed to update startup settings` failure.
- Changing startup settings safely stops the running server first, persists the new configuration, and tells the UI to press START to apply it.
- Dependency caching is now self-healing:
  - detects missing `node_modules`
  - detects stale dependency markers
  - verifies top-level `dependencies` and `optionalDependencies`
  - automatically runs `npm ci`/`npm install` when required
  - verifies required packages after installation
- Replacing a bot ZIP with an older/newer `package.json` no longer trusts a stale dependency marker.
- Prevents duplicate concurrent START requests for the same server.
- Power action errors now expose the real API error code/message instead of only `Power action failed`.
- Start webhooks are dispatched only after a successful start operation.
- Console auto-scroll now uses one easing animation loop instead of overlapping native smooth-scroll animations, reducing jitter during high-volume logs.
- TypeScript syntax of all changed files was checked with the installed TypeScript compiler's transpile parser.
