import type { SessionView } from "./types.ts";

export function exportConversation(session: SessionView): string {
  return [
    `# ${session.title}`,
    `Talaria · ${session.mode} · ${session.createdAt}`,
    ...session.messages.map(
      (message) =>
        `## ${message.role === "user" ? "你" : "Agent"}${message.status !== "complete" ? `（${message.status}）` : ""}\n\n${message.content}`,
    ),
  ].join("\n\n");
}
