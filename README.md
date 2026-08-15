# Birdserver V1

Modern server management panel by BimzOfficial.

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
