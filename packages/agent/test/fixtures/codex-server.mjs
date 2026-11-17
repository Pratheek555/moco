// A protocol peer for tests. It never connects to a model or executes agent commands.
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";

const send = message => process.stdout.write(JSON.stringify(message) + "\n");
const notify = (method, params) => send({ method, params: { threadId: "codex-thread", ...params } });
const pending = new Map();
let initialized = false, turnId, count = 0;
const finish = (status = "completed") => {
  notify("turn/completed", { turn: { id: turnId, status, error: status === "failed" ? { message: "Model unavailable" } : null } });
  turnId = undefined;
};
function request(method, params) {
  const id = `server-${++count}`;
  return new Promise(resolve => { pending.set(id, resolve); send({ id, method, params: { threadId: "codex-thread", turnId, ...params } }); });
}
async function turn(text) {
  if (text === "crash") { process.exit(3); }
  if (text === "hold" || text === "race") return;
  if (text === "native question") {
    const answer = await request("item/tool/requestUserInput", { itemId: "input", questions: [{ id: "starting_point", question: "Where are you starting?", header: "Start", options: [{ label: "Ideas", description: "Start fresh" }], isOther: true, isSecret: false }] });
    notify("item/completed", { turnId, item: { type: "agentMessage", id: "answer", text: JSON.stringify(answer) } });
  } else if (text === "question") {
    const answer = await request("item/tool/call", { callId: "question", tool: "moco_AskUserQuestion", arguments: { questions: [{ question: "Choose the style?", header: "Style", multiSelect: true, options: [{ label: "Drawn" }, { label: "3D" }] }] } });
    notify("item/completed", { turnId, item: { type: "agentMessage", id: "answer", text: JSON.stringify(answer) } });
  } else if (text.startsWith("deliver ")) {
    const result = await request("item/tool/call", { callId: "delivery", tool: "moco_SendUserFile", arguments: { path: text.slice(8), label: "Preview" } });
    notify("item/completed", { turnId, item: { type: "agentMessage", id: "delivery-result", text: JSON.stringify(result) } });
  } else {
    notify("item/agentMessage/delta", { turnId, itemId: "reply", delta: "Hello " });
    notify("item/agentMessage/delta", { turnId, itemId: "reply", delta: text });
    notify("item/completed", { turnId, item: { type: "agentMessage", id: "reply", text: `Hello ${text}` } });
  }
  if (turnId) finish();
}

createInterface({ input: process.stdin }).on("line", async line => {
  const message = JSON.parse(line);
  if (process.env.MOCO_TEST_CODEX_LOG) appendFileSync(process.env.MOCO_TEST_CODEX_LOG, JSON.stringify(message) + "\n");
  const { id, method, params = {} } = message;
  if (!method) { pending.get(id)?.(message.result ?? message.error); pending.delete(id); return; }
  const result = value => send({ id, result: value });
  const error = message => send({ id, error: { code: -32600, message } });
  if (method === "initialize") {
    initialized = true;
    result({ userAgent: "codex-fixture/1.0" });
  } else if (!initialized) error("Initialize first");
  else if (method === "account/read") result({ account: process.env.MOCO_TEST_CODEX_AUTH === "none" ? null : { type: process.env.MOCO_TEST_CODEX_AUTH ?? "chatgpt" } });
  else if (method === "thread/start" || method === "thread/resume") {
    if (params.dynamicTools?.some(tool => tool.name.startsWith("mcp__"))) error("Dynamic tool name is reserved");
    else if (params.threadId === "missing") error("Thread not found");
    else result({ thread: { id: params.threadId ?? "codex-thread" } });
  } else if (method === "turn/start") {
    turnId = `turn-${++count}`;
    const current = turnId;
    result({ turn: { id: turnId, status: "inProgress" } });
    notify("turn/started", { turn: { id: turnId, status: "inProgress" } });
    setImmediate(() => { if (turnId === current) void turn(params.input[0].text); });
  } else if (method === "turn/steer") {
    if (params.input[0].text === "finish during steer") { finish(); error("No active turn"); }
    else { result({ turnId }); void turn(params.input[0].text); }
  } else if (method === "turn/interrupt") { result({}); finish("interrupted"); }
  else if (method !== "initialized") error(`Unknown request ${method}`);
}).on("close", () => process.exit(0));
