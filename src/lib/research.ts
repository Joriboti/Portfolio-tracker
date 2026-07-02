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
