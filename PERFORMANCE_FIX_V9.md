# Birdserver V9 — Smooth Runtime / Panel Responsiveness

## What was fixed

- Console log rendering is frame-batched with `requestAnimationFrame` instead of React-rendering once per npm log line.
- Console history is capped at 600 lines to prevent an ever-growing DOM.
- Auto-scroll no longer runs a smooth animation for every incoming log line.
- Console SSE uses asynchronous file I/O and only reads a bounded initial tail.
- Server metrics no longer recursively scan the entire server directory synchronously on every poll.
- CPU/RAM metrics use asynchronous `ps` and disk usage runs in the background.
- Metrics are cached for 2 seconds and refresh without blocking HTTP requests.
- Server detail polling changed from 3s to 5s and no longer re-authenticates against `/api/auth/me` on every poll.
- Duplicate metrics polling from `ServerMetricsGauge` was removed; the page uses the live metrics already returned by the server detail endpoint.
- Dependency installation no longer runs `npm install` on every restart when `node_modules` and package metadata are unchanged.
- Dependency installation is run with lower CPU priority (`nice -n 10`) when available.

## Important

A browser cannot be forced to render at exactly 120 FPS. The UI is optimized to avoid unnecessary main-thread work and can use 120 Hz when the device/browser/display supports it.

The bot process still shares the same Railway host resources as the Birdserver web process. True Pterodactyl-style CPU/RAM isolation requires separate containers/VMs or separate worker services. This release removes the major application-level event-loop and rendering bottlenecks, but it cannot create hardware/resource isolation that the hosting platform does not provide.
