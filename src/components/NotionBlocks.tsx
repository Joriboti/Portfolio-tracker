import { Fragment } from "react";
import { Link } from "react-router-dom";
import type { NotionBlock } from "@/lib/research";
import { useLocale } from "@/components/LocaleLink";
import { withLocale } from "@/lib/locale";
import { normalizeArticleLink } from "@/lib/article-links";

// Minimal, dependency-free renderer for the Notion block types the Research
// articles use: paragraph, heading_1/2/3, bulleted/numbered lists, quote,
// callout, divider, table, image, code. Unknown blocks render their plain text
// (or nothing) so a new block type never breaks the page.

/* eslint-disable @typescript-eslint/no-explicit-any */

function RichText({ rich }: { rich: any[] }) {
  const locale = useLocale();
  return (
    <>
      {(rich ?? []).map((t, i) => {
        const a = t?.annotations ?? {};
        let node: React.ReactNode = t?.plain_text ?? "";
        if (a.code)
          node = (
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em] text-brand-700">
              {node}
            </code>
          );
        if (a.bold) node = <strong>{node}</strong>;
        if (a.italic) node = <em>{node}</em>;
        if (a.strikethrough) node = <s>{node}</s>;
        if (a.underline) node = <u>{node}</u>;
        if (t?.href) {
          // A link an author typed into Notion can point at our own site with
          // the wrong scheme, the wrong host or no locale (http://trimmtrack.com
          // /explore inside /en/research/meta). Those cost a redirect hop and
          // drop an English reader onto a Catalan page, so internal targets are
          // normalised to an in-app route in the reader's language and rendered
          // as a client-side <Link>; anything genuinely external is untouched.
          const internal = normalizeArticleLink(t.href);
          node = internal ? (
            <Link
              to={withLocale(internal, locale)}
              className="text-brand-700 underline hover:text-brand-800"
            >
              {node}
            </Link>
          ) : (
            <a
              href={t.href}
              target="_blank"
              rel="noreferrer"
              className="text-brand-700 underline hover:text-brand-800"
            >
              {node}
            </a>
          );
        }
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

function imageUrl(img: any): string | null {
  return img?.file?.url ?? img?.external?.url ?? null;
}

function Block({ block }: { block: NotionBlock }) {
  const type = block?.type;
  const data = block?.[type];
  switch (type) {
    case "paragraph":
      return (
        <p className="my-4 leading-relaxed text-slate-700">
          <RichText rich={data.rich_text} />
        </p>
      );
    case "heading_1":
      return (
        <h2 className="mt-8 mb-3 text-2xl font-bold text-slate-900">
          <RichText rich={data.rich_text} />
        </h2>
      );
    case "heading_2":
      return (
        <h3 className="mt-7 mb-2 text-xl font-semibold text-slate-900">
          <RichText rich={data.rich_text} />
        </h3>
      );
    case "heading_3":
      return (
        <h4 className="mt-6 mb-2 text-lg font-semibold text-slate-900">
          <RichText rich={data.rich_text} />
        </h4>
      );
    case "quote":
      return (
        <blockquote className="my-5 border-l-4 border-brand-300 bg-brand-50/40 py-2 pl-4 italic text-slate-700">
          <RichText rich={data.rich_text} />
        </blockquote>
      );
    case "callout":
      return (
        <div className="my-5 flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          {data.icon?.emoji && <span aria-hidden>{data.icon.emoji}</span>}
          <div>
            <RichText rich={data.rich_text} />
            {block.children && <Blocks blocks={block.children} />}
          </div>
        </div>
      );
    case "divider":
      return <hr className="my-8 border-slate-200" />;
    case "code":
      return (
        <pre className="my-5 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
          <code>{(data.rich_text ?? []).map((t: any) => t.plain_text).join("")}</code>
        </pre>
      );
    case "image": {
      const url = imageUrl(data);
      if (!url) return null;
      const caption = plainText(data.caption);
      return (
        <figure className="my-8">
          {/* Framed card: a padded white mat + subtle ring/shadow so charts
              (often on a white background) read as a deliberate figure, not a
              raw paste. */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-sm ring-1 ring-slate-900/5">
            <img
              src={url}
              alt={caption}
              loading="lazy"
              className="mx-auto w-full rounded-lg"
              // Notion serves body images as ~1h-signed S3 URLs; if one has
              // expired by the time it loads, hide the whole figure cleanly
              // instead of showing a broken-image icon.
              onError={(e) => {
                const fig = e.currentTarget.closest("figure") as HTMLElement | null;
                if (fig) fig.style.display = "none";
              }}
            />
          </div>
          {caption && (
            <figcaption className="mt-2 text-center text-xs italic text-slate-400">
              {caption}
            </figcaption>
          )}
        </figure>
      );
    }
    case "table":
      return (
        <div className="my-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {(block.children ?? []).map((row: any, ri: number) => (
                <tr key={ri} className="border-b border-slate-200">
                  {(row.table_row?.cells ?? []).map((cell: any[], ci: number) => (
                    <td key={ci} className="px-3 py-2 align-top">
                      <RichText rich={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      // Unknown block: fall back to its plain text if any.
      return data?.rich_text ? (
        <p className="my-4 text-slate-700">
          <RichText rich={data.rich_text} />
        </p>
      ) : null;
  }
}

function plainText(rich: any[] | undefined): string {
  return (rich ?? []).map((t) => t?.plain_text ?? "").join("");
}

// Renders a block array, grouping consecutive list items into <ul>/<ol>.
export function Blocks({ blocks }: { blocks: NotionBlock[] }) {
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    const t = b?.type;
    if (t === "bulleted_list_item" || t === "numbered_list_item") {
      const items: NotionBlock[] = [];
      while (i < blocks.length && blocks[i]?.type === t) {
        items.push(blocks[i]);
        i++;
      }
      const listClass =
        t === "bulleted_list_item"
          ? "my-4 list-disc space-y-1 pl-6 text-slate-700"
          : "my-4 list-decimal space-y-1 pl-6 text-slate-700";
      const List = t === "bulleted_list_item" ? "ul" : "ol";
      out.push(
        <List key={`list-${i}`} className={listClass}>
          {items.map((li) => (
            <li key={li.id}>
              <RichText rich={li[li.type].rich_text} />
              {li.children && <Blocks blocks={li.children} />}
            </li>
          ))}
        </List>,
      );
      continue;
    }
    out.push(<Block key={b?.id ?? i} block={b} />);
    i++;
  }
  return <>{out}</>;
}
