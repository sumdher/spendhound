# SpendHound

SpendHound is a full-stack expense-tracking MVP built with FastAPI, Next.js, PostgreSQL, Google sign-in, receipt review, budgeting, analytics, and export support.

## MVP features

- Google auth with approval flow
- Manual expense entry and editing
- Receipt upload inside Add expense with preview-before-save extraction
- Editable categories and merchant rules
- Monthly dashboard analytics
- Budget versus actual tracking
- Review queue for uncategorized or low-confidence items
- CSV and JSON exports
- Admin approval panel

## Stack

- Backend: FastAPI + SQLAlchemy + Alembic
- Frontend: Next.js App Router + NextAuth + Recharts
- Database: PostgreSQL
- Optional multimodal receipt extraction via Ollama or another configured LLM provider

## Exact local run path

Run all repository-level commands from:

```text
/home/zorino/repos/spendhound/spendhound_roo/spendhound
```

## Local development with Docker Compose

### 1. Configure environment files

From the repository root, create local env files:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Required values:

- `backend/.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`
- `frontend/.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`

Optional values:

- `ADMIN_EMAIL` to override the default admin email of `srsudhir31@gmail.com`
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for approval emails
- `OLLAMA_URL` or other LLM provider settings for receipt extraction assist
- root `.env` values only if you use `docker-compose.prod.yml` or the optional Cloudflare tunnel service

### Approval email setup for new-user access requests

Approval emails are only sent when a **new non-admin user** signs in and is created with `pending` status.

Set these values in [`backend/.env`](backend/.env):

- `ADMIN_EMAIL=<the inbox that should receive approval requests>`
- `RESEND_API_KEY=<your Resend API key>`
- `APP_URL=<the public frontend URL used in approval links>`
- `RESEND_FROM_EMAIL=<a sender allowed by your Resend account/domain>`

Examples:

- Docker Compose locally: `APP_URL=http://localhost:3001`
- Local frontend dev (`npm run dev`): `APP_URL=http://localhost:3000`

If approval emails are not arriving, the most likely causes in the current code are:

- `RESEND_API_KEY` is blank, so the backend logs a warning and skips sending
- `ADMIN_EMAIL` still points to the default admin address, so the email is sent to the wrong inbox
- `RESEND_FROM_EMAIL` is not valid for your Resend setup, so Resend rejects delivery
- you updated the wrong env file; the backend must receive these values from [`backend/.env`](backend/.env)

### 2. Start the app

From `/home/zorino/repos/spendhound/spendhound_roo/spendhound`:

```bash
docker compose up --build
```

Services:

- Frontend: http://localhost:3001
- Backend API and docs: http://localhost:8000/docs
- PostgreSQL: localhost:5432

The backend container runs `alembic upgrade head` automatically before starting the API.

### 3. Sign in

- Open http://localhost:3001
- Sign in with Google
- `srsudhir31@gmail.com` is the default admin account and is auto-approved on sign-in
- Other users require admin approval before they can enter the app unless `ADMIN_EMAIL` is intentionally cleared or changed

## Local development without Docker

### Backend

```bash
cd /home/zorino/repos/spendhound/spendhound_roo/spendhound/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd /home/zorino/repos/spendhound/spendhound_roo/spendhound/frontend
npm install
cp .env.example .env
npm run dev
```

For non-Docker runs set these frontend values:

- `NEXT_PUBLIC_API_URL=http://localhost:8000`
- `INTERNAL_API_URL=http://localhost:8000`

## Production PostgreSQL backups

SpendHound now includes a host-side systemd backup setup under [`deploy/backup`](deploy/backup) for the production PostgreSQL container defined in [`docker-compose.prod.yml`](docker-compose.prod.yml:1).

Files added:

- [`deploy/backup/spendhound-db-backup.sh`](deploy/backup/spendhound-db-backup.sh)
- [`deploy/backup/spendhound-db-backup.service`](deploy/backup/spendhound-db-backup.service)
- [`deploy/backup/spendhound-db-backup.timer`](deploy/backup/spendhound-db-backup.timer)
- [`deploy/backup/install-spendhound-db-backup.sh`](deploy/backup/install-spendhound-db-backup.sh)

The backup job:

- runs with `set -Eeuo pipefail` and `umask 077`
- locks with `flock` to prevent overlapping runs
- dumps the running `db` container from [`docker-compose.prod.yml`](docker-compose.prod.yml:1)
- writes to a temporary compressed archive first, validates it with `pg_restore --list`, writes a SHA-256 checksum, then atomically renames both files into place
- prunes old backup and checksum files from `/var/backups/spendhound` after the configured retention period

Default schedule:

- daily at `03:15 UTC` with up to `15m` randomized delay
- `Persistent=true`, so missed runs execute after the host comes back up

Run these commands from `/home/zorino/repos/spendhound/spendhound_roo/spendhound` on the production host:

```bash
sudo bash ./deploy/backup/install-spendhound-db-backup.sh
sudo systemctl start spendhound-db-backup.service
sudo systemctl status spendhound-db-backup.timer --no-pager
sudo systemctl list-timers spendhound-db-backup.timer
sudo journalctl -u spendhound-db-backup.service -n 50 --no-pager
```

Notes:

- the installer copies the unit files into `/etc/systemd/system`, writes a drop-in override pointing at this repository checkout, enables the timer, and starts or restarts it
- backups are stored in `/var/backups/spendhound`
- the host must have `systemd`, Docker with the Compose v2 plugin, and a running healthy `db` service from [`docker-compose.prod.yml`](docker-compose.prod.yml:1)

## Receipt extraction flow

1. Open Add expense and switch to the Upload receipt tab
2. SpendHound stores receipt metadata and file contents under `storage/receipts`
3. For receipt images, it sends the image directly to the configured multimodal LLM as the primary extraction path
4. If direct image extraction is unavailable or fails, it falls back to extracted text for PDFs, text files, or secondary robustness
5. The JSON is validated before any database write
6. The user reviews and edits the draft inside Add expense
7. Only the reviewed payload creates an expense

## Running tests

Backend tests live under `backend/tests`.

From `/home/zorino/repos/spendhound/spendhound_roo/spendhound/backend`:

```bash
pip install -e .[dev]
pytest tests/test_expenses_crud.py tests/test_parser.py
```

## Key app routes

- `/dashboard`
- `/expenses`
- `/expenses/new`
- `/receipts` → redirects to `/expenses/new?tab=upload-receipt`
- `/budgets`
- `/categories`
- `/settings`
- `/admin`

## Notes

- Configure a multimodal-capable model for `LLM_PROVIDER` and the matching provider model settings so receipt images can be read directly
- `RECEIPT_MULTIMODAL_MAX_BYTES` controls the largest image sent to the multimodal model
- LLM credentials are stored in the browser for receipt uploads only
- Receipt files are stored under `storage/receipts`
