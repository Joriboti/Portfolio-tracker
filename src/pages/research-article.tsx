import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getResearchArticle, type ResearchArticle } from "@/lib/research";
import { Blocks } from "@/components/NotionBlocks";
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

  useEffect(() => {
    let cancelled = false;
    setState("loading");
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
      <Link
        to="/research"
        className="text-sm text-slate-500 hover:text-slate-800"
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
        {article.coverImage && (
          <img
            src={article.coverImage}
            alt=""
            className="mt-6 w-full rounded-xl border border-slate-200 object-cover"
          />
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
