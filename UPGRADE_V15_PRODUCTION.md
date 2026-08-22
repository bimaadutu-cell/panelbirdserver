# BirdServer V1 — Upgrade V15 Production Runtime

## Cakupan

Upgrade ini mempertahankan stack Next.js, PostgreSQL/Drizzle, API existing, filesystem `storage/`, autentikasi, server files, console, backup, dan theme existing. Perubahan difokuskan pada reliability backend dan pengalaman panel tanpa mengklaim bahwa software dapat menambah CPU atau RAM yang diberikan Railway.

Runtime server pada deployment ini berjalan sebagai **process group Linux pada host service**. Ia bukan container Docker per customer kecuali deployment memang menyediakan node/agent Docker eksternal. Karena itu, CPU, RAM, disk, dan network tetap berbagi batas container/service Railway.

## Perubahan inti

| Area | Perubahan nyata |
|---|---|
| PostgreSQL | Shared pool global, connection gate, connection/query timeout, reconnect-safe readiness, graceful idle-client error, dan index bootstrap untuk query penting. |
| Schema | Tabel `server_jobs` ditambahkan untuk status queued/running/succeeded/failed/cancelled, phase, progress, PID, command, output terakhir, dan timestamp lifecycle. |
| Runtime | Lifecycle `creating → installing → starting → running`, status `error`, process group terpisah, supervisor script, tracked PID, dan cleanup watcher. |
| Dependency | Deteksi lockfile npm/pnpm/yarn; npm memakai `ci` bila lockfile tersedia; install memakai timeout tahap, retry terbatas, cache preference, dan tidak menghapus lockfile user. |
| Stop/kill/delete | SIGTERM dengan grace period, fallback SIGKILL, job cancellation, process registry cleanup, runtime cache invalidation, safe server directory removal, dan backup file cleanup. |
| Metrics | Dummy metric dihilangkan. CPU/RAM berasal dari process tree, disk dari server directory, dan RX/TX dari `/proc/net/dev` ketika tersedia. Network diberi label host/container scope. |
| Logs | Console log rotation dengan batas default 8 MiB agar proses lama tidak menumbuhkan disk tanpa batas. |
| Cache Manager | Admin dapat melihat storage/temp size dan menjalankan clean temp, clean orphan, atau clean all safe melalui allowlist. Maintenance loop membersihkan temporary artifacts setiap enam jam. |
| Media | Upload background diproses multipart streaming, maksimum 2 GiB, atomic replace, extension allowlist, dan HTTP Range streaming untuk video playback. |
| UI | Hero media preview di server page, grafik realtime 30 sampel, resource cards, status scope yang jujur, durable job progress panel, dan Cache Manager admin. |

## Environment yang disarankan

| Variable | Default | Keterangan |
|---|---:|---|
| `DATABASE_URL` | tidak ada | Wajib di Railway. Gunakan PostgreSQL produksi, bukan fallback lokal. |
| `SESSION_SECRET` | tidak ada | Wajib diisi dengan secret acak panjang. |
| `JWT_SECRET` | fallback dev | Wajib dioverride dengan secret acak panjang. |
| `AGENT_SECRET` | opsional | Gunakan untuk integrasi agent/provision eksternal bila dipakai. |
| `STORAGE_PATH` | `storage/` | Pastikan path atau volume bersifat persistent jika file bot harus bertahan redeploy. |
| `DB_POOL_MAX` | `10` | Batas pool, otomatis dijaga pada rentang 2–30. |
| `DB_CONNECTION_TIMEOUT_MS` | `8000` | Batas koneksi PostgreSQL. |
| `DB_QUERY_TIMEOUT_MS` | `15000` | Batas statement/query. |
| `SERVER_INSTALL_TIMEOUT_SECONDS` | `1800` | Batas tahap install dependency, maksimum 7200 detik. |
| `SERVER_STOP_GRACE_MS` | `8000` | Waktu SIGTERM sebelum SIGKILL. |
| `MAX_CONSOLE_LOG_BYTES` | `8388608` | Batas log console sebelum rotasi. |

## Deploy dan verifikasi

Jalankan perintah berikut pada build environment:

```bash
npm ci --no-audit --no-fund
npm run typecheck
npm run build
npm start
```

Setelah deployment, cek `GET /api/health` dan `GET /api/ready`, login admin, buka System Settings, pastikan Cache Manager dapat membaca storage, buat server uji, jalankan bot ringan, periksa console/SSE, metrics, job panel, stop, restart, dan delete. Setelah delete, server directory dan backup file yang berada di allowlist harus sudah hilang.

## Batasan operasional yang harus dipahami

Upload video maksimum 2 GiB sekarang menggunakan streaming dan byte-range sehingga aplikasi tidak memuat seluruh file ke RAM. Namun, batas proxy/platform dan kapasitas volume Railway tetap berlaku. Persistent storage diperlukan jika video, arsip bot, backup, atau auth state WhatsApp harus bertahan setelah redeploy.

Process group membantu mencegah child process tertinggal pada service yang sama, tetapi tidak memberikan isolasi resource seperti container per customer. Untuk multi-customer dengan kebutuhan isolasi kuat, jalankan runtime pada node/agent terpisah dan gunakan panel sebagai control plane.

Nilai network adalah scope host/container karena Linux standar tidak menyediakan pemisahan trafik per child process melalui `/proc/net/dev`. UI sengaja menampilkan scope tersebut dan tidak menyamarkannya sebagai network usage per server.

## Catatan kompatibilitas

Tabel lama tetap dipertahankan dan bootstrap menggunakan `create table if not exists`, `alter table add column if not exists`, serta index `if not exists`. Database legacy tetap didukung oleh compatibility layer. Saat database belum tersedia, endpoint readiness/health akan melaporkan degraded; fallback URL lokal hanya untuk build atau development.

## Hasil validasi paket ini

Typecheck dan production build lulus setelah upgrade. Lint terarah untuk seluruh file yang diubah lulus tanpa error; lint penuh masih menemukan 18 error hook-style pada komponen existing lain yang belum menjadi bagian dari refactor ini, terutama pola fetch/setState sinkron pada halaman dashboard, server list, backups, schedules, dan subusers. Satu warning yang tersisa pada lint terarah berada pada aturan exhaustive dependency yang berasal dari pola polling existing dan tidak mempengaruhi compile/build.
