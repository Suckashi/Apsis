import {
  AIMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { createMiddleware } from "langchain";

const descriptions = {
  ls: "List PRIVATE CONVERSATION SCRATCH files. This is not the project workspace. Use workspace_list_files for real project files. Scratch paths start with /, without drive letters.",
  read_file:
    "Read PRIVATE CONVERSATION SCRATCH notes or offloaded results. This is not the project workspace. Use workspace_read_file for real project files. file_path is a virtual /path; offset and limit count lines.",
  write_file:
    "Create a PRIVATE CONVERSATION SCRATCH note. This never creates a user deliverable. Use workspace_write_file for real project files. file_path is a virtual /path, without drive letters.",
  edit_file:
    "Edit a PRIVATE CONVERSATION SCRATCH note using old_string and new_string. This never changes project files. Use workspace_edit_file for real project files. file_path is a virtual /path.",
  delete:
    "Delete a PRIVATE CONVERSATION SCRATCH file only. This does not delete project files. file_path is a virtual /path.",
  glob: "Find paths in PRIVATE CONVERSATION SCRATCH storage only. This does not search the project workspace. Scratch paths start with /.",
  grep: "Search content in PRIVATE CONVERSATION SCRATCH storage only. This does not search the project workspace. Use real workspace search tools for project code.",
};
const aliases = new Map(
  Object.keys(descriptions).map((name) => [name, `scratch_${name}`]),
);
const canonical = new Map([...aliases].map(([name, alias]) => [alias, name]));
const guidance = `Scratch storage and the project workspace are separate:
- scratch_* tools access private conversation notes and offloaded results using virtual /paths. They cannot read or modify the user's project.
- workspace_* tools access the user's real project using workspace-relative paths. Use these for source code and deliverables; follow their own parameter schemas.
- Older automatically generated scratch recovery notices may say read_file, write_file, edit_file, ls, glob, grep or delete. Those internal scratch names are exposed to you with the scratch_ prefix. For example, recover an offloaded result with scratch_read_file(file_path, offset, limit). Do not copy scratch parameters into workspace tools.`;

function messageNames(
  message: BaseMessage,
  names: ReadonlyMap<string, string>,
): BaseMessage {
  if (AIMessage.isInstance(message)) {
    const toolCalls = (message.tool_calls ?? []).map((call) => ({
      ...call,
      name: names.get(call.name) ?? call.name,
    }));
    const invalidCalls = (message.invalid_tool_calls ?? []).map((call) => ({
      ...call,
      name: call.name ? (names.get(call.name) ?? call.name) : call.name,
    }));
    // Preserve the provider's parallel representation when present. Only the
    // typed function-name field changes; arguments and arbitrary text do not.
    const rawCalls = message.additional_kwargs.tool_calls;
    const additional = Array.isArray(rawCalls)
      ? {
          ...message.additional_kwargs,
          tool_calls: rawCalls.map((call) => ({
            ...call,
            function: {
              ...call.function,
              name: names.get(call.function.name) ?? call.function.name,
            },
          })),
        }
      : message.additional_kwargs;
    return new AIMessage({
      ...message,
      tool_calls: toolCalls,
      invalid_tool_calls: invalidCalls,
      additional_kwargs: additional,
    });
  }
  if (
    ToolMessage.isInstance(message) &&
    message.name &&
    names.has(message.name)
  )
    return new ToolMessage({ ...message, name: names.get(message.name) });
  return message;
}

/**
 * Place last in wrapModelCall order. Rename only the model-facing boundary;
 * Deep Agents keeps canonical names for dispatch, checkpoints, eviction and
 * summarization. Never rewrite tool output, source content or user messages.
 */
export function scratchNamespace() {
  return createMiddleware({
    name: "ApsisScratchNamespace",
    wrapModelCall: async (request, handler) => {
      const response = await handler({
        ...request,
        tools: request.tools.map((entry) =>
          typeof entry.name === "string" && aliases.has(entry.name)
            ? Object.assign(
                Object.create(Object.getPrototypeOf(entry)),
                entry,
                {
                  name: aliases.get(entry.name),
                  description:
                    descriptions[entry.name as keyof typeof descriptions],
                },
              )
            : entry,
        ),
        messages: request.messages.map((message) =>
          messageNames(message, aliases),
        ),
        systemMessage: request.systemMessage.concat(guidance),
      });
      return messageNames(response, canonical) as AIMessage;
    },
  });
}
