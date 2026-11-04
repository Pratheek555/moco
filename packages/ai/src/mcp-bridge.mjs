// Dependency-free MCP stdio adapter. Never log to stdout outside JSON-RPC responses.
import { createInterface } from 'node:readline';
const input = createInterface({ input: process.stdin });
const write = value => process.stdout.write(JSON.stringify(value) + '\n');
input.on('line', async line => {
  let request;
  try {
    request = JSON.parse(line);
    if (request.id === undefined) return;
    let result;
    if (request.method === 'initialize') {
      result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'moco-artist', version: '1.0.0' } };
    } else if (request.method === 'ping') result = {};
    else {
      const response = await fetch(process.env.MOCO_ARTIST_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MOCO_ARTIST_TOKEN}` }, body: JSON.stringify(request) });
      if (!response.ok) throw Error(`Artist bridge HTTP ${response.status}`);
      result = await response.json();
    }
    write({ jsonrpc: '2.0', id: request.id, result });
  } catch (error) {
    if(request?.id !== undefined) write({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: String(error.message || error) } });
  }
});
