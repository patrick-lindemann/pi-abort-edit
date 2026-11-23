import type { ExtensionAPI, SessionMessageEntry } from "@earendil-works/pi-coding-agent";

const rewindCommand = "abort-edit-rewind";

type UserMessage = Extract<SessionMessageEntry["message"], { role: "user" }>;

export function registerExtension(pi: ExtensionAPI): void {
  let turn: { message?: UserMessage } | undefined;
  let pending: { entryId: string; leafId: string | null } | undefined;

  pi.on("before_agent_start", (event, ctx) => {
    turn = undefined;
    if (ctx.mode === "tui" && event.messageType === "user" && event.prompt.trim() && !event.images?.length) {
      turn = {};
    }
  });

  pi.on("message_update", (event) => {
    if (event.assistantMessageEvent.type === "text_delta" && event.assistantMessageEvent.delta.trim()) {
      turn = undefined;
    }
  });

  pi.on("message_end", ({ message }) => {
    if (!turn) {
      return;
    }
    if (message.role === "user") {
      // A delivered steering or follow-up message makes the run unsafe to rewind as one prompt.
      if (turn.message) {
        turn = undefined;
      } else {
        turn.message = message;
      }
    } else if (
      message.role === "assistant" &&
      ((message.stopReason !== "aborted" && message.stopReason !== "error") ||
        message.content.some((part) => part.type === "toolCall" || (part.type === "text" && part.text.trim())))
    ) {
      turn = undefined;
    }
  });

  pi.on("tool_execution_start", () => {
    turn = undefined;
  });

  pi.on("agent_settled", ({ aborted }, ctx) => {
    const message = turn?.message;
    turn = undefined;
    if (!aborted || !message || ctx.ui.getEditorText()) {
      return;
    }

    const entry = ctx.sessionManager
      .getBranch()
      .findLast((entry) => entry.type === "message" && entry.message === message);
    if (!entry) {
      return;
    }
    pending = { entryId: entry.id, leafId: ctx.sessionManager.getLeafId() };
    // Pi defers this command until settlement handlers have finished. Only commands can navigate the tree.
    pi.sendUserMessage(`/${rewindCommand}`, { expandPromptTemplates: true });
  });

  pi.registerCommand(rewindCommand, {
    description: "Finish rewinding an interrupted prompt",
    handler: async (_args, ctx) => {
      const target = pending;
      pending = undefined;
      if (!target || !ctx.isIdle() || ctx.ui.getEditorText() || ctx.sessionManager.getLeafId() !== target.leafId) {
        return;
      }
      const result = await ctx.navigateTree(target.entryId, { summarize: false });
      if (!result.cancelled) {
        // Without an entry on the new branch, Pi resumes at the last saved entry on the abandoned branch.
        pi.appendEntry(rewindCommand);
      }
    },
  });
}
