import { Link } from "react-router-dom";
import { ToolPage } from "@/components/tools/ToolPage";
import {
  CompoundGrowthCalculator,
  DcfCalculator,
  GrahamCalculator,
  MonteCarloCalculator,
  ReverseDcfCalculator,
} from "@/components/tools/calculators";
import { FifoCalculator } from "@/components/FifoCalculator";

// English-first SEO tool pages (GROWTH_PLAN / English-first plan, phase 1). Each
// targets one high-intent keyword with a keyword H1, a signup-free interactive
// calculator, a worked example, ~500 words of educational copy, an FAQ and a CTA
// into the product. Copy is English-only — these routes live only under /en.

export function DcfCalculatorPage() {
  return (
    <ToolPage
      slug="/dcf-calculator"
      appName="TrimmTrack DCF Calculator"
      seoTitle="Free DCF Calculator — value any stock in seconds | TrimmTrack"
      seoDescription="A free discounted cash flow (DCF) calculator. Enter EPS or free cash flow per share, a growth rate, an exit multiple and your required return to get a stock's fair value and upside. No signup."
      h1="Free DCF Calculator"
      lead="Estimate what a stock is really worth. Enter a few assumptions and get an intrinsic fair value, the upside versus today's price, and the annual return the current price implies — instantly, in your browser, with no account."
      tool={<DcfCalculator />}
      example={{
        title: "Worked example",
        body: (
          <>
            <p>
              Suppose a company earns <strong>$6.00</strong> of forward EPS, you expect{" "}
              <strong>10%</strong> annual growth for <strong>10 years</strong>, and you think it will
              trade at an <strong>18×</strong> exit P/E. In year 10 EPS is 6 × 1.10<sup>10</sup> ≈{" "}
              <strong>$15.56</strong>, implying a share price of 15.56 × 18 ≈ <strong>$280</strong>.
            </p>
            <p className="mt-2">
              Discounting that back 10 years at a <strong>10%</strong> required return gives a fair
              value of 280 / 1.10<sup>10</sup> ≈ <strong>$108</strong>. If the stock trades at $150
              today, the model says it is roughly <strong>28% overvalued</strong> for your return
              target — you would need faster growth or a higher exit multiple to justify the price.
            </p>
          </>
        ),
      }}
      sections={[
        {
          title: "What is a DCF and how does this calculator work?",
          body: (
            <>
              <p>
                A discounted cash flow (DCF) model values a business by projecting what it will earn
                or generate in cash, then discounting those future amounts back to today because a
                dollar tomorrow is worth less than a dollar now. This calculator uses a compact
                per-share version: it compounds your base metric (forward EPS or free cash flow per
                share) at your growth rate, applies an exit multiple to get a future price, then
                discounts that price back at the annual return you require.
              </p>
              <p>
                The output is a <strong>fair value</strong> — the most you can pay today and still
                earn your target return — plus the implied upside and the CAGR you would actually
                realise if you bought at the current price.
              </p>
            </>
          ),
        },
        {
          title: "Which inputs matter most?",
          body: (
            <p>
              Growth rate and exit multiple move the answer the most, and they are the hardest to
              know — small changes compound over ten years. Be conservative: use a growth rate a
              quality business can plausibly sustain, and an exit multiple in line with mature peers
              rather than today's hype. When you are unsure of a single number, run the{" "}
              <Link className="text-brand-700 underline" to="/en/monte-carlo-stock-simulator">
                Monte Carlo simulator
              </Link>{" "}
              to see a range instead of a false-precision point estimate, or the{" "}
              <Link className="text-brand-700 underline" to="/en/reverse-dcf-calculator">
                reverse DCF
              </Link>{" "}
              to see what growth the price already assumes.
            </p>
          ),
        },
      ]}
      faqs={[
        {
          q: "Is this DCF calculator really free?",
          a: "Yes. It runs entirely in your browser with no signup, no paywall and no limit on how many stocks you value.",
        },
        {
          q: "Should I use EPS or free cash flow?",
          a: "Either works — the model compounds whatever per-share metric you enter. Free cash flow per share is closer to what a DCF is meant to value, but forward EPS is easier to find and fine for a quick screen.",
        },
        {
          q: "What discount rate (required return) should I use?",
          a: "Use the annual return you want to earn for the risk. Many long-term investors use 8–12%; a higher number is more conservative and lowers the fair value.",
        },
        {
          q: "Why is my fair value so sensitive to the exit multiple?",
          a: "Because it multiplies the final-year metric directly. A stock at 25× versus 15× changes the terminal price by two-thirds. Anchor the multiple to durable, mature-business levels, not the current one.",
        },
      ]}
      cta={{
        title: "Value your whole portfolio, not just one stock",
        body: "TrimmTrack runs this DCF (plus reverse DCF, Graham number and Monte Carlo) on every holding in your portfolio, with live prices pulled in automatically.",
        primaryTo: "/upload",
        primaryLabel: "Upload your portfolio",
        secondaryTo: "/explore",
        secondaryLabel: "Try it on any ticker",
      }}
    />
  );
}

export function ReverseDcfCalculatorPage() {
  return (
    <ToolPage
      slug="/reverse-dcf-calculator"
      appName="TrimmTrack Reverse DCF Calculator"
      seoTitle="Reverse DCF Calculator — what growth is priced in? | TrimmTrack"
      seoDescription="Free reverse DCF calculator. Enter the current price, EPS, exit multiple and your required return to find the annual growth rate the market is pricing into a stock. No signup."
      h1="Reverse DCF Calculator"
      lead="Instead of guessing a growth rate, let the price tell you. A reverse DCF solves the model backwards to reveal the exact annual growth the market is already assuming — so you can judge whether expectations are realistic."
      tool={<ReverseDcfCalculator />}
      example={{
        title: "Worked example",
        body: (
          <p>
            A stock trades at <strong>$150</strong> with <strong>$6.00</strong> forward EPS. Assuming
            an <strong>18×</strong> exit multiple, a <strong>10-year</strong> horizon and a{" "}
            <strong>10%</strong> required return, the reverse DCF returns an implied growth of about{" "}
            <strong>13.7%</strong> per year. Ask yourself: has this company actually grown EPS ~14%
            for a decade, and can it keep doing so? If yes, the price is reasonable. If it has grown
            5%, the market is pricing in an acceleration that may not arrive — a red flag.
          </p>
        ),
      }}
      sections={[
        {
          title: "Why value investors love the reverse DCF",
          body: (
            <p>
              A normal DCF forces you to invent a growth rate, and the answer is only as good as that
              guess. The reverse DCF flips the problem: it takes the one number you know for certain —
              today's price — and derives the growth assumption baked into it. That turns a vague
              question ("is this expensive?") into a concrete, testable one ("is 18% growth for ten
              years believable?"). It is the fastest way to sanity-check a popular stock.
            </p>
          ),
        },
        {
          title: "How to read the result",
          body: (
            <p>
              Compare the implied growth to the company's historical growth and analyst expectations.
              If the market's implied growth is well <em>below</em> what a durable business can deliver,
              you may have found an undervalued stock. If it is well <em>above</em> the historical
              trend, the price is leaning on optimism. Pair this with the{" "}
              <Link className="text-brand-700 underline" to="/en/dcf-calculator">
                forward DCF
              </Link>{" "}
              to see both sides.
            </p>
          ),
        },
      ]}
      faqs={[
        {
          q: "What is a reverse DCF?",
          a: "It is a discounted cash flow model run backwards. Rather than outputting a fair value from an assumed growth rate, it outputs the growth rate implied by the current market price.",
        },
        {
          q: "What growth rate means a stock is cheap?",
          a: "There is no universal number — it depends on the business. A stock is attractive when the growth the price implies is comfortably below what the company can realistically achieve.",
        },
        {
          q: "Does it work for unprofitable companies?",
          a: "Not well. The model needs a positive per-share metric. For pre-profit companies, use free cash flow per share once it turns positive, or a revenue-based model instead.",
        },
        {
          q: "Is the reverse DCF better than a normal DCF?",
          a: "They answer different questions. A DCF gives you a fair value; a reverse DCF tells you what the price assumes. Using both together is far more informative than either alone.",
        },
      ]}
      cta={{
        title: "See the implied growth for every stock you own",
        body: "Upload your portfolio and TrimmTrack shows the reverse-DCF implied growth next to each holding, so overpriced positions stand out at a glance.",
        primaryTo: "/upload",
        primaryLabel: "Upload your portfolio",
        secondaryTo: "/explore",
        secondaryLabel: "Try it on any ticker",
      }}
    />
  );
}

export function GrahamNumberCalculatorPage() {
  return (
    <ToolPage
      slug="/graham-number-calculator"
      appName="TrimmTrack Graham Number Calculator"
      seoTitle="Graham Number Calculator — Benjamin Graham fair value | TrimmTrack"
      seoDescription="Free Graham number calculator using Benjamin Graham's interest-rate-adjusted formula. Enter EPS, expected growth and the AAA bond yield to screen a stock's intrinsic value. No signup."
      h1="Graham Number Calculator"
      lead="Benjamin Graham's classic formula for a quick intrinsic-value screen. Enter earnings per share, an expected growth rate and today's AAA bond yield to get a conservative fair value in seconds."
      tool={<GrahamCalculator />}
      example={{
        title: "Worked example",
        body: (
          <p>
            With EPS of <strong>$6.00</strong>, expected growth of <strong>8%</strong> and an AAA
            corporate bond yield of <strong>4.5%</strong>, the formula gives V = 6 × (8.5 + 2×8) ×
            4.4 / 4.5 ≈ <strong>$143.7</strong>. If the stock trades below that, it passes Graham's
            screen; if well above, it is expensive by this conservative yardstick. Because the “2g”
            term is linear and aggressive, growth above 15% is capped to avoid over-inflating the
            value.
          </p>
        ),
      }}
      sections={[
        {
          title: "The formula",
          body: (
            <p>
              This calculator uses Graham's interest-rate-adjusted revision:{" "}
              <strong>V = EPS × (8.5 + 2g) × 4.4 / Y</strong>, where <em>8.5</em> is the base P/E of a
              no-growth company, <em>g</em> is expected annual growth in percent, <em>4.4</em> is the
              AAA yield of Graham's era used as a normalising constant, and <em>Y</em> is today's AAA
              corporate bond yield. Adjusting for current rates keeps the model honest when bond
              yields are far from their 1960s level.
            </p>
          ),
        },
        {
          title: "When to use it — and when not to",
          body: (
            <p>
              The Graham number is a <strong>screen</strong>, not a precise valuation. It works best
              for stable, profitable, dividend-paying companies with steady earnings. It is a poor fit
              for high-growth, asset-light or cyclical businesses, where a{" "}
              <Link className="text-brand-700 underline" to="/en/dcf-calculator">
                DCF
              </Link>{" "}
              is more appropriate. Treat a pass as “worth a closer look,” not a buy signal.
            </p>
          ),
        },
      ]}
      faqs={[
        {
          q: "What is the Graham number?",
          a: "It is a conservative estimate of a stock's intrinsic value from Benjamin Graham, the father of value investing, based on earnings and expected growth adjusted for interest rates.",
        },
        {
          q: "Where do I find the AAA bond yield?",
          a: "Moody's Seasoned Aaa Corporate Bond Yield is published by the U.S. Federal Reserve (FRED). Any recent value in the low-single-digit-percent range works for a screen.",
        },
        {
          q: "Why is growth capped at 15%?",
          a: "The linear 2g term over-inflates intrinsic value at high growth rates, which is unrealistic. Capping growth keeps the screen conservative, as Graham intended.",
        },
        {
          q: "Is a stock below its Graham number a buy?",
          a: "Not automatically. It has passed one conservative screen. Confirm with a DCF, the balance sheet and the business quality before acting.",
        },
      ]}
      cta={{
        title: "Screen your whole watchlist at once",
        body: "TrimmTrack computes the Graham number alongside DCF and reverse-DCF for every ticker you follow, with EPS pulled in automatically.",
        primaryTo: "/explore",
        primaryLabel: "Try it on any ticker",
        secondaryTo: "/upload",
        secondaryLabel: "Upload your portfolio",
      }}
    />
  );
}

export function MonteCarloStockSimulatorPage() {
  return (
    <ToolPage
      slug="/monte-carlo-stock-simulator"
      appName="TrimmTrack Monte Carlo Simulator"
      seoTitle="Monte Carlo Stock Simulator — fair value distribution | TrimmTrack"
      seoDescription="Free Monte Carlo simulator for stock valuation. Draw growth and exit multiple from distributions and run thousands of DCF simulations to get a P10–P90 fair-value range. No signup."
      h1="Monte Carlo Stock Simulator"
      lead="A single DCF gives you false precision. This simulator runs thousands of discounted-cash-flow scenarios with growth and the exit multiple drawn at random, so you get a probability range for fair value instead of one fragile number."
      tool={<MonteCarloCalculator />}
      example={{
        title: "Worked example",
        body: (
          <p>
            Start from a base case of <strong>$6</strong> EPS, <strong>10%</strong> growth and an{" "}
            <strong>18×</strong> exit multiple. Add uncertainty — growth of ±3 percentage points and a
            ±4 turn multiple — and run 5,000 simulations. You might get a median (P50) fair value near{" "}
            <strong>$108</strong>, a pessimistic P10 around <strong>$78</strong> and an optimistic P90
            near <strong>$150</strong>. That spread tells you far more than a point estimate: if the
            price sits above your P90, the stock is expensive under almost every scenario.
          </p>
        ),
      }}
      sections={[
        {
          title: "Why simulate instead of using one number?",
          body: (
            <p>
              The two inputs that move a DCF the most — growth and the exit multiple — are exactly the
              ones you cannot know precisely. A Monte Carlo simulation embraces that: it samples each
              from a distribution around your best guess and re-runs the model thousands of times. The
              result is a histogram of fair values and percentiles (P10 / P50 / P90) that describe the
              range of plausible outcomes and how confident you can reasonably be.
            </p>
          ),
        },
        {
          title: "How to set the uncertainty",
          body: (
            <p>
              Widen the standard deviations for businesses whose future is genuinely hard to predict
              (early-stage, cyclical, single-product) and tighten them for stable compounders. Then
              compare today's price to the distribution: below P10 looks cheap across scenarios, above
              P90 looks expensive across scenarios, and in between is a genuine judgement call.
            </p>
          ),
        },
      ]}
      faqs={[
        {
          q: "What is a Monte Carlo simulation in investing?",
          a: "It is a technique that runs a model many times with randomly sampled inputs to produce a distribution of outcomes, rather than a single deterministic answer.",
        },
        {
          q: "How many simulations does this run?",
          a: "5,000 runs per calculation, entirely in your browser. That is enough for stable percentiles while staying instant. Hit Re-run to draw a fresh set.",
        },
        {
          q: "What do P10, P50 and P90 mean?",
          a: "They are percentiles of the simulated fair values: roughly 10% of runs fall below P10, half fall below P50 (the median), and 90% fall below P90. Together they frame the likely range.",
        },
        {
          q: "Does this predict the share price?",
          a: "No. It models a range of intrinsic values from your assumptions. The market price can differ for a long time; the range helps you judge margin of safety.",
        },
      ]}
      cta={{
        title: "Run Monte Carlo on your real holdings",
        body: "TrimmTrack applies this simulation to every position you own, using live fundamentals so the base case updates itself.",
        primaryTo: "/upload",
        primaryLabel: "Upload your portfolio",
        secondaryTo: "/forecast",
        secondaryLabel: "Forecast your ETFs",
      }}
    />
  );
}

export function EtfGrowthCalculatorPage() {
  return (
    <ToolPage
      slug="/etf-growth-calculator"
      appName="TrimmTrack ETF Growth Calculator"
      seoTitle="ETF Compound Growth Calculator — project your portfolio | TrimmTrack"
      seoDescription="Free ETF compound growth calculator. Enter an initial investment, monthly contribution, expected annual return and time horizon to project your portfolio's future value. No signup."
      h1="ETF Compound Growth Calculator"
      lead="See how regular investing compounds over time. Enter a starting balance, a monthly contribution and an expected annual return to project what your ETF portfolio could be worth — and how much of it is pure growth."
      tool={<CompoundGrowthCalculator />}
      example={{
        title: "Worked example",
        body: (
          <p>
            Start with <strong>$10,000</strong>, add <strong>$500</strong> a month, and assume a{" "}
            <strong>7%</strong> annual return (a common long-run assumption for a broad equity ETF)
            for <strong>20 years</strong>. You would contribute <strong>$130,000</strong> in total,
            but compounding turns it into roughly <strong>$300,000</strong> — meaning about{" "}
            <strong>$171,000</strong> of the balance is investment growth, not your own money. That
            gap is the entire case for starting early.
          </p>
        ),
      }}
      sections={[
        {
          title: "The power of compounding",
          body: (
            <p>
              Compounding means your returns earn returns. Early contributions have the most time to
              grow, so the balance curve bends upward — the second decade adds far more than the
              first, even with identical contributions. This calculator compounds monthly and adds
              your contribution at the end of each month, which mirrors how most people invest.
            </p>
          ),
        },
        {
          title: "Be realistic about returns and fees",
          body: (
            <p>
              A single fixed return hides real-world volatility and costs. Use a conservative figure
              (many investors model 5–7% after inflation), remember that fees compound against you
              just as returns compound for you, and stress-test the plan with the{" "}
              <Link className="text-brand-700 underline" to="/en/monte-carlo-stock-simulator">
                Monte Carlo simulator
              </Link>{" "}
              to see the range of outcomes rather than a single smooth line.
            </p>
          ),
        },
      ]}
      faqs={[
        {
          q: "What return should I assume for an ETF?",
          a: "Broad equity index ETFs have historically returned roughly 7–10% per year before inflation over long periods, but any single decade can be very different. Use a conservative number and revisit it.",
        },
        {
          q: "Does this account for inflation?",
          a: "Not directly. To see today's purchasing power, enter a real (after-inflation) return — for example 5% instead of 8%.",
        },
        {
          q: "How is the future value calculated?",
          a: "It compounds your starting balance monthly and adds your contribution at the end of each month for the full horizon, then reports the ending value, total contributed and the growth portion.",
        },
        {
          q: "Can I model dividends being reinvested?",
          a: "Yes — use a total-return figure (price growth plus reinvested dividends) as your expected annual return.",
        },
      ]}
      cta={{
        title: "Project your actual ETF portfolio",
        body: "TrimmTrack's forecast tool models contributions, fees, rebalancing and Monte Carlo volatility across your real ETF mix.",
        primaryTo: "/forecast",
        primaryLabel: "Open the ETF forecast",
        secondaryTo: "/upload",
        secondaryLabel: "Upload your portfolio",
      }}
    />
  );
}

export function FifoCapitalGainsCalculatorPage() {
  return (
    <ToolPage
      slug="/fifo-capital-gains-calculator"
      appName="TrimmTrack FIFO Capital Gains Calculator"
      seoTitle="FIFO Capital Gains Calculator — realized gains, free | TrimmTrack"
      seoDescription="Free FIFO capital gains calculator for stocks and crypto. Enter your buys and sells and it matches them first-in, first-out to compute your realized gain or loss. No signup."
      h1="FIFO Capital Gains Calculator"
      lead="Work out the realized gain or loss on a sale using the first-in, first-out (FIFO) method that most tax regimes require. Enter your buys and sells and get the taxable result — no spreadsheet, no signup."
      tool={<FifoCalculator />}
      example={{
        title: "Worked example",
        body: (
          <p>
            You buy <strong>10 shares at $100</strong>, then <strong>10 more at $150</strong>, and
            later sell <strong>15 shares at $200</strong>. FIFO matches the sale against your oldest
            lots first: all 10 shares from the $100 lot and 5 from the $150 lot. Cost basis = (10 ×
            100) + (5 × 150) = <strong>$1,750</strong>; proceeds = 15 × 200 = <strong>$3,000</strong>;
            realized gain = <strong>$1,250</strong>. Five shares from the $150 lot remain unsold.
          </p>
        ),
      }}
      sections={[
        {
          title: "What is FIFO and why does it matter?",
          body: (
            <p>
              FIFO — first-in, first-out — assumes the first shares you bought are the first ones you
              sell. Because your earliest purchases often have a different cost basis, the method you
              use directly changes the taxable gain. Many jurisdictions (including Spain's IRPF and
              numerous others) mandate FIFO for securities, so matching lots correctly is essential to
              file accurate numbers.
            </p>
          ),
        },
        {
          title: "Stocks and crypto",
          body: (
            <p>
              The same logic applies to crypto in most FIFO regimes: each disposal is matched against
              your oldest units. Track every buy — including small ones and transfers with a cost
              basis — so partial sales compute correctly. This tool handles partial lots automatically
              and flags an oversell if you try to sell more units than you hold.
            </p>
          ),
        },
      ]}
      faqs={[
        {
          q: "Is this FIFO calculator suitable for taxes?",
          a: "It computes the realized gain using strict FIFO lot matching, which is the basis many tax authorities require. It is an educational tool, not tax advice — confirm the rules for your country.",
        },
        {
          q: "Does it work for cryptocurrency?",
          a: "Yes. Enter your crypto buys and sells the same way; FIFO matches disposals against your oldest units.",
        },
        {
          q: "What happens with a partial sale?",
          a: "The sale consumes your oldest lots first and leaves the remainder open. The calculator keeps track of what is left for your next sale.",
        },
        {
          q: "Does it handle fees and currencies?",
          a: "This quick calculator focuses on FIFO lot matching. For fees, multiple currencies and a full realized-gains report, upload your broker export to TrimmTrack.",
        },
      ]}
      cta={{
        title: "Get a full realized-gains report",
        body: "Upload your broker's Excel export and TrimmTrack computes FIFO capital gains across every position, currency and year for you.",
        primaryTo: "/upload",
        primaryLabel: "Upload your portfolio",
        secondaryTo: "/calculadora-fifo",
        secondaryLabel: "Versión en español",
      }}
    />
  );
}

export function PortfolioTrackerPage() {
  return (
    <ToolPage
      slug="/portfolio-tracker"
      appName="TrimmTrack Portfolio Tracker"
      seoTitle="Free Portfolio Tracker from an Excel export — no signup | TrimmTrack"
      seoDescription="Track your investment portfolio for free. Upload your broker's Excel export and see live P&L, dividends, weights and valuation models — no manual data entry, no subscription."
      h1="Free Portfolio Tracker"
      lead="Turn your broker's Excel export into a live portfolio dashboard. See profit and loss, dividends, position weights and valuation models update with real prices — without typing a single trade by hand."
      tool={
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ul className="grid gap-3 sm:grid-cols-2 text-sm text-slate-700">
            {[
              ["Live P&L", "Real prices pulled in automatically, per position and total."],
              ["Dividends", "Income tracked and projected across your holdings."],
              ["Weights & allocation", "See concentration and diversification at a glance."],
              ["Valuation built in", "DCF, reverse DCF, Graham number and Monte Carlo on each stock."],
              ["FIFO capital gains", "Realized-gain reports straight from your trade history."],
              ["No manual entry", "Upload a broker Excel export — that's it."],
            ].map(([t, d]) => (
              <li key={t} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="font-semibold text-slate-900">{t}</div>
                <div className="mt-0.5 text-slate-600">{d}</div>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to="/upload" className="btn-primary text-sm px-4 py-2">
              Upload your Excel
            </Link>
            <Link to="/explore" className="btn-ghost text-sm px-4 py-2">
              Explore a demo
            </Link>
          </div>
        </div>
      }
      example={{
        title: "How it works",
        body: (
          <p>
            Export your holdings or transactions from your broker as an Excel/CSV file and upload it.
            TrimmTrack parses the columns, matches each ticker to live market data, and builds a
            dashboard with current value, profit and loss, dividends and position weights. From there
            you can run valuation models on any holding and generate a FIFO capital-gains report — all
            without re-keying your trades.
          </p>
        ),
      }}
      sections={[
        {
          title: "Why a spreadsheet-based tracker?",
          body: (
            <p>
              Your broker already has your data; the problem is that a static spreadsheet goes stale
              the moment prices move and can't value a business or compute realized gains. TrimmTrack
              keeps the convenience of Excel — you own the file, no linking of bank credentials — while
              adding live prices, dividends and valuation on top. It is free to use and requires no
              subscription to see your portfolio.
            </p>
          ),
        },
        {
          title: "Your data stays yours",
          body: (
            <p>
              You upload a file you control rather than connecting a brokerage login. Prefer to start
              from a clean sheet? The upload page includes a guide for building a compatible Excel from
              scratch, so you can track holdings even if your broker's export is messy.
            </p>
          ),
        },
      ]}
      faqs={[
        {
          q: "Is the portfolio tracker free?",
          a: "Yes. You can upload an Excel export and see your live portfolio, P&L and valuation models without paying or subscribing.",
        },
        {
          q: "Do I have to connect my brokerage account?",
          a: "No. You upload an Excel or CSV export that you control — there is no need to share brokerage login credentials.",
        },
        {
          q: "Which brokers are supported?",
          a: "Any broker that lets you export holdings or transactions to Excel/CSV. The parser maps common column layouts, and there's a guide for building a compatible sheet by hand.",
        },
        {
          q: "Can it track dividends and capital gains?",
          a: "Yes. It tracks dividend income and computes FIFO realized capital gains from your transaction history.",
        },
      ]}
      cta={{
        title: "Start tracking in under a minute",
        body: "Upload your broker's Excel export and watch your portfolio come to life with live prices and valuation.",
        primaryTo: "/upload",
        primaryLabel: "Upload your portfolio",
        secondaryTo: "/explore",
        secondaryLabel: "Try a demo first",
      }}
    />
  );
}
