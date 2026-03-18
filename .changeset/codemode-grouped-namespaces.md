---
"@cloudflare/codemode": major
---

Redesign codemode around grouped namespaces instead of a flat tool surface.

## Breaking changes

- `createCodeTool()` now requires grouped tools: `Record<string, ToolSet>`
- Generated model code now calls `codemode.<namespace>.<tool>(...)`
- `generateTypes()` now returns `Record<string, string>` instead of a single string
- `generateTypesFromJsonSchema()` now returns `Record<string, string>` instead of a single string
- Generated declarations now use merge-safe `declare namespace codemode { namespace <group> { ... } }`
- Type names are now prefixed by group name, e.g. `GithubListIssuesInput`
- `ToolDispatcher.call()` now takes separate `namespace` and `name` arguments
- `Executor.execute()` now receives nested tool functions: `Record<string, Record<string, fn>>`
- `codeMcpServer()` now takes grouped AI SDK tools instead of wrapping a raw MCP server
- `openApiMcpServer()` now takes `apis: Record<string, { spec, request, description? }>` and exposes a single `code` tool with namespaced `spec()` and `request()` helpers

## Improvements

- Per-group type strings are valid standalone `.d.ts` fragments
- Multiple generated groups compose cleanly through namespace merging
- Runtime dispatch now mirrors the generated type structure exactly
- MCP and OpenAPI integrations support explicit namespaces instead of a flat global tool list
