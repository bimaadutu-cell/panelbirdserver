# 🐦 BIRDSERVER FREE — Telegram Bot

Bot Telegram untuk membuat akun + server Birdserver dari **tombol Telegram**.

## Flow user

```text
CREATE BIRDSERVER FREE
        ↓
Pilih RAM 1–10 GB
        ↓
Pilih ROLE → USER
        ↓
Pilih NODE
        ↓
Pilih QRIS / LIMIT
        ↓
Birdserver provision
        ↓
Username + Password + Panel URL
```

Tidak ada form username/password manual. Bot membuat credential otomatis dan password disimpan terenkripsi selama transaksi.

## API yang digunakan

Sesuai dokumentasi Birdserver:

```http
POST /api/v1/admin/provision
Authorization: Bearer bs_xxxxxxxxx
Idempotency-Key: provision-xxxxxxxx
Content-Type: application/json
```

Body dasar:

```json
{
  "username": "customerbaru",
  "email": "customerbaru@example.com",
  "password": "SecurePass123!",
  "role": "user",
  "serverName": "Birdserver-2GB-1",
  "templateId": "egg_whatsapp",
  "memoryMb": 2048,
  "cpuPercent": 200,
  "diskMb": 10240,
  "nodeId": "1"
}
```

`nodeId` TIDAK dikirim secara default karena dokumentasi endpoint provision pada panel tidak mendefinisikan field node. Tombol node tetap tersedia di Telegram. Jika API panel kamu memang mendukung field node, aktifkan `BIRDSERVER_SEND_NODE_ID=true` dan atur `BIRDSERVER_NODE_FIELD` sesuai schema API.

## Node default

Bot sudah menyediakan 5 pilihan sesuai node pada panel:

| ID | Node | FQDN | RAM |
|---|---|---|---:|
| 1 | Borealis Compute | 127.0.0.1:8080 | 65536 MB |
| 2 | Vega Hyper | 127.0.0.1:8081 | 49152 MB |
| 3 | Orion Storage | 127.0.0.1:8082 | 65536 MB |
| 4 | Nova Digital | 127.0.0.1:8083 | 32768 MB |
| 5 | Quantum Edge | 127.0.0.1:8084 | 32768 MB |

Node bisa diganti menggunakan `BIRDSERVER_NODES_JSON`.

## Resource

Default:
- 1 GB RAM → 100% CPU
- Disk → 5120 MB per GB RAM
- 10 GB → 1000% CPU + 51200 MB disk

Atur lewat:
- `BIRDSERVER_CPU_PER_GB`
- `BIRDSERVER_DISK_PER_GB_MB`

## Environment

```env
TELEGRAM_BOT_TOKEN=

BIRDSERVER_PANEL_URL=https://panelbirdserver-bimzx.up.railway.app
BIRDSERVER_API_KEY=
BIRDSERVER_TEMPLATE_ID=egg_whatsapp
BIRDSERVER_EMAIL_DOMAIN=example.com
BIRDSERVER_SERVER_PREFIX=Birdserver
BIRDSERVER_SEND_NODE_ID=false

BIRDSERVER_CPU_PER_GB=100
BIRDSERVER_DISK_PER_GB_MB=5120
BIRDSERVER_PRICE_PER_GB=2300

OWNER_ID=
DEVELOPER_IDS=

DEFAULT_LIMIT=2
PAYMENT_ADD_LIMIT=10
LIMIT_PRICE=50000

QR_IMAGE_PATH=assets/qris.png
THUMBNAIL_PATH=assets/thumbnail.jpg
PENDING_PAYMENT_TIMEOUT=1800

ENCRYPTION_KEY=
BOT_NAME=BIRDSERVER FREE
SUPPORT_USERNAME=@administrator
CURRENCY=IDR
```

**Jangan commit `.env` atau API key ke GitHub.**

## Pembayaran

### LIMIT
1. User memilih resource.
2. Bot memanggil `/api/v1/admin/provision`.
3. Jika API sukses, 1 limit dikurangi.
4. Jika API gagal, limit tidak berkurang.

### QRIS
1. Bot membuat order dan menyimpan password secara terenkripsi.
2. Bot mengirim QRIS.
3. User mengirim bukti.
4. Owner menekan **KONFIRMASI**.
5. Bot memanggil Birdserver API.
6. Jika sukses, password terenkripsi dihapus dan credential dikirim ke user.

Anti-double-approve dan idempotency key tetap digunakan.

## Install

```bash
npm install
npm start
```

Node.js **20+**.

### Pterodactyl

Startup:

```bash
npm install && npm start
```

### Railway

Tambahkan seluruh variable `.env` di **Variables**, terutama:
- `TELEGRAM_BOT_TOKEN`
- `BIRDSERVER_PANEL_URL`
- `BIRDSERVER_API_KEY`
- `OWNER_ID`
- `ENCRYPTION_KEY`

## Struktur

```text
bot.js
config.js
api.js
database.js
keyboards.js
helpers.js
middleware.js
handlers/
  createAccount.js
  payment.js
  callbacks.js
  start.js
  limit.js
  admin.js
services/
  accountService.js
  paymentService.js
  userService.js
assets/
  qris.png
  thumbnail.jpg
```


## Update V4
- QRIS image path fixed to `assets/qris.png`.
- QRIS price: 1 GB Rp1.000, 2 GB Rp2.000, linear to 10 GB.
- Role USER and RESELLER; RESELLER is QRIS-only.
- ADMIN role is closed temporarily (`ADMIN_ROLE_CLOSED=true`).
- RESELLER bisa ditutup sementara dari `.env` dengan `RESELLER_CLOSED=true`; ubah ke `false` untuk membuka kembali. Penutupan dicek di tombol role, callback, dan pembuatan payment agar tidak bisa dilewati.
- Account result has native Telegram copy buttons and a direct `BUKA PANEL` button.

## Create akun terbaru
- Saat `CREATE BIRDSERVER`, user wajib memasukkan username terlebih dahulu.
- Password akun dibuat otomatis oleh bot dan tidak diminta dari user.
- Email dibuat otomatis dari username + `BIRDSERVER_EMAIL_DOMAIN`.
- Nama server otomatis mengikuti pola `<username>serverbird_<nomor>`, contoh `agusserverbird_1`.
- Nomor server mengikuti urutan akun milik user dan juga memperhitungkan order ACCOUNT yang masih aktif agar tidak bentrok.
