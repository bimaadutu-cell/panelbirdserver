# BirdServer V1 — Audit Internal Upgrade

## Ringkasan eksekutif

Project yang diterima adalah aplikasi Next.js 16 dengan PostgreSQL melalui Drizzle ORM, filesystem lokal pada `storage/`, serta engine proses Node/Linux pada `src/lib/agent/engine.ts`. Runtime server saat ini **bukan container Docker terisolasi**; ia menjalankan child process pada host Railway yang sama dengan panel. Karena itu, resource dan isolasi yang dapat dijanjikan harus berasal dari process group, allowlist filesystem, limit konfigurasi, dan observability—bukan klaim penambahan CPU/RAM Railway.

Baseline setelah `npm ci --no-audit --no-fund`:

| Pemeriksaan | Hasil |
|---|---|
| Dependency install | Berhasil; 463 package terpasang |
| TypeScript | Berhasil (`npm run typecheck`) |
| Production build | Berhasil |
| Temuan build | Satu warning Turbopack NFT tracing dari operasi filesystem dinamis di engine |
| Database lokal sandbox | Tidak tersedia; fallback URL lokal hanya untuk build |

## Arsitektur yang ditemukan

| Area | Implementasi existing | Risiko utama |
|---|---|---|
| Panel | Next.js App Router, route API, React/Tailwind | Request handler masih menjadi tempat beberapa pekerjaan berat |
| Database | `pg` Pool global + Drizzle, bootstrap SQL self-heal | Bootstrap per tabel berulang, tanpa index/constraint lifecycle yang cukup, belum ada timeout/pool policy yang eksplisit |
| Runtime | `spawn(bash -lc ...)`, process group, state JSON per server | Tracking hanya satu PID; tidak ada job registry durable; stop langsung menulis stopped tanpa menunggu terminasi |
| Dependency | Bootstrap shell yang menjalankan `npm install`, fallback force/legacy peer deps | Retry berisiko destruktif karena menghapus `package-lock.json`; command package manager belum benar-benar dideteksi dari lockfile |
| Metrics | `du` dan `ps` dengan cache in-memory | Nilai awal masih dummy, network metric tidak tersedia, cache hilang saat restart, proses anak hanya dihitung dari snapshot `ps` |
| Delete | Stop lalu hapus row `servers` | Folder server, runtime cache, log, backup metadata, dan pekerjaan background tidak dibersihkan |
| Filesystem | `getSecurePath()` + banyak operasi sinkron | Validasi path perlu boundary yang lebih ketat; pekerjaan zip/backup masih dapat memakan memori/request thread |
| Theme media | Upload `formData()` dan `arrayBuffer()`; serving `readFileSync()` | Video besar 2 GB akan membebani RAM; belum ada byte-range dan validasi ukuran nyata |
| Realtime | UI memakai polling/EventSource yang sudah ada di beberapa komponen | Belum ada event stream yang konsisten untuk progress job dan perubahan lifecycle |

## Gap prioritas terhadap requirement

1. **P0 — Database reliability.** Tambahkan pool policy, connect gate yang shared, timeout query, graceful error, index bootstrap, dan query yang tidak berjalan sebelum DB ready.
2. **P0 — Lifecycle truth.** Gunakan state machine yang jelas, process registry in-memory yang dibersihkan, process group termination dengan SIGTERM → grace period → SIGKILL, serta rekonsiliasi state.
3. **P0 — Delete cleanup.** Delete harus membatalkan job server, menghentikan descendant process, menghapus runtime/cache/temp dengan allowlist, menghapus backup file, membebaskan allocation, lalu menghapus metadata DB secara aman.
4. **P0 — Dependency engine.** Deteksi npm/pnpm/yarn dari lockfile, jalankan install sebagai tracked job asynchronous, batasi retry, watchdog idle yang tidak mematikan native build terlalu cepat, dan jangan menghapus lockfile user.
5. **P1 — Metrics.** Hilangkan angka dummy, tambahkan disk limit serta RX/TX bila host menyediakan `/proc`, dan gunakan nilai `unknown`/`null` ketika metrik tidak tersedia.
6. **P1 — Large media.** Tulis upload ke disk secara streaming dengan batas 2 GiB, validasi ekstensi/MIME, dan layani media dengan stream serta HTTP Range.
7. **P1 — UI.** Tambahkan ringkasan Pterodactyl-style, grafik realtime, phase/status yang jujur, event console, serta video preview di header server. Preview tidak boleh menggantikan background theme existing.
8. **P2 — Operational documentation.** Dokumentasikan bahwa Railway filesystem ephemeral tanpa volume, bahwa proses panel dan bot berbagi batas container, dan bahwa persistent volume/node terpisah dibutuhkan untuk produksi customer.

## Keputusan desain

Upgrade akan mempertahankan Next.js/Drizzle dan filesystem existing agar kompatibel. Tidak akan membuat klaim bahwa software dapat menambah resource Railway. Bila Docker daemon atau node agent eksternal tidak tersedia, engine akan memperlakukan runtime sebagai process host dan menampilkan keterbatasan tersebut secara eksplisit. Semua operasi berat dipindahkan ke fungsi background/tracked process sejauh arsitektur single-process memungkinkan; endpoint utama hanya memulai pekerjaan dan mengembalikan status job.

## Risiko yang harus divalidasi sebelum rilis

- PostgreSQL Railway harus diuji dengan schema lama yang mengalami drift.
- `storage/` harus persistent bila file bot, backup, media, atau session WhatsApp perlu bertahan setelah redeploy.
- Process isolation pada satu Railway service bukan pengganti container per customer; deployment multi-customer berisiko saling berbagi CPU/RAM/disk.
- Upload 2 GiB tetap bergantung pada limit proxy/platform dan volume disk Railway; streaming mengurangi RAM aplikasi tetapi tidak menghilangkan batas platform.
