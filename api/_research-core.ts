import type { VercelRequest, VercelResponse } from "@vercel/node";

// Notion-backed "Research" CMS core. Folded behind fundamentals-get's
// `?research=` param (NOT a new /api route) to stay under the Hobby plan's
// 12-serverless-function limit — same pattern as _fundamentals-core.ts.
// The Notion SDK is imported dynamically by the caller's branch so it never
// weighs on the hot fundamentals path.
//
// Modes:
//   ?research=list                 → published articles, newest first
//   ?research=article&slug=<slug>  → one article's properties + block tree
//   ?research=insights&ticker=<T>  → qualitative Pros/Risks for a ticker
//                                     (company dashboard "Insights" section)
//
// Degrades gracefully: if the env vars are missing or Notion errors, responds
// 200 with an empty payload so the public pages render an empty/friendly state
// instead of crashing.

// Loose typing on purpose — the Notion block/property shapes are large and we
// only pluck a few fields; the client renderer is defensive about the rest.
/* eslint-disable @typescript-eslint/no-explicit-any */

function plain(rich: any[] | undefined): string {
  return (rich ?? []).map((t) => t?.plain_text ?? "").join("");
}

// Split a multi-line rich_text property into clean bullet strings: one per
// line, leading list markers (-, •, *) stripped, blank lines dropped. Authors
// write the Pros/Risks columns as one advantage/risk per line.
function bullets(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean);
}

// Qualitative commentary is authored per language, in its own set of Notion
// columns: Pros/Risks/Thesis (Catalan, the original) and ProsEs/RisksEs/
// ThesisEs, ProsEn/RisksEn/ThesisEn for the translations.
//
// There is deliberately NO fallback between languages. Serving the Catalan text
// on /es or /en is exactly the "fake translation" pattern that made a Spanish
// page render half in Catalan; an empty result is the honest answer, and the
// client turns it into a notice that links to the Catalan page.
const INSIGHT_SUFFIX: Record<string, string> = { ca: "", es: "Es", en: "En" };

function readInsights(props: any, locale: string) {
  const sfx = INSIGHT_SUFFIX[locale] ?? "";
  const col = (base: string) => plain(props?.[`${base}${sfx}`]?.rich_text);
  return {
    ticker: plain(props?.Ticker?.rich_text),
    pros: bullets(col("Pros")),
    risks: bullets(col("Risks")),
    thesis: col("Thesis") || null,
  };
}

function readProps(props: any) {
  return {
    title: plain(props?.Title?.title),
    slug: plain(props?.Slug?.rich_text),
    ticker: plain(props?.Ticker?.rich_text),
    summary: plain(props?.Summary?.rich_text),
    status: props?.Status?.select?.name ?? null,
    publishedAt: props?.PublishedAt?.date?.start ?? null,
    tags: (props?.Tags?.multi_select ?? []).map((t: any) => t?.name).filter(Boolean),
    coverImage: props?.CoverImage?.url ?? null,
  };
}

// The hero image, in priority order:
//   1. the CoverImage URL column (stable, user-pasted — never expires)
//   2. the Notion PAGE cover (the banner set inside Notion) — easiest for the
//      author, but an *uploaded* cover is a ~1h-signed S3 URL that can expire
//      (external/linked covers are permanent). The client has an onError
//      fallback for the expiry case.
function coverOf(page: any, meta: { coverImage: string | null }): string | null {
  if (meta.coverImage) return meta.coverImage;
  const c = page?.cover;
  return c?.external?.url ?? c?.file?.url ?? null;
}

// Recursively pull a page's block children (tables, nested lists, callouts,
// etc. keep their children under `.children`). Bounded depth to stay safe.
async function fetchBlocks(
  notion: any,
  blockId: string,
  depth = 0,
): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const resp = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const b of resp.results ?? []) {
      if (b.has_children && depth < 3) {
        b.children = await fetchBlocks(notion, b.id, depth + 1);
      }
      out.push(b);
    }
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  return out;
}

export async function handleResearch(req: VercelRequest, res: VercelResponse) {
  // Public, cacheable content — edge-cached but with a short TTL so edits made
  // in Notion (publish an article, change a cover) show up within minutes
  // rather than up to an hour. stale-while-revalidate keeps it instant for
  // readers while a fresh copy is fetched in the background.
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=3600",
  );

  const apiKey = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_RESEARCH_DB_ID;

  const modeRaw = req.query.research;
  const mode = Array.isArray(modeRaw) ? modeRaw[0] : (modeRaw ?? "list");

  // No Notion configured yet → empty but valid response (graceful degradation).
  if (!apiKey || !dbId) {
    if (mode === "article") {
      res.status(200).end(JSON.stringify({ ok: true, article: null }));
    } else if (mode === "insights") {
      res.status(200).end(JSON.stringify({ ok: true, insights: null }));
    } else {
      res.status(200).end(JSON.stringify({ ok: true, articles: [] }));
    }
    return;
  }

  try {
    const { Client } = await import("@notionhq/client");
    const notion = new Client({ auth: apiKey });

    if (mode === "article") {
      const slugRaw = req.query.slug;
      const slug = (Array.isArray(slugRaw) ? slugRaw[0] : (slugRaw ?? "")).trim();
      if (!slug) {
        res.status(200).end(JSON.stringify({ ok: true, article: null }));
        return;
      }
      const q: any = await notion.databases.query({
        database_id: dbId,
        page_size: 1,
        filter: {
          and: [
            { property: "Status", select: { equals: "Published" } },
            { property: "Slug", rich_text: { equals: slug } },
          ],
        },
      });
      const page = q.results?.[0];
      if (!page) {
        res.status(200).end(JSON.stringify({ ok: true, article: null }));
        return;
      }
      const meta = readProps(page.properties);
      const coverImage = coverOf(page, meta);
      const blocks = await fetchBlocks(notion, page.id);
      res.status(200).end(
        JSON.stringify({ ok: true, article: { ...meta, coverImage, blocks } }),
      );
      return;
    }

    // Insights mode: qualitative Pros/Risks keyed by Ticker. Any row carrying
    // the ticker with non-empty Pros/Risks counts (an insight-only row can have
    // a blank Status so it never surfaces as an article). Self-hides client-side
    // when null, so tickers without authored insights simply show no section.
    if (mode === "insights") {
      const tRaw = req.query.ticker;
      const ticker = (Array.isArray(tRaw) ? tRaw[0] : (tRaw ?? ""))
        .trim()
        .toUpperCase();
      const lRaw = req.query.locale;
      const localeAsked = (Array.isArray(lRaw) ? lRaw[0] : (lRaw ?? "ca")).trim();
      const locale = localeAsked in INSIGHT_SUFFIX ? localeAsked : "ca";
      if (!ticker) {
        res.status(200).end(JSON.stringify({ ok: true, insights: null, hasCatalan: false }));
        return;
      }
      const q: any = await notion.databases.query({
        database_id: dbId,
        page_size: 10,
        filter: { property: "Ticker", rich_text: { equals: ticker } },
      });
      let found:
        | { ticker: string; pros: string[]; risks: string[]; thesis: string | null }
        | null = null;
      // Whether the ORIGINAL (Catalan) commentary exists, so a reader on /es or
      // /en can be pointed at it instead of being shown nothing at all.
      let hasCatalan = false;
      for (const p of q.results ?? []) {
        const ca = readInsights(p.properties, "ca");
        if (ca.pros.length || ca.risks.length) hasCatalan = true;
        const ins = readInsights(p.properties, locale);
        if (!found && (ins.pros.length || ins.risks.length)) found = ins;
      }
      res.status(200).end(JSON.stringify({ ok: true, insights: found, hasCatalan }));
      return;
    }

    // Listing mode.
    const q: any = await notion.databases.query({
      database_id: dbId,
      filter: { property: "Status", select: { equals: "Published" } },
      sorts: [{ property: "PublishedAt", direction: "descending" }],
      page_size: 100,
    });
    const articles = (q.results ?? []).map((p: any) => {
      const m = readProps(p.properties);
      // Drop the heavy/irrelevant fields for the listing.
      return {
        slug: m.slug,
        title: m.title,
        ticker: m.ticker,
        summary: m.summary,
        publishedAt: m.publishedAt,
        tags: m.tags,
        coverImage: coverOf(p, m),
      };
    });
    res.status(200).end(JSON.stringify({ ok: true, articles }));
  } catch (e) {
    // Never 500 a public content page — return empty and let the UI show a
    // friendly state.
    const err = e as Error;
    res.status(200).end(
      JSON.stringify({
        ok: false,
        error: err?.message ?? "Notion query failed",
        ...(mode === "article"
          ? { article: null }
          : mode === "insights"
            ? { insights: null }
            : { articles: [] }),
      }),
    );
  }
}
