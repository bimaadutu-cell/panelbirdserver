# BirdServer V1 — Spidey Control Plane Upgrade

## Status

Paket ini berisi upgrade tema dan performa aplikasi yang sudah dikompilasi ulang dengan sukses. Tema default adalah **Spidey Neon** dengan palet biru neon, merah neon, dan hitam. Konfigurasi default tersimpan pada `storage/system/theme-settings.json` dan tetap dapat diubah oleh administrator melalui halaman System Settings.

## Perubahan utama

Halaman login kini memiliki animasi masuk berurutan, mark brand neon, status Secure, state focus input, CTA bergerak, background web laba-laba, ring signal, dan thread vertikal. Global CSS memberi panel lama bahasa visual yang sama tanpa harus menghapus struktur halaman yang sudah ada.

Animasi sengaja menggunakan `transform` dan `opacity` agar dapat diproses compositor browser. Fallback `prefers-reduced-motion` dan `update: slow` tersedia untuk perangkat yang perlu mengurangi animasi. Refresh rate aktual bukan sesuatu yang dapat dipaksa oleh CSS; angka 120 Hz bergantung pada monitor, browser, GPU, dan kondisi perangkat.

Telemetry resource diperlambat dan dicache: penggunaan disk diperbarui setiap 10 detik dan metrik proses setiap 1,2 detik. Ekstraksi ZIP dijalankan di child process agar request thread Next.js tidak tertahan, dan setiap entry diperiksa dari Zip Slip sebelum ditulis.

## Instalasi ke deployment produksi

Jalankan `npm ci --no-audit --no-fund` lalu `npm run build`. Gunakan `npm start` untuk menjalankan aplikasi produksi. Isi `DATABASE_URL`, `SESSION_SECRET`, `JWT_SECRET`, dan `AGENT_SECRET` dengan nilai produksi yang kuat. Pastikan direktori `storage/` memakai persistent volume, karena filesystem ephemeral dapat menghapus arsip bot, runtime yang diunduh, theme media, backup, dan kredensial autentikasi WhatsApp setelah redeploy.

Untuk menjual panel ke customer, buat server terpisah untuk setiap customer atau gunakan node/agent yang memang memiliki isolasi filesystem dan resource. Panel ini dapat mengekstrak ZIP lengkap dengan subfolder dan menjalankan dependency installation sesuai manifest; ketersediaan CPU, RAM, disk, Node.js, Python, OS package manager, dan jaringan tetap bergantung pada node tempat server dijalankan.

## Hasil verifikasi

`npm run typecheck` dan `npm run build` berhasil. Build masih mengeluarkan satu warning tracing Turbopack pada engine runtime yang sudah ada sebelumnya. `npm run lint` pada seluruh proyek masih menemukan error hook-style dan teks yang telah ada di file-file lain sebelum upgrade; file yang diubah lulus lint terarah, sedangkan `globals.css` memang tidak memiliki konfigurasi lint.

Pada lingkungan sandbox tanpa PostgreSQL, halaman login dan endpoint tema publik dapat dimuat, tetapi health check database berstatus degraded karena PostgreSQL lokal tidak berjalan. Deployment produksi harus memakai database PostgreSQL yang benar.
