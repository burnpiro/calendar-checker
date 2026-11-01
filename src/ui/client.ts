import type { Command, Reply } from "../shared/model";

export async function sendCommand(
  command: Command,
): Promise<Extract<Reply, { ok: true }>> {
  let reply: Reply;
  try {
    reply = (await chrome.runtime.sendMessage({
      namespace: "calendar-checker",
      command,
    })) as Reply;
  } catch {
    throw new Error(
      "The extension could not be reached. Reload the extension and open this page again.",
    );
  }
  if (!reply || !reply.ok) {
    throw new Error(
      reply && !reply.ok
        ? reply.error.message
        : "The extension returned an unexpected response.",
    );
  }
  return reply;
}
