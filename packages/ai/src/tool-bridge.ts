// Narrow application-owned tools, not shell access. MCP transport forwards to these callbacks.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" };
export interface ArtistTool {
  name: string;
  description: string;
  inputSchema: object;
  call(args: unknown): Promise<{ content: ToolContent[]; isError?: boolean }>;
}

export async function startToolBridge(tools: ArtistTool[]) {
  const token = randomBytes(32).toString("hex");
  const server = createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(403).end(); return; }
    if (req.method !== "POST" || req.url !== "/") { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", "application/json");
    try {
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 12_000_000) throw Error("Tool request exceeds 12 MB");
        chunks.push(chunk);
      }
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (message.method === "tools/list") {
        res.end(JSON.stringify({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));
      } else if (message.method === "tools/call") {
        const tool = tools.find((candidate) => candidate.name === message.params?.name);
        if (!tool) throw Error("Unknown artist tool");
        res.end(JSON.stringify(await tool.call(message.params.arguments)));
      } else throw Error("Unsupported method");
    } catch (error) {
      res.end(JSON.stringify({ isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Artist tool bridge failed to bind");
  return { url: `http://127.0.0.1:${address.port}/`, token, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
