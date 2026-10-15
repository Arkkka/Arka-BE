# Arka Backend

Arka Backend adalah Express API dan session runtime untuk sistem latihan rehabilitasi Arka. Backend mengatur autentikasi institusi, otorisasi, data peserta, inventory perangkat, lifecycle permainan, scoring, finalisasi hasil, audit, dan komunikasi realtime dengan browser serta ESP32.

Arka merekam sesi latihan; hasilnya bukan diagnosis atau rekomendasi terapi.

## Trusted Responsibilities

- Better Auth session, onboarding, dan binding institusi
- Participant resolution dengan handle opaque dalam scope institusi
- Device inventory, readiness, reservation, dan cleanup fencing
- Server-authoritative preparation, binding, countdown, playing, pause, abort, interruption, dan completion
- Tiga game engine: `MOTOR_GRIP`, `GO_NO_GO`, dan `SEQUENCE_MEMORY`
- PostgreSQL/Prisma untuk hasil, trial, audit, konfigurasi aturan, dan outbox
- Redis/Valkey untuk presence, runtime singkat, cursor, dan rate limit
- Browser `/ws/app` dan device `/ws/device`
- Worker rangkuman AI lokal nonklinis dan outbox operations

## Technology Stack

| Area | Teknologi |
| --- | --- |
| Runtime | Node.js, TypeScript, TSX |
| HTTP API | Express 5 |
| Authentication | Better Auth |
| Database | PostgreSQL dan Prisma 7 |
| Cache/realtime state | Redis atau Valkey melalui ioredis |
| Validation | Zod |
| Logging | Pino dan Pino HTTP |
| Realtime | `ws` |
| Local AI | Ollama privat |

## API Areas

| Base path | Akses | Tanggung jawab |
| --- | --- | --- |
| `/healthz` | Public | Liveness backend |
| `/readyz` | Public | Koneksi PostgreSQL dan Redis |
| `/docs` | Public | Swagger UI untuk API aplikasi dan autentikasi |
| `/openapi.json` | Public | OpenAPI 3.1 untuk API aplikasi |
| `/api/auth/open-api/generate-schema` | Public | OpenAPI yang dibuat langsung oleh Better Auth |
| `/api/auth/*` | Public/session | Better Auth |
| `/api/v1/me` | Authenticated | Institusi dan sesi aktif |
| `/api/v1/auth/*` | Authenticated | Capability dan onboarding |
| `/api/v1/dashboard/*` | Institution | Summary dan activity |
| `/api/v1/participants/*` | Institution | Resolve, detail, update, history, leaderboard |
| `/api/v1/devices/*` | Institution | Inventory dan status device |
| `/api/v1/game-preparations` | Institution | Preparation, calibration, readiness |
| `/api/v1/game-sessions/*` | Institution | Start, status, snapshot, result |
| `/ws/app` | Authenticated browser | Companion subscription dan session events |
| `/ws/device` | Device credential | ESP32 handshake, telemetry terbatas, command ACK |

Semua input browser divalidasi di boundary API. Authorization berasal dari session server dan institution scope, bukan dari body request atau LocalStorage.

## Environment Variables

Buat `.env` dari `.env.example` dan ganti semua nilai contoh.

| Variable | Keterangan |
| --- | --- |
| `NODE_ENV` | `development`, `test`, atau `production` |
| `HOST` / `PORT` | Bind address dan port HTTP; default port contoh `4001` |
| `DATABASE_URL` | PostgreSQL connection URL |
| `REDIS_URL` | Redis/Valkey connection URL |
| `BETTER_AUTH_SECRET` | Secret minimal 32 karakter |
| `BETTER_AUTH_URL` | Origin backend untuk Better Auth |
| `BROWSER_ORIGINS` | Comma-separated exact origins browser |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional Google OAuth pair |
| `OLLAMA_PROVIDER` | `ollama` atau `openai` untuk endpoint OpenAI-compatible |
| `OLLAMA_BASE_URL` | Base URL provider AI |
| `OLLAMA_API_KEY` | API key untuk provider `openai`; kosong untuk Ollama lokal |
| `OLLAMA_MODEL` | Model yang diizinkan |
| `OLLAMA_MODEL_ALLOWLIST` | Daftar model yang diizinkan |

Nilai timer, lease, retry, dan worker lainnya tersedia lengkap di `.env.example`. Production startup harus memakai HTTPS, secret manager, private database/Redis/Ollama, serta provider yang telah dikonfigurasi.

## Getting Started

### Prerequisites

- Node.js dan npm
- PostgreSQL
- Redis atau Valkey
- Environment variable lengkap
- Ollama privat bila worker rangkuman digunakan

### Installation

```bash
npm ci
```

### Database

```bash
npm run prisma:generate
npm run prisma:migrate
npm run seed
```

`seed` mengaktifkan versi aturan game untuk institusi yang sudah `ACTIVE`. Jalankan hanya terhadap database development atau environment yang memang ditujukan untuk seed.

### Development

```bash
npm run dev
```

### Build and Start

```bash
npm run build
npm start
```

### Quality Checks

```bash
npm run typecheck
npm run build
```

## Project Structure

```text
src/
|-- auth/          # Better Auth dan institution provisioning
|-- config/        # Environment, logger, Prisma, dan konfigurasi runtime
|-- db/            # PostgreSQL dan Redis clients
|-- device/        # Credential, protocol, command, readiness, dan sequence
|-- game/          # Server-authoritative game engines dan rule runtime
|-- middleware/    # Auth, CSRF, rate limit, validation, logging, dan errors
|-- modules/       # Auth, dashboard, participant, device, dan game API modules
|-- realtime/      # Browser/device gateway dan session runtime
|-- routes/        # Mount API modules
|-- schemas/       # Shared server validation schemas
|-- services/      # Audit dan service lintas domain
|-- workers/       # AI summary dan outbox delivery
|-- lifecycle.ts   # HTTP shutdown handling
`-- server.ts      # App bootstrap, health, WebSocket, worker, dan shutdown

prisma/
|-- migrations/    # Forward database migrations
|-- schema.prisma  # Durable data model
`-- seed.ts        # Aktivasi rule development
```

## Operational Notes

- PostgreSQL adalah sumber kebenaran hasil dan audit; Redis bukan sumber hasil.
- Browser hanya merender snapshot/event server dan tidak dapat memfinalisasi hasil.
- ESP32 tidak menerima nama, kode peserta, cookie, token browser, atau hasil.
- Device reservation tetap ada sampai cleanup benar-benar selesai.
- ACK cleanup stale atau duplikat tidak boleh menghapus reservation holder baru.
- Redirect browser bukan bukti hasil atau status sesi; finalisasi dilakukan backend.
- Rangkuman AI selalu nonklinis, plain text tervalidasi, dan tidak memengaruhi lifecycle atau skor.
