# Birdserver V11 — Railway build fix

## Root cause of the V10 failure
Railway's failed build log showed:

    You are using Node.js 18.20.5. For Next.js...

The project uses Next.js 16.2.6, which requires a newer Node.js runtime. The previous version did not force Railway's build environment to Node 22, so a Nixpacks build could select Node 18 and fail before deployment.

## V11 fix
- `package.json` pins Node to `>=22 <23`.
- `.nvmrc` pins Node 22.16.0.
- `Dockerfile` is the primary Railway build path and uses Node 22.16.0.
- Required runtime tools (`bash`, `ps`, `du`, `tar`) are installed in the image.
- The image runs `npm run build` using Node 22, then starts with `npm start`.
- `nixpacks.toml` is also included as a fallback for environments that choose Nixpacks.

## Important
Do not keep an old Dockerfile, `.nvmrc`, or package.json from V9/V10 in the repository. Replace the repository contents with this V11 folder so Railway sees the new build configuration.
