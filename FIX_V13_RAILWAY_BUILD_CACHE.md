# BirdServer V13 — Railway Build Cache Fix

## Railway error fixed

Railway/BuildKit failed before `npm run build` with:

`error mounting ... to /app/tsconfig.tsbuildinfo ... not a directory`

The project contained a pre-generated `tsconfig.tsbuildinfo` file while the Railway build cache attempted to mount the same path.

## Changes

- Removed the committed `tsconfig.tsbuildinfo` artifact.
- Disabled TypeScript `incremental` builds in production (`incremental: false`), so Next/TypeScript will not require that file.
- Added `.gitignore` and `.dockerignore` rules for all TypeScript build-info artifacts.
- No application runtime/API logic was changed by this fix.

Redeploy this ZIP from a clean Railway deployment/build. The previous BuildKit cache can be cleared/rebuilt if Railway offers a cache-clear option.
