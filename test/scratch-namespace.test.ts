import assert from "node:assert/strict";
import test from "node:test";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { createDeepAgent, createFilesystemMiddleware } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import { scratchNamespace } from "../server/scratch-namespace.ts";

test("scratch aliases change only tool-name fields at the model boundary", async () => {
  const literal =
    'User code: read_file("scratch_read_file"); edit_file and workspace_read_file';
  const args = { file_path: "/read_file.txt", content: literal };
  const history = new AIMessage({
    content: literal,
    tool_calls: [{ id: "old", name: "write_file", args, type: "tool_call" }],
    additional_kwargs: {
      tool_calls: [
        {
          id: "old",
          type: "function",
          function: { name: "write_file", arguments: JSON.stringify(args) },
        },
      ],
    },
  });
  const output = new ToolMessage({
    tool_call_id: "old",
    name: "write_file",
    content: literal,
  });
  const human = new HumanMessage(literal);
  const native = tool(async () => "", {
    name: "read_file",
    description: "native",
    schema: z.object({ file_path: z.string() }),
  });
  const workspace = tool(async () => "", {
    name: "workspace_read_file",
    description: "project",
    schema: z.object({ path: z.string() }),
  });
  const response = new AIMessage({
    id: "answer",
    content: literal,
    tool_calls: [
      {
        id: "next",
        name: "scratch_read_file",
        args: { file_path: "/read_file.txt" },
        type: "tool_call",
      },
    ],
    additional_kwargs: {
      tool_calls: [
        {
          id: "next",
          type: "function",
          function: {
            name: "scratch_read_file",
            arguments: JSON.stringify(args),
          },
        },
      ],
    },
    usage_metadata: { input_tokens: 11, output_tokens: 3, total_tokens: 14 },
    response_metadata: { fixture: "retained" },
  });
  const result = await scratchNamespace().wrapModelCall!(
    {
      tools: [native, workspace],
      messages: [human, history, output],
      systemMessage: new SystemMessage("original system"),
    } as never,
    async (request) => {
      assert.deepEqual(
        request.tools.map((entry) => entry.name),
        ["scratch_read_file", "workspace_read_file"],
      );
      assert.equal(request.tools[0].schema, native.schema);
      assert.equal(request.tools[1], workspace);
      assert.match(
        request.tools[0].description as string,
        /PRIVATE CONVERSATION SCRATCH/,
      );
      assert.match(
        String(request.systemMessage?.content),
        /scratch_read_file\(file_path, offset, limit\)/,
      );
      assert.equal(request.messages[0], human);
      const viewed = request.messages[1] as AIMessage;
      assert.equal(viewed.tool_calls?.[0].name, "scratch_write_file");
      assert.deepEqual(viewed.tool_calls?.[0].args, args);
      assert.equal(
        viewed.additional_kwargs.tool_calls?.[0].function.name,
        "scratch_write_file",
      );
      assert.equal(
        viewed.additional_kwargs.tool_calls?.[0].function.arguments,
        JSON.stringify(args),
      );
      assert.equal(viewed.content, literal);
      assert.equal(request.messages[2].name, "scratch_write_file");
      assert.equal(request.messages[2].content, literal);
      return response;
    },
  );
  assert.ok(AIMessage.isInstance(result));
  assert.equal(result.tool_calls?.[0].name, "read_file");
  assert.equal(
    result.additional_kwargs.tool_calls?.[0].function.name,
    "read_file",
  );
  assert.equal(
    result.additional_kwargs.tool_calls?.[0].function.arguments,
    JSON.stringify(args),
  );
  assert.equal(result.content, literal);
  assert.deepEqual(result.usage_metadata, response.usage_metadata);
  assert.deepEqual(result.response_metadata, response.response_metadata);
  assert.equal(result.id, "answer");
  assert.equal(native.name, "read_file");
  assert.equal(history.tool_calls?.[0].name, "write_file");
  assert.equal(output.name, "write_file");
  assert.equal(response.tool_calls?.[0].name, "scratch_read_file");
});

class ScriptedModel extends BaseChatModel {
  script: (messages: BaseMessage[], turn: number) => AIMessage;
  calls = 0;
  constructor(script: ScriptedModel["script"]) {
    super({});
    this.script = script;
  }
  _llmType() {
    return "scratch-namespace-fixture";
  }
  bindTools(tools: any[]) {
    const names = tools.map((entry) => entry.name);
    for (const name of [
      "ls",
      "read_file",
      "write_file",
      "edit_file",
      "delete",
      "glob",
      "grep",
    ]) {
      assert.ok(names.includes(`scratch_${name}`), `missing alias ${name}`);
      assert.ok(!names.includes(name), `native tool exposed: ${name}`);
    }
    return this;
  }
  async _generate(messages: BaseMessage[]) {
    for (const message of messages) {
      if (AIMessage.isInstance(message))
        for (const call of message.tool_calls ?? [])
          assert.ok(
            ![
              "ls",
              "read_file",
              "write_file",
              "edit_file",
              "delete",
              "glob",
              "grep",
            ].includes(call.name),
          );
    }
    return {
      generations: [{ text: "", message: this.script(messages, ++this.calls) }],
    };
  }
}

const call = (id: string, name: string, args: Record<string, unknown>) =>
  new AIMessage({
    content: "",
    tool_calls: [{ id, name, args, type: "tool_call" }],
  });
const text = (message: BaseMessage | undefined) =>
  typeof message?.content === "string"
    ? message.content
    : JSON.stringify(message?.content);

test("Deep Agents dispatches aliases, preserves canonical checkpoints and resumes scratch state", async () => {
  const saver = new MemorySaver();
  let projectWrites = 0;
  const project = tool(
    async () => {
      projectWrites++;
      return "real project tool called";
    },
    {
      name: "workspace_write_file",
      description: "fixture real workspace",
      schema: z.object({ path: z.string(), content: z.string() }),
    },
  );
  const model = new ScriptedModel((messages, turn) => {
    if (turn === 1)
      return call("write", "scratch_write_file", {
        file_path: "/note.txt",
        content: "scratch contents",
      });
    if (turn === 2)
      return call("edit", "scratch_edit_file", {
        file_path: "/note.txt",
        old_string: "contents",
        new_string: "updated",
      });
    if (turn === 3)
      return call("project", "workspace_write_file", {
        path: "note.txt",
        content: "project contents",
      });
    if (turn === 4)
      return call("read", "scratch_read_file", { file_path: "/note.txt" });
    assert.match(text(messages.at(-1)), /scratch updated/);
    return new AIMessage("done");
  });
  const agent = createDeepAgent({
    model,
    tools: [project],
    checkpointer: saver,
    middleware: [scratchNamespace()],
  });
  const config = { configurable: { thread_id: "canonical-scratch" } };
  const result = await agent.invoke(
    { messages: [new HumanMessage("fixture")] },
    config,
  );
  assert.equal(projectWrites, 1);
  assert.equal(result.files?.["/note.txt"].content, "scratch updated");
  const stored = await saver.getTuple(config);
  const calls = (stored?.checkpoint.channel_values.messages as BaseMessage[])
    .filter(AIMessage.isInstance)
    .flatMap((message) => message.tool_calls ?? []);
  assert.deepEqual(
    calls.map((entry) => entry.name),
    ["write_file", "edit_file", "workspace_write_file", "read_file"],
  );
  const resumed = new ScriptedModel((messages, turn) => {
    if (turn === 1)
      return call("resumed-read", "scratch_read_file", {
        file_path: "/note.txt",
      });
    assert.match(text(messages.at(-1)), /scratch updated/);
    return new AIMessage("resumed");
  });
  const next = createDeepAgent({
    model: resumed,
    tools: [project],
    checkpointer: saver,
    middleware: [scratchNamespace()],
  });
  const resumedResult = await next.invoke(
    { messages: [new HumanMessage("resume")] },
    config,
  );
  assert.equal(resumedResult.messages.at(-1)?.content, "resumed");
  assert.equal(resumedResult.files?.["/note.txt"].content, "scratch updated");
  assert.equal(projectWrites, 1);
});

test("large results still evict and recover without rewriting tool content", async () => {
  const longText = Array.from(
    { length: 150 },
    (_, i) => `line ${i}: literal read_file and scratch_read_file text`,
  ).join("\n");
  const resultTool = tool(async () => longText, {
    name: "workspace_report",
    description: "fixture large result",
    schema: z.object({}),
  });
  const model = new ScriptedModel((messages, turn) => {
    if (turn === 1) return call("large", "workspace_report", {});
    if (turn === 2) {
      const notice = text(messages.at(-1));
      assert.match(notice, /read_file tool with offset=0/);
      assert.match(notice, /literal read_file and scratch_read_file text/);
      assert.doesNotMatch(notice, /scratch_scratch_/);
      assert.match(
        String(messages[0].content),
        /recover an offloaded result with scratch_read_file/,
      );
      return call("recovery", "scratch_read_file", {
        file_path: "/large_tool_results/large.txt",
        offset: 0,
        limit: 2,
      });
    }
    assert.match(
      text(messages.at(-1)),
      /line 0: literal read_file and scratch_read_file text/,
    );
    assert.doesNotMatch(text(messages.at(-1)), /Tool result too large/);
    return new AIMessage("recovered");
  });
  const agent = createDeepAgent({
    model,
    tools: [resultTool],
    middleware: [
      createFilesystemMiddleware({
        toolTokenLimitBeforeEvict: 128,
        humanMessageTokenLimitBeforeEvict: null,
      }),
      scratchNamespace(),
    ],
  });
  const result = await agent.invoke({
    messages: [new HumanMessage("fixture")],
  });
  assert.equal(
    result.files?.["/large_tool_results/large.txt"].content,
    longText,
  );
  assert.equal(result.messages.at(-1)?.content, "recovered");
  assert.deepEqual(
    result.messages
      .filter(AIMessage.isInstance)
      .flatMap((message) =>
        (message.tool_calls ?? []).map((entry) => entry.name),
      ),
    ["workspace_report", "read_file"],
  );
});
