import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { LocaleLink, useLocale } from "@/components/LocaleLink";
import { useTranslation } from "react-i18next";
import { getResearchArticle, type ResearchArticle } from "@/lib/research";
import { Blocks } from "@/components/NotionBlocks";
import { ResearchWordmark } from "@/components/Logo";
import { useSeo } from "@/lib/seo";
import { localeUrl, withLocale } from "@/lib/locale";
import { articleLocales, resolveArticleLocale } from "@/lib/research-locales";
import { TickerBadge, TagPill, formatDate } from "./research";

const FALLBACK_OG = "https://www.trimmtrack.com/og.png";

export function ResearchArticlePage() {
  const { t, i18n } = useTranslation();
  const { slug = "" } = useParams();
  const locale = useLocale();
  // This article is not written in the language of the URL. vercel.json 301s the
  // known cases at the edge; this handles an article added to the manifest after
  // the redirect list (and keeps in-app navigation honest) rather than rendering
  // English prose under a Spanish canonical.
  const shouldBe = resolveArticleLocale(slug, locale);
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

  // Canonical/JSON-LD URL for THIS language variant — it used to be hardcoded to
  // the Catalan path, so the English and Spanish pages pointed their structured
  // data at a different URL than their canonical.
  const url = localeUrl(`/research/${slug}`, locale);
  useSeo({
    title: article
      ? `${article.title} | TrimmTrack`
      : t("research.fallbackTitle"),
    description: article?.summary,
    image: article?.coverImage ?? FALLBACK_OG,
    // Only the languages this article is really written in. An unknown slug
    // (published in Notion since the last deploy) advertises just itself.
    alternates: articleLocales(slug).length ? articleLocales(slug) : [locale],
    jsonLd: article
      ? {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: article.title,
          inLanguage: locale,
          datePublished: article.publishedAt ?? undefined,
          image: article.coverImage ?? FALLBACK_OG,
          author: { "@type": "Organization", name: "TrimmTrack" },
          publisher: { "@type": "Organization", name: "TrimmTrack" },
          mainEntityOfPage: url,
        }
      : undefined,
  });

  if (shouldBe) {
    return <Navigate to={withLocale(`/research/${slug}`, shouldBe)} replace />;
  }

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-slate-400">
        {t("research.loadingArticle")}
      </div>
    );
  }

  if (state === "notfound" || !article) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-slate-600">{t("research.notFound")}</p>
        <LocaleLink to="/research" className="btn-primary mt-4 inline-flex">
          ← {t("research.backToAll")}
        </LocaleLink>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <LocaleLink to="/research" className="inline-block transition-opacity hover:opacity-80">
        <ResearchWordmark />
      </LocaleLink>
      <LocaleLink
        to="/research"
        className="mt-6 block text-sm text-slate-500 hover:text-slate-800"
      >
        ← {t("research.backToAll")}
      </LocaleLink>

      <header className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <TickerBadge ticker={article.ticker} />
          {article.publishedAt && (
            <span className="text-xs text-slate-400">
              {formatDate(article.publishedAt, i18n.language)}
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
          {t("research.ctaTitle", {
            name: article.ticker || t("research.ctaCompany"),
          })}
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
          {t("research.ctaBody")}
        </p>
        <LocaleLink to="/disclaimer" className="btn-primary mt-4 inline-flex">
          {t("research.ctaButton")} →
        </LocaleLink>
      </div>
    </div>
  );
}
