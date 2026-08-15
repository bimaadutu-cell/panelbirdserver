# BirdServer V9.1 — Railway Redeploy Fix

## Fixed build failure

The previous V9 archive contained a malformed TypeScript line in
`src/lib/agent/engine.ts`. The metrics optimization patch accidentally
left a literal `\n` in the source after `const treePids = [pid];`.

That caused Railway's TypeScript compiler to report:

`Cannot find name 'treePids'.`

The source is now corrected to real line breaks and the file starts with the
valid `import fs from "fs";` statement.

## Railway deployment

Railway can use the normal Node/Nixpacks flow:

1. Connect the GitHub repository.
2. Redeploy the latest commit.
3. Let Railway run dependency installation.
4. Build with `npm run build`.
5. Start with `npm start`.

`railway.json` explicitly keeps the production start command at `npm start`
and enables automatic restart on failure.

## Important

Do not paste the old V9 `engine.ts` back into the repository after deploying
this version. If using GitHub, replace the repository contents with this
archive and push one clean commit.

The panel performance optimizations remain included: non-blocking metrics,
bounded console rendering, background disk calculation, and reduced polling
pressure.
