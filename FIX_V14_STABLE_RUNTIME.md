# BirdServer V1 — Stable Runtime Fix V14

Perbaikan ini menargetkan kasus panel menampilkan **RUNNING** ketika proses `npm install` masih macet atau sudah mati, serta angka CPU selalu 3%.

## Perubahan utama

- `npm install` sekarang dijalankan sebagai proses nyata dengan batas waktu maksimum 30 menit. Jika install gagal atau timeout, wrapper berhenti dan **npm start tidak dijalankan**.
- Startup command eksplisit seperti `npm install baileys && npm start` tetap dipertahankan. Marker runtime-ready baru dibuat di antara dua perintah setelah install berhasil.
- Status server memakai fase runtime nyata: `starting` selama dependency installation, `running` setelah readiness marker dibuat, dan `stopped` setelah proses wrapper keluar.
- PID zombie tidak lagi dianggap sebagai proses hidup. STOP/KILL tetap tersedia ketika status `starting` agar proses yang benar-benar macet dapat dihentikan.
- CPU/RAM sekarang dihitung dari seluruh pohon proses turunan, tanpa lantai CPU palsu 3%. CPU idle dapat tampil 0%; itu adalah perilaku normal dan bukan crash.
- Heap Node default diturunkan dari 4 GB menjadi 768 MB agar host kecil tidak mengalami tekanan memori ekstrem. Nilai `NODE_OPTIONS` eksplisit tetap dihormati.
- Polling detail server diperlambat menjadi 3 detik; endpoint metrik tetap 2 detik sehingga dashboard tetap realtime tetapi tidak membanjiri backend saat npm berjalan.
- Header server menampilkan `INSTALLING` dengan warna amber selama fase persiapan.

## Validasi

- `npm ci --no-audit --no-fund --progress=false --foreground-scripts` berhasil.
- `npm run typecheck` berhasil.
- `npm run build` berhasil dan menghasilkan seluruh route Next.js.
- `npm start` berhasil berjalan pada smoke test lokal; `/api/health` merespons, dengan status database lokal `degraded` karena tidak ada PostgreSQL lokal di sandbox.

## Catatan deployment

Bangun dan jalankan proyek pada host Node.js persisten. Jangan mengirim `node_modules`, `.next`, atau cache TypeScript ke server; jalankan `npm ci` saat build/deploy, lalu `npm start` hanya setelah build berhasil. Sistem ini menjalankan proses nyata pada host Node.js, tetapi belum memberikan isolasi kernel CPU/RAM/disk seperti Docker/Pterodactyl. Isolasi tersebut memerlukan node/agent container terpisah.

Peringatan lint yang sudah ada pada beberapa komponen React tidak menghalangi `typecheck`, `build`, atau `npm start`; warning/error tersebut tidak berasal dari patch runtime ini.
