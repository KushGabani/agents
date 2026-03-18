# codemode-mcp

Demonstrates how to expose a single MCP `code` tool from a grouped AI SDK tool set using `codeMcpServer`.

## What this shows

A normal MCP server with many tools floods the model's context and requires a separate round-trip per tool call. `codeMcpServer` collapses grouped tools into one `code` tool: every grouped tool becomes a typed method on `codemode.<namespace>.*`, and the model can chain calls, branch on results, and do logic — all in a single code execution.

This example exposes two endpoints:

- `/mcp` — the raw demo MCP server with three tools (`add`, `greet`, `list_items`)
- `/codemode` — a codemode MCP server exposing one `code` tool backed by the same logical tool handlers under the `demo` namespace

## How to run

```bash
npm install
npm start
```

Connect an MCP client (e.g. Claude Desktop, MCP Inspector) to `http://localhost:8787/codemode`.

## Key pattern

```ts
import { tool } from "ai";
import { z } from "zod";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { codeMcpServer } from "@cloudflare/codemode/mcp";

const server = codeMcpServer({
  executor: new DynamicWorkerExecutor({ loader: env.LOADER }),
  tools: {
    demo: {
      add: tool({
        description: "Add two numbers together",
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => ({
          content: [{ type: "text", text: String(a + b) }]
        })
      })
    }
  }
});
```

The model writes code like:

```js
async () => {
  const sum = await codemode.demo.add({ a: 5, b: 3 });
  const greeting = await codemode.demo.greet({
    name: "Result is " + sum.content[0].text
  });
  return greeting;
};
```

## Requirements

`wrangler.jsonc` needs a `worker_loaders` binding for the executor:

```jsonc
{
  "worker_loaders": [{ "binding": "LOADER" }]
}
```

## Related

- [codemode-mcp-openapi](../codemode-mcp-openapi/) — same pattern but driven from one or more OpenAPI specs
- [`@cloudflare/codemode` docs](../../packages/codemode/README.md)
