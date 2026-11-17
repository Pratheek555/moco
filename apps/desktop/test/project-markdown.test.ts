import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../src/renderer/src/lib/api.ts", () => ({ api: { copyText: vi.fn(), openExternal: vi.fn() }, run: vi.fn() }));
import { Markdown } from "../src/renderer/src/features/project/Markdown.tsx";
import { TooltipProvider } from "../src/renderer/src/components/ui/tooltip.tsx";

const render = (text: string) => renderToStaticMarkup(createElement(TooltipProvider, null, createElement(Markdown, { text })));

describe("project Markdown", () => {
  it("renders Markdown and GFM tables with a horizontal scroll wrapper", () => {
    const html = render("# Heading\n\n**bold**\n\n| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<h1>Heading</h1>"); expect(html).toContain("<strong>bold</strong>"); expect(html).toContain("overflow-x-auto"); expect(html).toContain("<table>");
  });
  it("never loads remote images or executes raw HTML", () => {
    const html = render('![A remote image](https://example.com/image.png)\n\n<script>alert(1)</script>\n\n<img src="https://example.com/evil.png">');
    expect(html).toContain("[Image: A remote image]"); expect(html).not.toContain("<img"); expect(html).not.toContain("<script>"); expect(html).not.toContain('src="https:');
  });
  it("allows https links only and leaves other links as plain text", () => {
    const html = render("[secure](https://example.com) [http](http://example.com) [mail](mailto:a@example.com) [local](file:///C:/test) [js](javascript:alert(1))");
    expect(html).toContain('href="https://example.com"'); expect((html.match(/<a /g) ?? []).length).toBe(1);
    expect(html).toContain("<span>http</span>"); expect(html).toContain("<span>local</span>");
  });
  it("puts fenced code in a scrollable box with a named copy control", () => {
    const html = render("```js\nconst a = '<script>';\n```");
    expect(html).toContain('aria-label="Copy code"'); expect(html).toContain('aria-label="Code"'); expect(html).toContain("overflow-x-auto"); expect(html).toContain("&lt;script&gt;");
  });
});
