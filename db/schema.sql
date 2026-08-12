-- Portfolio Tracker — initial schema
-- Run this once against your Neon database. Re-running is safe (IF NOT EXISTS).
--
-- Notes:
--   - We DO NOT define a `users` table here. Neon Auth handles users in the
--     `neon_auth` schema. We reference users by their stable user_id (TEXT).
--   - All money/price columns are NUMERIC for accuracy.

CREATE TABLE IF NOT EXISTS transactions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  portfolio     TEXT NOT NULL,
  ticker        TEXT NOT NULL,
  shares        NUMERIC(20, 8) NOT NULL DEFAULT 0,
  buy_price     NUMERIC(20, 8),
  buy_value     NUMERIC(20, 8),
  buy_date      DATE,
  sell_shares   NUMERIC(20, 8),
  sell_price    NUMERIC(20, 8),
  sell_value    NUMERIC(20, 8),
  sell_date     DATE,
  result        NUMERIC(20, 8),
  source_currency TEXT NOT NULL DEFAULT 'EUR',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_ticker
  ON transactions (user_id, ticker);

CREATE TABLE IF NOT EXISTS dividends (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  ticker      TEXT NOT NULL,
  amount      NUMERIC(20, 8) NOT NULL,
  paid_at     DATE,
  currency    TEXT NOT NULL DEFAULT 'EUR',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dividends_user
  ON dividends (user_id);

CREATE TABLE IF NOT EXISTS interests (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  amount      NUMERIC(20, 8) NOT NULL,
  paid_at     DATE,
  currency    TEXT NOT NULL DEFAULT 'EUR',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wealth_entries (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('stocks', 'cash')),
  label       TEXT NOT NULL,
  value       NUMERIC(20, 8) NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'EUR',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Daily price snapshots, shared across all users (no user_id).
-- Keyed by ticker + date.
CREATE TABLE IF NOT EXISTS prices (
  ticker      TEXT NOT NULL,
  as_of       TIMESTAMPTZ NOT NULL,
  price       NUMERIC(20, 8) NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  source      TEXT NOT NULL DEFAULT 'yahoo',
  PRIMARY KEY (ticker, as_of)
);

CREATE INDEX IF NOT EXISTS idx_prices_ticker_recent
  ON prices (ticker, as_of DESC);

-- Latest price per ticker — convenience view
CREATE OR REPLACE VIEW latest_prices AS
SELECT DISTINCT ON (ticker)
  ticker,
  as_of,
  price,
  currency,
  source
FROM prices
ORDER BY ticker, as_of DESC;

-- FX rates (USD pivot). row per (currency, date).
CREATE TABLE IF NOT EXISTS fx_rates (
  currency    TEXT NOT NULL,    -- e.g. 'EUR' (rate of CURRENCY per 1 USD)
  as_of       TIMESTAMPTZ NOT NULL,
  rate        NUMERIC(20, 8) NOT NULL,
  PRIMARY KEY (currency, as_of)
);

CREATE OR REPLACE VIEW latest_fx_rates AS
SELECT DISTINCT ON (currency)
  currency,
  as_of,
  rate
FROM fx_rates
ORDER BY currency, as_of DESC;

-- Per-ticker dividend history fetched from Yahoo Finance. Shared (no user_id).
CREATE TABLE IF NOT EXISTS dividend_events (
  ticker      TEXT NOT NULL,
  ex_date     DATE NOT NULL,
  amount      NUMERIC(20, 8) NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  source      TEXT NOT NULL DEFAULT 'yahoo',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, ex_date)
);

CREATE INDEX IF NOT EXISTS idx_dividend_events_ticker
  ON dividend_events (ticker);

-- Weekly closing prices used by the analytics layer (beta/alpha/Sharpe).
-- Shared across users (no user_id). Yahoo's `chart()` with interval='1wk'
-- returns one row per week — we store the close indexed by the bar's end
-- date.
CREATE TABLE IF NOT EXISTS historical_prices (
  ticker      TEXT NOT NULL,
  week_date   DATE NOT NULL,
  close       NUMERIC(20, 8) NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  source      TEXT NOT NULL DEFAULT 'yahoo',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, week_date)
);

CREATE INDEX IF NOT EXISTS idx_historical_prices_ticker_recent
  ON historical_prices (ticker, week_date DESC);

-- Per-user, per-holding scenario valuation model. The whole editable model
-- (scenarios, horizon, DCA simulator, manual base-EPS override) is stored as
-- a single JSONB document — it is always loaded and saved as a unit for one
-- holding, so a flexible document beats rigid columns here. Keyed by the same
-- storage-key ticker the positions table uses.
CREATE TABLE IF NOT EXISTS holding_scenarios (
  user_id     TEXT NOT NULL,
  ticker      TEXT NOT NULL,
  model       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ticker)
);

-- Forward EPS captured from Yahoo (defaultKeyStatistics.forwardEps), used to
-- auto-fill the base forward EPS of the scenario valuation panel. Added after
-- the fundamentals table shipped, so it's an additive ALTER for existing DBs.
ALTER TABLE fundamentals
  ADD COLUMN IF NOT EXISTS forward_eps NUMERIC(14, 4);

-- DCF / Reverse-DCF inputs captured from Yahoo (financialData.freeCashflow /
-- totalDebt / totalCash, defaultKeyStatistics.sharesOutstanding). Absolute
-- values in the company's financial currency. Additive for existing DBs.
ALTER TABLE fundamentals
  ADD COLUMN IF NOT EXISTS free_cashflow NUMERIC(24, 0);
ALTER TABLE fundamentals
  ADD COLUMN IF NOT EXISTS shares_outstanding NUMERIC(24, 0);
ALTER TABLE fundamentals
  ADD COLUMN IF NOT EXISTS total_debt NUMERIC(24, 0);
ALTER TABLE fundamentals
  ADD COLUMN IF NOT EXISTS total_cash NUMERIC(24, 0);

-- Company website, used to derive a logo domain on the dashboard.
ALTER TABLE fundamentals
  ADD COLUMN IF NOT EXISTS website TEXT;

-- Quarterly/annual financial statements cache (company dashboard on
-- /explore/:ticker). Yahoo's free API only returns the last ~5 periods, so
-- rows are upserted append-only and history ACCUMULATES with each refresh —
-- never bulk-delete this table. `data` is the slim metrics JSON produced by
-- api/_statements-core.ts.
CREATE TABLE IF NOT EXISTS financial_statements (
  ticker      TEXT NOT NULL,
  period_end  DATE NOT NULL,
  period_type TEXT NOT NULL, -- 'q' | 'a'
  data        JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, period_end, period_type)
);

-- Verified portfolio snapshots — the signed figures behind a shareable card,
-- its one-page PDF and the public /verify/:code page.
--
-- `canonical` is the exact serialised body the digest was taken over; it is
-- stored verbatim and served verbatim, because re-serialising it anywhere would
-- change the hash. `issued_at_iso` is TEXT for the same reason: it is part of
-- the digest input, so it must survive the round-trip byte-for-byte (the
-- TIMESTAMPTZ next to it is for ordering and retention only).
--
--   digest    = sha256(code || '\n' || issued_at_iso || '\n' || canonical)
--   signature = HMAC-SHA256(SNAPSHOT_SECRET, digest)
--
-- The signature is what a tampered database row cannot fake, so it is verified
-- server-side on every read and the result reported to the verify page.
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  code          TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  issued_at_iso TEXT NOT NULL,
  tier          TEXT NOT NULL DEFAULT 'self', -- 'self' | 'broker'
  broker        TEXT,
  amounts       BOOLEAN NOT NULL DEFAULT FALSE,
  canonical     TEXT NOT NULL,
  digest        TEXT NOT NULL,
  signature     TEXT NOT NULL,
  -- Set when the owner withdraws a card they had shared; the verify page then
  -- reports it as revoked instead of valid. Rows are never hard-deleted, so an
  -- old link resolves to an explicit "no longer vouched for" rather than a 404.
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user
  ON portfolio_snapshots (user_id, created_at DESC);
