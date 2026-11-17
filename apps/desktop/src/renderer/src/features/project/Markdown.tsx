import { Children, isValidElement, memo } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, run } from "../../lib/api.ts";
import { CopyButton } from "./CopyButton.tsx";
import "./markdown.css";

function codeText(children: ReactNode): string {
  return Children.toArray(children).map(child => typeof child === "string" || typeof child === "number" ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? codeText(child.props.children) : "").join("");
}
const components: Components = {
  a: ({ href, children }) => /^https:\/\//i.test(href ?? "")
    ? <a href={href} onClick={event => { event.preventDefault(); void run(() => api.openExternal(href!)); }} className="text-primary underline underline-offset-4">{children}</a>
    : <span>{children}</span>,
  img: ({ alt }) => <span className="text-[13px] text-muted-foreground">[Image: {alt || "No description"}]</span>,
  pre: ({ children }) => <div className="my-4 min-w-0 overflow-hidden rounded-xl border bg-muted/50">
    <div className="flex h-9 justify-end border-b px-1"><CopyButton text={codeText(children).replace(/\n$/, "")} label="Copy code" /></div>
    <pre className="max-w-full overflow-x-auto p-4 font-mono text-[13px] leading-6" tabIndex={0} aria-label="Code">{children}</pre>
  </div>,
  code: ({ className, children }) => <code className={className}>{children}</code>,
  table: ({ children }) => <div className="my-4 max-w-full overflow-x-auto rounded-md border" tabIndex={0} aria-label="Table"><table>{children}</table></div>,
};
const plugins = [remarkGfm];

/** Only the text block receiving deltas needs to run the Markdown parser again. Raw HTML stays inert. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return <div className="project-markdown min-w-0 select-text text-[15px] leading-7"><ReactMarkdown remarkPlugins={plugins} components={components}>{text}</ReactMarkdown></div>;
});
