// Client for the Notion-backed Research CMS. Served by fundamentals-get's
// `?research=` mode (folded in to respect the Hobby 12-function limit). All
// endpoints are public (no auth) and degrade to empty on any failure.

// Raw Notion block — we render defensively, so a loose type is fine here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NotionBlock = any;

export interface ResearchCard {
  slug: string;
  title: string;
  ticker: string;
  summary: string;
  publishedAt: string | null;
  tags: string[];
  coverImage: string | null;
}

export interface ResearchArticle extends ResearchCard {
  blocks: NotionBlock[];
}

export interface CompanyInsights {
  ticker: string;
  pros: string[];
  risks: string[];
  thesis: string | null;
}

export type InsightsResult = {
  /** Commentary in the REQUESTED language, or null — never another language. */
  insights: CompanyInsights | null;
  /** Whether the Catalan original exists, so we can link to it instead. */
  hasCatalan: boolean;
};

// Qualitative Pros/Risks for a ticker, authored per language in the same Notion
// CMS. Strictly locale-scoped: a page in Spanish never receives the Catalan
// text. Returns nothing at all when the commentary is not authored for that
// ticker → the section self-hides.
export async function getInsights(
  ticker: string,
  locale: string,
): Promise<InsightsResult> {
  const empty: InsightsResult = { insights: null, hasCatalan: false };
  try {
    const res = await fetch(
      `/api/fundamentals-get?research=insights&ticker=${encodeURIComponent(ticker)}` +
        `&locale=${encodeURIComponent(locale)}`,
    );
    if (!res.ok) return empty;
    const data = await res.json();
    return {
      insights: (data.insights ?? null) as CompanyInsights | null,
      hasCatalan: data.hasCatalan === true,
    };
  } catch {
    return empty;
  }
}

export async function getResearchList(): Promise<ResearchCard[]> {
  try {
    const res = await fetch("/api/fundamentals-get?research=list");
    if (!res.ok) return [];
    const data = await res.json();
    return (data.articles ?? []) as ResearchCard[];
  } catch {
    return [];
  }
}

export async function getResearchArticle(
  slug: string,
): Promise<ResearchArticle | null> {
  try {
    const res = await fetch(
      `/api/fundamentals-get?research=article&slug=${encodeURIComponent(slug)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.article ?? null) as ResearchArticle | null;
  } catch {
    return null;
  }
}
