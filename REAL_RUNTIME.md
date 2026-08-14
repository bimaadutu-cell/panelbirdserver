# Birdserver real-runtime fix

This build removes the fake/container-looking runtime behavior and uses the actual Linux runtime available to the Birdserver process.

## Dependency installation

On every server start, Birdserver can install real project dependencies before launching the bot:

- `package.json` -> real `npm install --no-audit --no-fund --prefer-online`
- `NODE_PACKAGES` -> real npm package installation
- `UNNODE_PACKAGES` -> real npm package removal
- `requirements.txt` -> real `python3 -m pip install`
- `PYTHON_PACKAGES` -> real pip installation
- `OS_PACKAGES` -> real `apt-get` installation when the host has `apt-get` and the process is root

Dependency output is written to the live console stream. A failed dependency installation stops the runtime instead of showing a fake RUNNING state.

## WhatsApp / Telegram

The supplied WhatsApp and Telegram templates run as real Node.js child processes on the host. Their `package.json` dependencies are installed before startup. Uploaded bot files remain under the server storage directory and are not simulated.

WhatsApp authentication data is kept in the server directory so a restart does not intentionally discard the session.

## Console/runtime fix

The previous `tail -F | bash` pipeline could keep a server process alive after the actual bot crashed. This build uses a FIFO for console input, tracks the real startup process, cleans up the feeder process on exit, and synchronizes the stopped state.

## Legacy database compatibility

Manual user creation, manual server creation, reseller creation, and account+server provisioning now detect legacy PostgreSQL integer/text primary keys and reference-column types before inserting. This prevents values such as `usr_xxx` or `srv_xxx` from being sent into integer columns.

API-key creation remains compatible with legacy integer `api_keys.id` columns and current text IDs.

## Important Railway limitation

This is a real host runtime, not a Docker simulation. The `dockerImage` field is still a template/metadata field; it does not create a Docker container by itself. For true Pterodactyl-style isolation, CPU/RAM/disk enforcement, and separate VPS nodes, deploy a dedicated node/agent with Docker/containerd and have the panel communicate with that node. This build is intended for real execution directly on the persistent Railway Node.js host.

## Node runtime manager (V7 runtime fix)

`dockerImage` is no longer treated as a cosmetic label for Node servers. When a server selects `node:23-*` (or sets `NODE_RUNTIME_VERSION=23`), Birdserver downloads the matching official Node.js Linux runtime into that server's `.birdserver-runtime` cache, verifies the SHA-256 checksum from Node.js `SHASUMS256.txt`, and uses that runtime's own `node`, `npm`, and `npx` for both dependency installation and startup.

This is important for packages such as Baileys that execute an `engine-requirements.js` check during `npm install`: the package install scripts now run under the selected Node runtime instead of the Railway panel's host Node version.

Supported examples:
- `NODE_RUNTIME_VERSION=23`
- `NODE_RUNTIME_VERSION=22`
- `NODE_RUNTIME_VERSION=20`
- `NODE_RUNTIME_VERSION=23.11.1`
- `NODE_RUNTIME_VERSION=system`

If the value is `system`, Birdserver uses the host Node. If the value is `system` but the server image is `node:23-*`, the image major is used as the runtime selection. Telegram and WhatsApp templates default to Node 23.

The panel still does not create Docker containers or kernel-level CPU/RAM isolation on Railway. The runtime manager provides a real per-server Node runtime and real dependency installation on the persistent host filesystem.
