import { Fragment, useMemo, type ReactNode } from "react";
import { marked, type MarkedToken, type Token } from "marked";

type OpenLink = (url: string) => void;

// Use only the lexer. Release text never becomes HTML or an embedded resource.
function renderTokens(tokens: Token[], openLink: OpenLink): ReactNode[] {
  return tokens.map((raw, index) => {
    const token = raw as MarkedToken;
    const children = () => "tokens" in token && token.tokens
      ? renderTokens(token.tokens, openLink) : null;
    switch (token.type) {
      case "heading": {
        const Heading = token.depth <= 2 ? "h4" : "h5";
        return <Heading key={index} className="font-semibold text-ink-primary">{children()}</Heading>;
      }
      case "list": {
        const items = renderTokens(token.items, openLink);
        return token.ordered
          ? <ol key={index} start={Number(token.start)} className="list-decimal pl-5">{items}</ol>
          : <ul key={index} className="list-disc pl-5">{items}</ul>;
      }
      case "list_item": return <li key={index}>{children()}</li>;
      case "paragraph": return <p key={index}>{children()}</p>;
      case "strong": return <strong key={index}>{children()}</strong>;
      case "em": return <em key={index}>{children()}</em>;
      case "codespan":
        return <code key={index} className="rounded bg-surface-hover px-1 font-mono">{token.text}</code>;
      case "code": return <pre key={index} className="overflow-x-auto rounded-lg bg-surface-hover p-2">{token.text}</pre>;
      case "link":
        return /^https:\/\//i.test(token.href)
          ? <button key={index} type="button" onClick={() => openLink(token.href)}
              className="inline break-all text-left text-brand underline underline-offset-2">{children()}</button>
          : <Fragment key={index}>{children()}</Fragment>;
      case "br": return <br key={index} />;
      case "blockquote": return <blockquote key={index} className="border-l-2 border-brand/40 pl-2">{children()}</blockquote>;
      case "text": return <Fragment key={index}>{token.tokens ? children() : token.text}</Fragment>;
      case "escape":
      case "image": return token.text;
      case "table": return <pre key={index} className="overflow-x-auto">{token.raw}</pre>;
      default: return null;
    }
  });
}

export function ReleaseNotes({ body, openLink }: { body: string; openLink: OpenLink }) {
  const tokens = useMemo(() => marked.lexer(body), [body]);
  return (
    <div tabIndex={0} role="region" aria-label="更新日志"
      className="max-h-44 overflow-y-auto rounded-xl bg-surface-elevated px-3.5 py-3 text-xs leading-relaxed text-ink-secondary space-y-1.5 break-words">
      {body.trim() ? renderTokens(tokens, openLink) : "此发行版暂未填写更新日志。"}
    </div>
  );
}
