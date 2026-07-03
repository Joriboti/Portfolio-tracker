import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getResearchArticle, type ResearchArticle } from "@/lib/research";
import { Blocks } from "@/components/NotionBlocks";
import { ResearchWordmark } from "@/components/Logo";
import { useSeo } from "@/lib/seo";
import { TickerBadge, TagPill } from "./research";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("ca-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

const FALLBACK_OG = "https://www.trimmtrack.com/og.png";

export function ResearchArticlePage() {
  const { slug = "" } = useParams();
  const [state, setState] = useState<"loading" | "ready" | "notfound">(
    "loading",
  );
  const [article, setArticle] = useState<ResearchArticle | null>(null);
  // A Notion uploaded page-cover is a ~1h-signed URL that can expire; if it
  // fails to load, fall back to the branded banner instead of a broken image.
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setCoverFailed(false);
    getResearchArticle(slug).then((a) => {
      if (cancelled) return;
      if (!a) {
        setState("notfound");
        return;
      }
      setArticle(a);
      setState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const url = `https://www.trimmtrack.com/research/${slug}`;
  useSeo({
    title: article
      ? `${article.title} | TrimmTrack`
      : "Anàlisi | TrimmTrack",
    description: article?.summary,
    url,
    image: article?.coverImage ?? FALLBACK_OG,
    jsonLd: article
      ? {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: article.title,
          datePublished: article.publishedAt ?? undefined,
          image: article.coverImage ?? FALLBACK_OG,
          author: { "@type": "Organization", name: "TrimmTrack" },
          publisher: { "@type": "Organization", name: "TrimmTrack" },
          mainEntityOfPage: url,
        }
      : undefined,
  });

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-slate-400">
        Carregant anàlisi…
      </div>
    );
  }

  if (state === "notfound" || !article) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-slate-600">No hem trobat aquesta anàlisi.</p>
        <Link to="/research" className="btn-primary mt-4 inline-flex">
          ← Totes les anàlisis
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link to="/research" className="inline-block transition-opacity hover:opacity-80">
        <ResearchWordmark />
      </Link>
      <Link
        to="/research"
        className="mt-6 block text-sm text-slate-500 hover:text-slate-800"
      >
        ← Totes les anàlisis
      </Link>

      <header className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <TickerBadge ticker={article.ticker} />
          {article.publishedAt && (
            <span className="text-xs text-slate-400">
              {formatDate(article.publishedAt)}
            </span>
          )}
        </div>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
          {article.title}
        </h1>
        {article.summary && (
          <p className="mt-3 text-lg leading-relaxed text-slate-600">
            {article.summary}
          </p>
        )}
        {article.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {article.tags.map((tag) => (
              <TagPill key={tag} tag={tag} />
            ))}
          </div>
        )}
        {article.coverImage && !coverFailed ? (
          <img
            src={article.coverImage}
            alt=""
            loading="lazy"
            onError={() => setCoverFailed(true)}
            className="mt-6 aspect-[16/7] w-full rounded-xl border border-slate-200 object-cover shadow-sm"
          />
        ) : (
          // No cover set → a branded gradient banner so every article header
          // looks intentional instead of bare. (The CoverImage column is a URL;
          // a Notion page-cover banner does NOT populate it.)
          <div className="mt-6 flex aspect-[16/6] w-full items-center justify-center overflow-hidden rounded-xl border border-brand-100 bg-gradient-to-br from-brand-50 via-amber-50 to-white shadow-sm">
            <div className="text-center">
              <div className="text-4xl font-extrabold tracking-tight text-brand-600 sm:text-5xl">
                {article.ticker || "TrimmTrack"}
              </div>
              <div className="mt-1 text-[11px] font-medium uppercase tracking-widest text-slate-400">
                TrimmTrack Research
              </div>
            </div>
          </div>
        )}
      </header>

      <article className="mt-6 max-w-[72ch] text-[15px]">
        <Blocks blocks={article.blocks} />
      </article>

      {/* Acquisition CTA */}
      <div className="mt-12 rounded-2xl border border-brand-200 bg-brand-50/60 p-6 text-center">
        <p className="text-lg font-semibold text-slate-900">
          Segueix {article.ticker || "aquesta empresa"} a TrimmTrack
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
          Afegeix-la a la teva cartera i aplica-hi els models de valoració (DCF,
          Graham, NAV…) amb dades en viu. Gratis i sense registre.
        </p>
        <Link to="/disclaimer" className="btn-primary mt-4 inline-flex">
          Comença gratis →
        </Link>
      </div>
    </div>
  );
}
