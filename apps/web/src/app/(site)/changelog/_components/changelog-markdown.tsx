import { Fragment, type ReactNode } from "react";
import { marked, type Token, type Tokens } from "marked";

/**
 * Renders changelog markdown as React elements instead of an HTML string.
 *
 * `CHANGELOG.md` is fetched at runtime, and markdown may carry raw HTML and
 * arbitrary link targets. Walking marked's token tree means nothing from the
 * file is ever parsed as markup: text becomes text nodes, raw HTML is shown
 * literally (comments are dropped), and a link only becomes an `<a>` when its
 * target is http(s), mailto or a same-site path.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rarr: "→",
  larr: "←",
  copy: "©",
  times: "×",
};

const ENTITY = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([a-zA-Z][\da-zA-Z]*));/g;

/** Markdown lets entities through to the output; resolve them, since a text node would print them verbatim. */
function decodeEntities(text: string): string {
  return text.replace(ENTITY, (match, dec?: string, hex?: string, name?: string) => {
    if (name) return NAMED_ENTITIES[name] ?? match;
    const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? "", 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** A link target that can't run script: http(s), mailto, or a path/fragment on this site. */
function safeHref(href: string): string | null {
  const value = href.trim();
  if (/^(?:\/(?![/\\])|#|\?)/.test(value)) return value;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:" ? value : null;
  } catch {
    return null;
  }
}

function inline(tokens: Token[] | undefined): ReactNode {
  return tokens?.map((token, i) => <Fragment key={i}>{inlineNode(token)}</Fragment>);
}

function inlineNode(token: Token): ReactNode {
  switch (token.type) {
    case "text": {
      const t = token as Tokens.Text;
      return t.tokens?.length ? inline(t.tokens) : decodeEntities(t.text);
    }
    case "escape":
      return (token as Tokens.Escape).text;
    case "strong":
      return <strong>{inline((token as Tokens.Strong).tokens)}</strong>;
    case "em":
      return <em>{inline((token as Tokens.Em).tokens)}</em>;
    case "del":
      return <del>{inline((token as Tokens.Del).tokens)}</del>;
    case "codespan":
      return <code>{(token as Tokens.Codespan).text}</code>;
    case "br":
      return <br />;
    case "link": {
      const t = token as Tokens.Link;
      const href = safeHref(t.href);
      if (!href) return inline(t.tokens);
      return (
        <a href={href} title={t.title ?? undefined}>
          {inline(t.tokens)}
        </a>
      );
    }
    case "image": {
      const t = token as Tokens.Image;
      const src = safeHref(t.href);
      if (!src || src.startsWith("mailto:")) return t.text;
      return <img src={src} alt={t.text} title={t.title ?? undefined} />;
    }
    case "html": {
      // Never interpreted as markup. Editor comments vanish; anything else is shown as written.
      const raw = (token as Tokens.HTML | Tokens.Tag).raw;
      return raw.trimStart().startsWith("<!--") ? null : raw;
    }
    default:
      return "raw" in token ? token.raw : null;
  }
}

function blocks(tokens: Token[]): ReactNode {
  return tokens.map((token, i) => <Fragment key={i}>{blockNode(token)}</Fragment>);
}

function blockNode(token: Token): ReactNode {
  switch (token.type) {
    case "space":
    case "def":
      return null;
    case "paragraph":
      return <p>{inline((token as Tokens.Paragraph).tokens)}</p>;
    case "heading": {
      const t = token as Tokens.Heading;
      const Tag = `h${Math.min(Math.max(t.depth, 1), 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag>{inline(t.tokens)}</Tag>;
    }
    case "list": {
      const t = token as Tokens.List;
      const items = t.items.map((item, i) => (
        <li key={i}>
          {item.task ? <input type="checkbox" checked={Boolean(item.checked)} disabled readOnly /> : null}
          {item.task ? " " : null}
          {/* A loose list (blank lines between items) wraps each item's text in a paragraph. */}
          {item.loose
            ? item.tokens.map((child, j) =>
                child.type === "text" ? (
                  <p key={j}>{inlineNode(child)}</p>
                ) : (
                  <Fragment key={j}>{blockNode(child)}</Fragment>
                ),
              )
            : blocks(item.tokens)}
        </li>
      ));
      return t.ordered ? (
        <ol start={typeof t.start === "number" && t.start !== 1 ? t.start : undefined}>{items}</ol>
      ) : (
        <ul>{items}</ul>
      );
    }
    case "blockquote":
      return <blockquote>{blocks((token as Tokens.Blockquote).tokens)}</blockquote>;
    case "code": {
      const t = token as Tokens.Code;
      const lang = t.lang?.match(/^[\w-]+/)?.[0];
      return (
        <pre>
          <code className={lang ? `language-${lang}` : undefined}>{t.text}</code>
        </pre>
      );
    }
    case "hr":
      return <hr />;
    case "table": {
      const t = token as Tokens.Table;
      return (
        <table>
          <thead>
            <tr>
              {t.header.map((cell, i) => (
                <th key={i} align={cell.align ?? undefined}>
                  {inline(cell.tokens)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => (
                  <td key={i} align={cell.align ?? undefined}>
                    {inline(cell.tokens)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    // A tight list item's content, or loose text: inline children with no wrapper.
    default:
      return inlineNode(token);
  }
}

/**
 * Capitalize the first letter of a detail. A detail is the tail of a
 * `**Headline** — detail` sentence, so it's written mid-sentence; once the
 * headline becomes its own row the tail has to stand as a sentence of its own.
 * Skipped when the detail opens with markup — a leading `` `command` `` or link
 * carries casing that is load-bearing, not prose.
 */
function capitalizeFirst(tokens: Token[]): void {
  const first = tokens[0];
  if (first?.type !== "paragraph") return;
  for (const token of (first as Tokens.Paragraph).tokens) {
    if (token.type !== "text" && token.type !== "escape") return;
    const t = token as Tokens.Text | Tokens.Escape;
    // Entities contain letters; mask them so `&quot;Foo` doesn't look lowercase.
    const i = t.text.replace(ENTITY, (e) => "\0".repeat(e.length)).search(/[A-Za-z]/);
    if (i === -1) continue;
    t.text = t.text.slice(0, i) + t.text[i].toUpperCase() + t.text.slice(i + 1);
    return;
  }
}

/** Block markdown (paragraphs, lists, code…) as React elements. */
export function ChangelogMarkdown({
  source,
  capitalize = false,
}: {
  source: string;
  capitalize?: boolean;
}) {
  const tokens = marked.lexer(source, { gfm: true });
  if (capitalize) capitalizeFirst(tokens);
  return <>{blocks(tokens)}</>;
}

/** Inline markdown (bold, code spans, links) as React elements — no block wrapper. */
export function ChangelogInlineMarkdown({ source }: { source: string }) {
  return <>{inline(marked.Lexer.lexInline(source, { gfm: true }))}</>;
}
