# Slack Archiver

Automatically archives Slack channel history to PostgreSQL before the free tier's 90-day message limit purges it. Once archived, messages are yours permanently — searchable, exportable, and queryable via a REST API.

![Dashboard](https://img.shields.io/badge/stack-Node.js%20%7C%20TypeScript%20%7C%20PostgreSQL-blue)
![License](https://img.shields.io/badge/license-ISC-green)

---

## The Problem

Slack's free tier deletes messages older than 90 days. For active open-source communities and small teams, this means losing institutional knowledge — decisions, solutions, and discussions that took months to accumulate vanish permanently.

## The Solution

Slack Archiver runs a background worker that pulls new messages from your Slack workspace on a configurable schedule and saves them to a PostgreSQL database. Once saved, messages are permanent — unaffected by Slack's retention policy.

---

## Features

- **Automatic archiving** — a background worker polls Slack every 5 minutes with no manual intervention required
- **Incremental sync** — resumes from where it left off using cursor-based pagination, never re-fetching messages already saved
- **Owner-only access** — verifies Slack Team owner role live on every request via the Slack API
- **Channel management** — add or remove channels from the archive list via REST API or dashboard UI
- **Search** — full-text search across archived messages with optional date range filtering
- **Export** — dump any channel's history to JSON or CSV
- **Read API** — paginated REST API for querying archived messages programmatically
- **Web dashboard** — clean UI for browsing, searching, and managing the archive

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 + TypeScript |
| Web framework | Express |
| Database | PostgreSQL |
| Migrations | node-pg-migrate |
| Slack integration | @slack/web-api |
| Input validation | Zod |
| Logging | Pino |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Two processes                        │
│                                                         │
│  API Server (src/index.ts)        Worker (src/worker/)  │
│  ┌─────────────────────┐         ┌──────────────────┐   │
│  │ OAuth install flow  │         │ Polls every 5min │   │
│  │ Channel management  │         │ Fetches new msgs │   │
│  │ Search + read API   │         │ Saves to Postgres│   │
│  │ Web dashboard       │         │ Resumes from     │   │
│  └──────────┬──────────┘         │ last cursor      │   │
│             │                    └────────┬─────────┘   │
│             └──────────┬─────────────────┘              │
│                        ▼                                │
│              ┌──────────────────┐                       │
│              │   PostgreSQL     │                       │
│              │ teams            │                       │
│              │ channels         │                       │
│              │ messages         │                       │
│              │ archive_runs     │                       │
│              └──────────────────┘                       │
└─────────────────────────────────────────────────────────┘
```

### Key technical decisions

**Cursor-based pagination over OFFSET**
Messages are paginated using `slack_ts` (Slack's Unix timestamp) as the cursor rather than SQL `OFFSET`. This keeps page queries O(log n) regardless of how deep into the archive you go — critical for channels with tens of thousands of messages.

**Sequential channel processing in the worker**
The worker processes channels one at a time rather than in parallel. Slack's rate limits are per-token (per workspace), so parallel requests just hit the limit faster with no throughput gain. Sequential processing makes the rate-limit backoff logic actually effective.

**Soft delete for channels**
Removing a channel from the archive list sets `is_active = false` rather than deleting the row. This preserves the cursor position so re-adding the channel later resumes from where it left off instead of re-fetching everything.

**Raw message JSON stored alongside parsed columns**
Every message saves the full Slack JSON blob in a `jsonb` column alongside parsed fields like `text`, `user`, and `ts`. This means we never lose data from Slack's message format (reactions, blocks, attachments) even if the schema doesn't explicitly model those fields yet.

**Live owner role verification**
The `requireTeamOwner` middleware calls Slack's `users.info` API on every protected request rather than caching the role at install time. Slack roles can change after install, so a cached "is owner" check could grant standing access to someone who's no longer an owner.

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- A Slack workspace you own or administer

### 1. Clone and install

```bash
git clone https://github.com/juan1410/slack-archiver.git
cd slack-archiver
npm install
```

### 2. Create the database

```bash
psql postgres
```

```sql
CREATE USER archiver WITH PASSWORD 'yourpassword';
CREATE DATABASE slack_archiver OWNER archiver;
\q
```

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in your values — especially `DATABASE_URL` and the Slack credentials from step 4.

### 4. Create the Slack App

1. Go to https://api.slack.com/apps → **Create New App** → **From an app manifest**
2. Select your workspace and paste the contents of `slack-app-manifest.json`
3. Copy the **Client ID**, **Client Secret**, and **Signing Secret** into `.env`

### 5. Run migrations

```bash
npm run migrate:up -- --database-url "postgres://archiver:yourpassword@localhost:5432/slack_archiver"
```

### 6. Start the API server

```bash
npm run dev
```

### 7. Install the Slack app into your workspace

Visit `http://localhost:3000/auth/slack/install` in your browser and approve the OAuth flow.

### 8. Start the worker

In a second terminal:

```bash
npm run worker
```

The worker runs an archive cycle immediately on startup, then every `ARCHIVE_POLL_INTERVAL_MS` milliseconds (default: 5 minutes).

### 9. Open the dashboard

Visit `http://localhost:3000` — add a channel and watch messages get archived automatically.

---

## API Reference

All endpoints require `x-slack-user-id` and `x-slack-team-id` headers (Team owner only).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Server health check |
| `GET` | `/auth/slack/install` | Start OAuth install flow |
| `GET` | `/channels` | List archived channels |
| `POST` | `/channels` | Add a channel to archive |
| `DELETE` | `/channels/:channelId` | Remove a channel (soft delete) |
| `GET` | `/api/channels/:channelId/messages` | Query archived messages (paginated) |
| `GET` | `/api/channels/:channelId/search` | Search messages by text and/or date |

### Search params

| Param | Description |
|---|---|
| `q` | Full-text search (case-insensitive) |
| `from` | Start date `YYYY-MM-DD` |
| `to` | End date `YYYY-MM-DD` |

### Messages params

| Param | Description |
|---|---|
| `limit` | Page size (default 100, max 500) |
| `cursor` | `slack_ts` value for keyset pagination |
| `since` | Filter messages at/after this `slack_ts` |
| `until` | Filter messages at/before this `slack_ts` |
| `user` | Filter by Slack user ID |

---

## Export to file

```bash
# JSON
npm run export -- --channel C0123ABCD --team T0123ABCD --format json

# CSV
npm run export -- --channel C0123ABCD --team T0123ABCD --format csv
```

Output files are saved to the `exports/` directory.

---

## Known limitations / future improvements

- **Auth headers vs. real sessions** — the current API uses `x-slack-user-id` / `x-slack-team-id` headers for identity rather than signed JWT sessions. JWT-based auth is the planned next step.
- **Bot token stored in plaintext** — the bot token in the `teams` table should be encrypted at rest in a production deployment.
- **No deployment config yet** — the app runs locally; Railway/Render deployment config is a planned addition.
- **Rate limit** — Slack's `conversations.history` is Tier 3. Verify current limits at https://api.slack.com/apis/rate-limits before assuming any specific throughput number.

---

## License

ISC
