import { codexCli } from "@moco/ai";
let called = false;
const ai = codexCli();
console.log(await ai.available());
const result = await ai.generate({
  system: "You are checking the moco artist tool bridge. Call read_brief once, then repeat its verification token in your final response. Do not guess the token.",
  prompt: "Read the available artist brief tool and report the token.",
  timeoutMs: 120_000,
  artistTools: [{ name: "read_brief", description: "Read the verification token", inputSchema: { type: "object", properties: {}, additionalProperties: false }, call: async () => { called = true; return { content: [{ type: "text", text: "Verification token: artist-tools-connected" }] }; } }],
});
console.log({ called, text: result.text, backend: result.backend, model: result.model });
if (!called || !result.text.includes("artist-tools-connected")) throw Error("Codex did not execute the artist tool");


