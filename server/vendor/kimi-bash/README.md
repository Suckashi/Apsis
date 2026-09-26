# Kimi Bash parser and dangerous-command policy

Vendored from https://github.com/MoonshotAI/kimi-code at commit
`be7d5f5fea7800778e4660cd5f36780ba783bddd` (MIT; see LICENSE).

The seven parser modules come from `packages/tree-sitter-bash/src/`.
This is the upstream pure TypeScript recursive-descent parser, not a native
Tree-sitter runtime. Imports were rewritten and constructor parameter properties
expanded into equivalent field assignments for Node's TypeScript loader.

`dangerous.ts` comes from
`packages/agent-core-v2/src/agent/permissionPolicy/policies/dangerous-command-ask.ts`.
The service/DI adapter was replaced with a pure exported function; the detection
logic, parser budgets, recursion limit and temporary-path exceptions are unchanged.
The original policy and policy tests are retained as reference text. Apsis tests
exercise the upstream cases without executing the dangerous commands.
