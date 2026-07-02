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
