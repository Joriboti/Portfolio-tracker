// Writes the Spanish and English versions of the qualitative company
// commentary into the Notion research DB: adds the per-locale columns the API
// reads (ProsEs/RisksEs/ThesisEs, ProsEn/RisksEn/ThesisEn — see
// api/_research-core.ts) and fills them for the tickers listed below.
//
// The translations are HAND-WRITTEN and faithful to the Catalan original: same
// claims, same figures, no new financial content. They are kept in this file so
// the diff is reviewable; Notion holds the copy that ships.
//
//   node scripts/insights-translate.mjs --dry-run
//   node scripts/insights-translate.mjs
//
// Re-running is safe: it only writes the locales given here, and never touches
// the Catalan original.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { notion, DB, plain } from "./insights-dump.mjs";

const DRY = process.argv.includes("--dry-run");

/** rich_text columns the app reads, per locale. */
const COLUMNS = ["ProsEs", "RisksEs", "ThesisEs", "ProsEn", "RisksEn", "ThesisEn"];

const TRANSLATIONS = {
  AAPL: {
    es: {
      thesis:
        "Apple combina un ecosistema cerrado con una marca premium que le da poder de fijación de precios y unos ingresos de servicios cada vez más recurrentes; el debate es el precio que se paga por esa calidad.",
      pros: [
        "Ecosistema integrado (iPhone, App Store, iCloud, servicios) con altos costes de cambio que retienen al usuario.",
        "Marca premium con poder de fijación de precios y márgenes brutos en torno al 45%.",
        "Base instalada de más de 2.200 millones de dispositivos activos que alimenta ingresos recurrentes de servicios.",
        "Fuerte generación de flujo de caja libre y recompras que reducen las acciones año tras año.",
      ],
      risks: [
        "Dependencia del iPhone: todavía alrededor del 50% de los ingresos en un mercado de smartphones maduro.",
        "Riesgo regulatorio sobre la App Store y sobre los pagos de Google por ser el buscador por defecto.",
        "Exposición a China, tanto en ventas como en cadena de suministro.",
        "Valoración exigente: un PER elevado deja poco margen si el crecimiento decepcionara.",
      ],
    },
    en: {
      thesis:
        "Apple pairs a closed ecosystem with a premium brand that gives it pricing power and an increasingly recurring services revenue stream; the debate is the price you pay for that quality.",
      pros: [
        "Integrated ecosystem (iPhone, App Store, iCloud, services) with high switching costs that keep users in.",
        "Premium brand with pricing power and gross margins of around 45%.",
        "Installed base of more than 2.2 billion active devices, feeding recurring services revenue.",
        "Strong free cash flow generation and buybacks that shrink the share count year after year.",
      ],
      risks: [
        "iPhone dependence: still around 50% of revenue, in a mature smartphone market.",
        "Regulatory risk over the App Store and over Google's payments to be the default search engine.",
        "China exposure, in both sales and supply chain.",
        "Demanding valuation: a high P/E leaves little room if growth disappoints.",
      ],
    },
  },
};

const rich = (text) => ({ rich_text: [{ type: "text", text: { content: text } }] });

async function ensureColumns() {
  const db = await notion(`/databases/${DB}`);
  const missing = COLUMNS.filter((c) => !(c in db.properties));
  if (missing.length === 0) {
    console.log(`[insights] columns present: ${COLUMNS.join(", ")}`);
    return;
  }
  console.log(`[insights] adding columns: ${missing.join(", ")}`);
  if (DRY) return;
  await notion(`/databases/${DB}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: Object.fromEntries(missing.map((c) => [c, { rich_text: {} }])),
    }),
  });
}

async function run() {
  await ensureColumns();

  let cursor;
  const rows = [];
  do {
    const q = await notion(`/databases/${DB}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    rows.push(...q.results);
    cursor = q.has_more ? q.next_cursor : undefined;
  } while (cursor);

  for (const [ticker, byLocale] of Object.entries(TRANSLATIONS)) {
    const page = rows.find(
      (p) => plain(p.properties?.Ticker?.rich_text).trim().toUpperCase() === ticker,
    );
    if (!page) {
      console.error(`[insights] ${ticker}: no row in Notion — skipped`);
      continue;
    }
    // Sanity check: the Catalan original must still have as many bullets as the
    // translation, so an edited original cannot silently ship a stale one.
    const caPros = plain(page.properties?.Pros?.rich_text).split(/\r?\n/).filter(Boolean).length;
    const caRisks = plain(page.properties?.Risks?.rich_text).split(/\r?\n/).filter(Boolean).length;
    for (const [locale, t] of Object.entries(byLocale)) {
      if (t.pros.length !== caPros || t.risks.length !== caRisks) {
        console.error(
          `[insights] ${ticker}/${locale}: ${t.pros.length}+${t.risks.length} bullets vs ` +
            `${caPros}+${caRisks} in Catalan — the original changed, re-translate before writing`,
        );
        process.exitCode = 1;
        return;
      }
    }

    const props = {};
    for (const [locale, t] of Object.entries(byLocale)) {
      const sfx = locale === "es" ? "Es" : "En";
      props[`Pros${sfx}`] = rich(t.pros.join("\n"));
      props[`Risks${sfx}`] = rich(t.risks.join("\n"));
      props[`Thesis${sfx}`] = rich(t.thesis);
    }
    console.log(
      `[insights] ${ticker}: ${Object.keys(props).length} fields` + (DRY ? " (dry run)" : ""),
    );
    if (DRY) continue;
    await notion(`/pages/${page.id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties: props }),
    });
  }
  console.log("[insights] done");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
