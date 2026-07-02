import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getResearchList, type ResearchCard } from "@/lib/research";
import { useSeo } from "@/lib/seo";

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

export function TickerBadge({ ticker }: { ticker: string }) {
  if (!ticker) return null;
  return (
    <span className="inline-flex items-center rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">
      {ticker}
    </span>
  );
}

export function TagPill({ tag }: { tag: string }) {
  return (
    <span className="rounded-full border border-brand-100 bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700">
      {tag}
    </span>
  );
}

export function ResearchPage() {
  const [articles, setArticles] = useState<ResearchCard[] | null>(null);

  useSeo({
    title: "Anàlisis d'inversió gratuïtes | TrimmTrack",
    description:
      "Anàlisis fonamentals, models de valoració i idees d'inversió. Accés gratuït, sense registre.",
    url: "https://www.trimmtrack.com/research",
  });

  useEffect(() => {
    let cancelled = false;
    getResearchList().then((a) => {
      if (!cancelled) setArticles(a);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
          Anàlisis &amp; Idees d'Inversió
        </h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Anàlisis fonamentals, models de valoració i tesis d'inversió. Accés
          gratuït i sense registre.
        </p>
      </header>

      {articles === null ? (
        <p className="text-slate-400">Carregant anàlisis…</p>
      ) : articles.length === 0 ? (
        <div className="card text-center text-slate-500">
          Encara no hi ha anàlisis publicades. Torna aviat!
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {articles.map((a) => (
            <Link
              key={a.slug}
              to={`/research/${a.slug}`}
              className="card group flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-card-hover"
            >
              {a.coverImage && (
                <img
                  src={a.coverImage}
                  alt=""
                  loading="lazy"
                  className="mb-4 h-40 w-full rounded-lg object-cover"
                />
              )}
              <div className="flex items-center gap-2">
                <TickerBadge ticker={a.ticker} />
                {a.publishedAt && (
                  <span className="text-xs text-slate-400">
                    {formatDate(a.publishedAt)}
                  </span>
                )}
              </div>
              <h2 className="mt-2 text-lg font-semibold text-slate-900 group-hover:text-brand-700">
                {a.title}
              </h2>
              <p className="mt-1 flex-1 text-sm leading-relaxed text-slate-600">
                {a.summary}
              </p>
              {a.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {a.tags.map((tag) => (
                    <TagPill key={tag} tag={tag} />
                  ))}
                </div>
              )}
              <span className="mt-4 text-sm font-medium text-brand-700">
                Llegir anàlisi →
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
