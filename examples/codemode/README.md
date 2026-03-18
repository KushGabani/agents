# Codemode Example

A project management chat app where the LLM writes and executes code to orchestrate tools, instead of calling them one at a time. Built with `@cloudflare/codemode` and `@cloudflare/ai-chat`.

## What it demonstrates

**Server (`src/server.ts`):**

- `AIChatAgent` with `createCodeTool` — the LLM gets a single "write code" tool
- `DynamicWorkerExecutor` — runs LLM-generated code in isolated Worker sandboxes
- `NodeServerExecutor` — alternative executor using a Node.js VM for local dev
- SQLite-backed project management tools grouped under the `pm` namespace
- MCP tools regrouped by server id, so model code calls `codemode.<serverId>.<tool>(...)`

**Client (`src/client.tsx`):**

- `useAgentChat` for streaming chat with message persistence
- Collapsible tool cards showing generated code, results, and console output
- Settings panel to switch between Dynamic Worker and Node Server executors
- MCP server management UI

**Tools (`src/tools.ts`):**

- 10 project management tools exposed as `codemode.pm.*`
- All backed by SQLite — data persists across conversations

## Running

```bash
npm install   # from repo root
npm run build # from repo root
npm start     # from this directory -- starts Vite dev server + Node executor helper
```

Uses Workers AI (no API key needed) with `@cf/zai-org/glm-4.7-flash`.

To run only the Node executor helper:

```bash
npm run start:node-executor
```

## Try it

- "Create a project called Alpha" — model writes code that calls `codemode.pm.createProject()`
- "Add 3 tasks to Alpha" — model chains multiple `codemode.pm.*` calls in one code block
- "List all projects and their tasks" — model composes results from multiple namespaced tools
- Connect an MCP server in Settings, then ask the model to use `codemode.<serverId>.<tool>()`
- Switch between Dynamic Worker and Node Server executors to compare runtime behavior
