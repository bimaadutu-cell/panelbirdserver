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
