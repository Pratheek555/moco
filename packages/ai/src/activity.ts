// Read only public assistant messages from CLI JSONL. Reasoning, tool inputs,
// structured artifacts and process diagnostics never become chat updates.
export function activityReader(notify: (message: string) => void) {
  let pending = "";
  const read = (line: string) => {
    try {
      const event = JSON.parse(line);
      const texts: string[] = event.type === "item.completed" && event.item?.type === "agent_message"
        ? [event.item.text]
        : event.type === "assistant" && Array.isArray(event.message?.content)
          ? event.message.content.filter((part: { type?: string }) => part.type === "text").map((part: { text: string }) => part.text)
          : [];
      for (const text of texts) {
        const message = typeof text === "string" ? text.trim() : "";
        if (!message || /^[\[{`]/.test(message)) continue;
        try { notify(message.slice(0, 1200)); } catch { /* UI observers cannot fail generation. */ }
      }
    } catch { /* A diagnostic or incomplete JSON line is not public activity. */ }
  };
  return {
    write(chunk: string) {
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) {
        read(pending.slice(0, end)); pending = pending.slice(end + 1);
      }
    },
    end() { if (pending.trim()) read(pending); pending = ""; },
  };
}

export const ACTIVITY_GUIDANCE = "\n\nWhile working, send a few brief public progress updates as separate plain-text assistant messages describing observable work on the requested artifact. Do not reveal private reasoning. The final message must contain only the requested JSON artifact, with no progress prose inside it.";
