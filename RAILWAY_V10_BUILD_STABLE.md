# BirdServer V10 — Railway Build Stable

Fixes:
- Railway build uses `next build --webpack` instead of the Next/Turbopack build path.
- Removed stale `tsconfig.tsbuildinfo`.
- Replaced dynamic child_process require in the runtime metrics path with a static import.
- Explicit Railway Nixpacks buildCommand and persistent startCommand.
- Added .npmrc for reliable npm install behavior.
- Preserved V9 smooth console/metrics/runtime optimizations.

Deploy:
1. Replace the repository contents with this ZIP.
2. Commit as a NEW commit (do not reuse the old commit).
3. Push to GitHub.
4. Railway will build `npm run build` and start `npm start`.
