FROM node:22.16.0-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false

# Birdserver's runtime engine uses bash, ps, du and tar.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash procps coreutils tar ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install first so dependency installation is cached separately from source changes.
COPY package.json .npmrc ./
RUN npm install --no-audit --no-fund

COPY . .

# Force the same Node 22 environment used by Railway at build time.
RUN node --version && npm --version && npm run build

EXPOSE 3000

CMD ["npm", "start"]
