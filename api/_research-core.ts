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
        ...(mode === "article" ? { article: null } : { articles: [] }),
      }),
    );
  }
}
