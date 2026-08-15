# BirdServer V10 Runtime / Console Fix

## Root cause found
The console screenshot shows `Runtime exited (code=2)`. The dependency bootstrap generated Bash compound statements like:

`if [[ ... ]]; then;`

That is invalid Bash syntax. The previous code built the bootstrap with `].join("; ")`, which inserted a semicolon immediately after `then`. Bash therefore exited with code 2 before the bot could start. The database/runtime status then correctly followed the dead process and showed OFFLINE.

## Fixed
- Dependency bootstrap is now written with newlines, so Bash `if/then/else/fi` blocks are valid.
- Startup/dependency logic is written to `.birdserver-runtime/start-runtime.sh` instead of embedding a large command inside nested `bash -lc` quoting.
- The real bot process remains the tracked runtime process.
- If the bot crashes/exits, runtime state and DB status are synchronized to `stopped`.
- START re-checks the real PID shortly after launch so an immediate crash is not reported as a successful start.
- Empty startup commands fall back to the selected runtime's `npm start`.
- Generic Node.js servers no longer default to EOL Node 23; Telegram/WhatsApp defaults use Node 22.
- Added Railway Node engine range: `>=20.9.0 <27`.

## Console / status
- Auto Scroll now targets the actual console viewport.
- Scrolling uses `requestAnimationFrame` and smooth scrolling instead of `scrollIntoView()`, preventing jumpy movement.
- Console log batching is kept short for responsive live output.
- SSE log polling is 200 ms instead of 1 second.
- SSE heartbeat now emits valid newlines.
- Server detail status polling is 1.5 seconds.

## Railway / TypeScript
- The repository keeps `npm run typecheck` and `npm run build`.
- The uploaded environment did not have npm registry access, so a complete dependency-backed TypeScript/Next build could not be executed here. The modified TypeScript files were parsed with the system TypeScript compiler; no syntax errors were reported. The remaining compiler output was only unresolved external modules/types because `node_modules` could not be installed in this isolated environment.
- A stale `tsconfig.tsbuildinfo` artifact was removed.
