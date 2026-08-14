# BirdServer V2 — Manual + API Key Provisioning Fix

## Yang diperbaiki

1. Endpoint `POST /api/v1/admin/provision` sekarang menerima autentikasi admin melalui:
   - session cookie `birdserver_session`
   - `Authorization: Bearer bs_...`
2. Provisioning API memastikan seed/prasyarat database tersedia sebelum membuat akun/server.
3. Jika node aktif tidak memiliki allocation kosong, sistem mencoba membuat allocation/port otomatis pada rentang 30000–59999.
4. Pembuatan API Key diperbaiki untuk database legacy yang memiliki `api_keys.id` INTEGER/SERIAL.
5. Migrasi `api_keys.user_id` INTEGER → TEXT sekarang melepas foreign-key legacy terlebih dahulu agar PostgreSQL tidak menolak perubahan tipe.
6. UI API Key menampilkan pesan error backend sebenarnya.
7. UI provisioning tidak lagi mengarahkan user ke layanan Telegram ketika create manual gagal; pesan error backend ditampilkan langsung.

## Setelah deploy

1. Login sebagai admin.
2. Buka menu **API Keys**.
3. Klik **Generate New API Key**.
4. Simpan secret `bs_...` yang muncul.
5. Uji dokumentasi endpoint dengan `GET /api/v1/admin/provision`.
6. Uji POST provisioning menggunakan `Authorization: Bearer bs_...`.

## Catatan

Secret API Key hanya dikirim sekali ketika key dibuat. Jangan masukkan secret ke frontend publik, GitHub, atau screenshot.
