import assert from "node:assert/strict";
import { mock, test } from "node:test";
import registerExtension from "../src/index.ts";

function startPrompt({ mode = "tui", draft = "", images, cancelled = false } = {}) {
  const handlers = new Map();
  let command;
  let editor = draft;
  const user = { role: "user", content: [{ type: "text", text: "Original prompt" }] };
  const branch = [{ type: "message", id: "user", parentId: null, message: user }];
  const sendUserMessage = mock.fn();
  const appendEntry = mock.fn();
  const navigateTree = mock.fn(async () => {
    if (!cancelled) {
      branch.length = 0;
      editor = user.content[0].text;
    }
    return { cancelled };
  });
  const ctx = {
    mode,
    ui: { getEditorText: () => editor },
    sessionManager: { getBranch: () => branch, getLeafId: () => branch.at(-1)?.id ?? null },
    isIdle: () => true,
    navigateTree,
  };
  registerExtension({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, options) => {
      command = { name, ...options };
    },
    sendUserMessage,
    appendEntry,
  });
  const emit = (name, event) => handlers.get(name)(event, ctx);
  emit("before_agent_start", { messageType: "user", prompt: user.content[0].text, images });
  emit("message_end", { message: user });
  return {
    emit,
    ctx,
    branch,
    appendEntry,
    sendUserMessage,
    navigateTree,
    runCommand: () => command.handler("", ctx),
    commandName: command.name,
  };
}

test("rewinds after settlement, restores the prompt and persists the active branch", async () => {
  const run = startPrompt();
  run.emit("message_update", { assistantMessageEvent: { type: "thinking_delta", delta: "Thinking" } });
  run.emit("message_end", {
    message: { role: "assistant", content: [{ type: "thinking", thinking: "Thinking" }], stopReason: "aborted" },
  });
  run.emit("agent_settled", { aborted: true });
  assert.equal(run.sendUserMessage.mock.callCount(), 1);
  assert.deepEqual(run.sendUserMessage.mock.calls[0].arguments, [
    `/${run.commandName}`,
    { expandPromptTemplates: true },
  ]);
  assert.equal(run.navigateTree.mock.callCount(), 0);

  await run.runCommand();
  assert.deepEqual(run.navigateTree.mock.calls[0].arguments, ["user", { summarize: false }]);
  assert.deepEqual(run.branch, []);
  assert.equal(run.ctx.ui.getEditorText(), "Original prompt");
  assert.equal(run.appendEntry.mock.callCount(), 1);
  await run.runCommand();
  assert.equal(run.navigateTree.mock.callCount(), 1);
});

test("keeps an interrupted turn after streamed reply text, even if the final message is empty", () => {
  const run = startPrompt();
  run.emit("message_update", { assistantMessageEvent: { type: "text_delta", delta: "Partial answer" } });
  run.emit("message_end", { message: { role: "assistant", content: [], stopReason: "aborted" } });
  run.emit("agent_settled", { aborted: true });
  assert.equal(run.sendUserMessage.mock.callCount(), 0);
});

test("keeps an interrupted turn after a tool starts or a second prompt is delivered", () => {
  const tool = startPrompt();
  tool.emit("tool_execution_start", {});
  tool.emit("agent_settled", { aborted: true });
  assert.equal(tool.sendUserMessage.mock.callCount(), 0);

  const steering = startPrompt();
  steering.emit("message_end", { message: { role: "user", content: [{ type: "text", text: "Steer" }] } });
  steering.emit("agent_settled", { aborted: true });
  assert.equal(steering.sendUserMessage.mock.callCount(), 0);
});

test("does not rewind normal completions, drafts, image prompts, or non-TUI sessions", () => {
  for (const [options, aborted] of [
    [{}, false],
    [{ draft: "New draft" }, true],
    [{ images: [{ type: "image" }] }, true],
    [{ mode: "rpc" }, true],
  ]) {
    const run = startPrompt(options);
    run.emit("agent_settled", { aborted });
    assert.equal(run.sendUserMessage.mock.callCount(), 0);
  }
});

test("does not rewind if the branch changed before the command ran", async () => {
  const run = startPrompt();
  run.emit("agent_settled", { aborted: true });
  run.branch.push({ type: "custom", id: "later" });
  await run.runCommand();
  assert.equal(run.navigateTree.mock.callCount(), 0);
});

test("does not append a marker if another extension cancels navigation", async () => {
  const run = startPrompt({ cancelled: true });
  run.emit("agent_settled", { aborted: true });
  await run.runCommand();
  assert.equal(run.navigateTree.mock.callCount(), 1);
  assert.equal(run.appendEntry.mock.callCount(), 0);
});
