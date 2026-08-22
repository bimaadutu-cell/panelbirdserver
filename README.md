# Birdserver V1 — Spidey Control Plane

Modern, low-overhead server management panel by BimzOfficial with a permanent Spidey neon visual system.

## Spidey Neon Upgrade

The upgraded panel uses a blue, neon red, and black visual system across the login screen and the existing panel surfaces. The login page now includes staged entrance motion, animated web/ring decorations, neon focus states, a secure status indicator, and a responsive layout. The global theme is persisted in `storage/system/theme-settings.json`; administrators can also change it from **System Settings → Theme & Background → Save Theme Permanently**.

The animation layer is intentionally lightweight. Decorative motion uses compositor-friendly `transform` and `opacity`, disables itself for reduced-motion and slow-update devices, and does not attempt to fake a guaranteed 120 FPS. The browser and display determine the actual refresh rate; the project avoids unnecessary timers, canvas loops, and continuously repainting blur effects.

## Runtime and ZIP Reliability

Resource telemetry is sampled and cached so disk scans and process scans do not run on every UI request. Disk usage is cached for 10 seconds and process metrics for 1.2 seconds. Server runtimes launch with low-priority CPU and I/O scheduling where the host provides `nice` and `ionice`, keeping the control plane responsive while bot workloads run.

ZIP extraction runs in a child process, validates every archive entry against Zip Slip traversal, and writes nested directories/files without flattening them. This is suitable for complete WhatsApp bot archives containing `package.json`, source folders, configuration files, auth folders, and other nested assets. Dependency installation remains real and is cached by the existing runtime marker, so a restart does not reinstall unchanged dependencies.

### Installing a complete bot ZIP on a server

Upload the ZIP through the server File Manager, select **Extract**, and choose the server root or a target folder. Verify that the extracted folder contains the archive's expected `package.json` and startup files. Configure the startup command and environment variables in the server's Startup view, then start the server. WhatsApp bots should use the supported Node runtime and store authentication data inside the server's persistent storage directory.

The panel cannot make a display run at 120 Hz or accelerate physical CPU, RAM, or disk hardware. It can, however, reduce avoidable application overhead, cache expensive telemetry, keep heavy archive work off the Next.js request thread, and prevent decorative effects from dominating the browser main thread.

## Production persistence checklist

For a customer-facing deployment, use a real PostgreSQL database, persistent filesystem storage for `storage/`, a strong `SESSION_SECRET`, `JWT_SECRET`, and an `AGENT_SECRET`. Ephemeral filesystems can lose uploaded bot archives, runtime caches, theme media, and WhatsApp auth state after redeploys. A persistent volume or external object storage is required when customer servers and bot sessions must survive restarts.


## Railway Deployment

This project is compatible with Railway when the required environment variables are configured.

### Required variables
- `DATABASE_URL`
- `SESSION_SECRET`
- `JWT_SECRET`

Optional but recommended:
- `APP_URL`
- `APP_NAME`
- `STORAGE_PATH`
- `AGENT_SECRET`

Use `.env.example` as the reference.

### Notes
- The app includes a local fallback `DATABASE_URL` for sandbox build safety, but on Railway you should always set a real PostgreSQL `DATABASE_URL`.
- Theme media and generated runtime files are stored on the filesystem. Railway storage is ephemeral unless you add persistent storage.
- For production use, attach a Railway PostgreSQL database and set secrets before first deploy.

### Post-deploy checks
- `GET /api/health`
- `GET /api/ready`
- Admin login
- Admin Provision page
- API key generation and `POST /api/v1/admin/provision`


### V8 runtime fix
- Runtime downloads use only official `nodejs.org` URLs; `nodes.org` is never generated.
- `curl` is preferred and `wget` is a fallback.
- Node 22 is the default for Telegram/WhatsApp templates because Node 23 is upstream EOL; Node 23.11.1 remains available when explicitly selected.
- Downloaded archives are checked against the official `SHASUMS256.txt` before extraction.
- The extracted `node` binary is version-validated before dependency installation or bot startup.

## V15 Production Runtime Upgrade

The production hardening work is documented in [`UPGRADE_V15_PRODUCTION.md`](./UPGRADE_V15_PRODUCTION.md). It covers the shared PostgreSQL connection gate, `server_jobs` lifecycle tracking, process-group termination, dependency manager detection, safe cleanup, actual telemetry, console log rotation, streaming media upload up to 2 GiB, HTTP Range playback, Cache Manager, and the server-page media preview.

The panel reports host/process scope honestly. It does not claim to add Railway CPU/RAM or provide Docker-level isolation when the deployment is a single service. Attach persistent storage for bot files, backups, theme media, and WhatsApp auth state that must survive redeploys.
