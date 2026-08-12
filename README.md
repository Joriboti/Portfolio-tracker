# Portfolio Tracker

Web app that turns an Excel/Google Sheets export into a live portfolio
dashboard with daily price updates, P&L, and dividend tracking.

## Stack

- **Frontend**: Vite + React 18 + TypeScript + Tailwind CSS + React Router
- **Auth**: [Neon Auth](https://neon.tech/docs/guides/neon-auth) (Better Auth)
- **Database**: Neon Postgres (serverless driver)
- **Backend**: Vercel Serverless Functions (Node 20)
- **Prices**: Yahoo Finance via [yahoo-finance2](https://github.com/gadicc/node-yahoo-finance2) (no API key needed)
- **Cron**: Vercel Cron Jobs (1×/day, post US market close)
- **i18n**: i18next (Catalan + English)

## Local development

```bash
npm install
cp .env.example .env.local   # then edit values
npm run dev
```

The Vite dev server runs at http://localhost:5173. API routes only run on
Vercel (use `vercel dev` if you need them locally).

## First-time database setup

Once you have `DATABASE_URL` configured, run the schema once:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Or paste the SQL into Neon Console → SQL Editor.

## Deployment

1. Push this repo to GitHub.
2. In Vercel, **Add New → Project → Import Git Repository** and pick this repo.
3. In **Project Settings → Environment Variables**, add the values from
   `.env.example` (production-side values).
4. Deploy. Vercel auto-detects Vite and the cron job from `vercel.json`.

## Required environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_NEON_AUTH_URL` | Frontend | Neon Auth endpoint (public) |
| `NEON_AUTH_URL` | Backend | Same value, server-side |
| `DATABASE_URL` | Backend | Postgres connection string |
| `CRON_SECRET` | Backend (optional) | Bearer token to protect the cron |
| `SNAPSHOT_SECRET` | Backend | HMAC key for verified portfolio snapshots (random, 16+ chars) |

### Verified portfolio snapshots

The dashboard can issue a signed snapshot of a portfolio — a shareable card, a
one-page PDF and a public `/verify/:code` page. Two things must be in place or
`/api/snapshot-create` returns a 500 rather than issuing an unsigned card:

1. `db/schema.sql` re-run so `portfolio_snapshots` exists (the file is
   idempotent — `IF NOT EXISTS` throughout).
2. `SNAPSHOT_SECRET` set to a random string of at least 16 characters.

**Rotating `SNAPSHOT_SECRET` invalidates the signature on every card already
issued.** The digest still matches, so the verify page still confirms the
figures are unedited, but it will say the issuer can no longer be confirmed.
Rotate only deliberately.

#### Trust ladder

A card states which of two things it can back up, and the tier is inside the
signed body so a weaker card cannot be passed off as a stronger one:

| Tier | Source | What it attests |
|------|--------|-----------------|
| `self` | the user's imported Excel | TrimmTrack issued these figures at this time and they are unedited |
| `broker` | read directly from the broker | the above, plus that the positions came from the account itself |

Broker-tier snapshots are issued by `api/snapshot-create-broker`, which fetches,
derives and signs in one request. `validateCanonicalBody` rejects a broker tier
unless that route opts in, so a client cannot award itself the badge.

#### Connecting Interactive Brokers

No API key of ours and nothing to pay for. The user creates, inside their own
IBKR account (Performance & Reports → Flex Queries), an Activity Flex Query with
open positions and a Flex Web Service token, then pastes both into the dashboard.
Flex is read-only by construction — it can fetch reports and cannot place an
order or move money. The token is used for the two calls that make up the
handshake and is then discarded: never stored, never logged, never returned.

Two figures the self tier reports are absent from a positions statement and are
not fabricated: IRR is null (no cash-flow history), and realised P&L and
dividends are null, which makes the report omit those rows rather than print a
zero. What the statement does support exactly — the unrealised return on cost —
is labelled as such, so the tiers never present different measures under one word.

Other brokers (Trade Republic, Schwab, Robinhood) have no free official
read-only API. The intended route for those is verifying a DKIM-signed statement
email, which needs no third party and works for any broker that emails
statements — not built yet.

## Excel format

The app expects up to 4 sheets with these exact names:

- `Portfolio 1 (TR)` — buy/sell transactions (Trade Republic)
- `Portfolio 2 (operacions)` — transactions from other brokers
- `Interessos i dividends` — interest + dividend income
- `Patrimoni` — high-level wealth summary

If your spreadsheet doesn't match, the in-app "How to prepare" page provides
a copyable AI prompt that converts arbitrary spreadsheets to this layout.

## Disclaimer

This project is not financial advice. Price data is third-party and may be
delayed or incorrect. Always verify with your broker before making any
decision.
