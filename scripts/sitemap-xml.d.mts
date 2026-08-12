// Types for scripts/sitemap-xml.mjs — shared sitemap rendering.
import type { IndexableUrl } from "./routes.d.mts";

export function esc(s: unknown): string;
/** Throws on a duplicate <loc>, so a generator bug fails the build. */
export function renderSitemap(urls: IndexableUrl[]): string;
