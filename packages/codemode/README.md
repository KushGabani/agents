# `@cloudflare/codemode`

Instead of asking LLMs to call tools directly, Code Mode lets them write executable code that orchestrates multiple operations. LLMs are better at writing code than calling tools — they've seen millions of lines of real-world code but only contrived tool-calling examples.

Code Mode generates TypeScript type definitions from your tools for LLM context, and executes the generated JavaScript in secure, isolated sandboxes with millisecond startup times.

> **Experimental** — may have breaking changes. Use with caution in production.

## Installation

```sh
# Core runtime + utilities only
npm install @cloudflare/codemode

# AI SDK integration
npm install @cloudflare/codemode ai zod

# MCP integration
npm install @cloudflare/codemode @modelcontextprotocol/sdk ai zod
```

The main entry point (`@cloudflare/codemode`) has no direct AI SDK surface. The AI SDK integration lives in `@cloudflare/codemode/ai`. The MCP helpers live in `@cloudflare/codemode/mcp`.

## Quick Start

`createCodeTool` takes **grouped tools** and an executor, and returns a single AI SDK tool that lets the LLM write code instead of making individual tool calls.

```ts
import { createCodeTool } from "@cloudflare/codemode/ai";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { streamText, tool } from "ai";
import { z } from "zod";

const tools = {
  weather: {
    getWeather: tool({
      description: "Get weather for a location",
      inputSchema: z.object({ location: z.string() }),
      execute: async ({ location }) => `Weather in ${location}: 72°F, sunny`
    })
  },
  notifications: {
    sendEmail: tool({
      description: "Send an email",
      inputSchema: z.object({
        to: z.string(),
        subject: z.string(),
        body: z.string()
      }),
      execute: async ({ to }) => `Email sent to ${to}`
    })
  }
};

const executor = new DynamicWorkerExecutor({
  loader: env.LOADER
});

const codemode = createCodeTool({ tools, executor });

const result = streamText({
  model,
  system: "You are a helpful assistant.",
  messages,
  tools: { codemode }
});
```

The LLM sees a typed `codemode` object and writes code like:

```js
async () => {
  const weather = await codemode.weather.getWeather({
    location: "London"
  });
  if (weather.includes("sunny")) {
    await codemode.notifications.sendEmail({
      to: "team@example.com",
      subject: "Nice day!",
      body: `It's ${weather}`
    });
  }
  return { weather, notified: true };
};
```

## Architecture

### How it works

```
┌─────────────┐        ┌────────────────────────────────────────┐
│             │        │  Dynamic Worker (isolated sandbox)     │
│  Host       │  RPC   │                                        │
│  Worker     │◄──────►│  LLM-generated code runs here          │
│             │        │  codemode.group.tool() → dispatcher    │
│  ToolDispatcher      │                                        │
│  holds tool fns      │  fetch() blocked by default            │
└─────────────┘        └────────────────────────────────────────┘
```

1. `createCodeTool` generates grouped TypeScript type definitions from your tools
2. The LLM writes an async arrow function that calls `codemode.<group>.<tool>(args)`
3. Code is normalized via AST parsing (acorn) and sent to the executor
4. `DynamicWorkerExecutor` spins up an isolated Worker via `WorkerLoader`
5. Inside the sandbox, a two-level `Proxy` intercepts namespace + tool calls and routes them back to the host via Workers RPC (`ToolDispatcher extends RpcTarget`)
6. Console output is captured and returned alongside the result

### Network isolation

External `fetch()` and `connect()` are **blocked by default** — enforced at the Workers runtime level via `globalOutbound: null`. Sandboxed code can only interact with the host through `codemode.*` tool calls.

To allow controlled outbound access, pass a `Fetcher`:

```ts
const executor = new DynamicWorkerExecutor({
  loader: env.LOADER,
  globalOutbound: null // default — fully isolated
  // globalOutbound: env.MY_OUTBOUND_SERVICE, // route through a Fetcher
});
```

## The Executor Interface

The `Executor` interface is deliberately minimal — implement it to run code in any sandbox:

```ts
type ToolFns = Record<
  string,
  Record<string, (args: unknown) => Promise<unknown>>
>;

interface Executor {
  execute(code: string, fns: ToolFns): Promise<ExecuteResult>;
}

interface ExecuteResult {
  result: unknown;
  error?: string;
  logs?: string[];
}
```

`DynamicWorkerExecutor` is the Cloudflare Workers implementation, but you can build your own for Node VM, QuickJS, containers, or anything else.

## Configuration

### Wrangler bindings

```jsonc
// wrangler.jsonc
{
  "worker_loaders": [{ "binding": "LOADER" }],
  "compatibility_flags": ["nodejs_compat"]
}
```

### `DynamicWorkerExecutor` options

| Option           | Type              | Default  | Description                                                  |
| ---------------- | ----------------- | -------- | ------------------------------------------------------------ |
| `loader`         | `WorkerLoader`    | required | Worker Loader binding from `env.LOADER`                      |
| `timeout`        | `number`          | `30000`  | Execution timeout in ms                                      |
| `globalOutbound` | `Fetcher \| null` | `null`   | Network access control. `null` = blocked, `Fetcher` = routed |

### `createCodeTool` options

| Option        | Type                      | Default        | Description                                                         |
| ------------- | ------------------------- | -------------- | ------------------------------------------------------------------- |
| `tools`       | `Record<string, ToolSet>` | required       | Grouped tools by namespace                                          |
| `executor`    | `Executor`                | required       | Where to run the generated code                                     |
| `description` | `string`                  | auto-generated | Custom tool description. Use `{{types}}` for injected grouped types |

## Agent Integration

```ts
import { Agent } from "agents";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { convertToModelMessages, stepCountIs, streamText } from "ai";

export class MyAgent extends Agent<Env, State> {
  async onChatMessage() {
    const executor = new DynamicWorkerExecutor({
      loader: this.env.LOADER
    });

    const codemode = createCodeTool({
      tools: {
        github: this.githubTools,
        gmail: this.gmailTools
      },
      executor
    });

    const result = streamText({
      model,
      system: "You are a helpful assistant.",
      messages: await convertToModelMessages(this.state.messages),
      tools: { codemode },
      stopWhen: stepCountIs(10)
    });

    return result.toUIMessageStreamResponse();
  }
}
```

### With MCP tools in your own agent

If you already have MCP tools from `this.mcp.getAITools()`, regroup them by server ID before passing them to `createCodeTool()`.

```ts
const groupedTools = {
  pm: this.localTools,
  [serverId]: {
    [toolName]: mcpAiTool
  }
};

const codemode = createCodeTool({
  tools: groupedTools,
  executor
});
```

## MCP Helpers

### `codeMcpServer({ tools, executor })`

Expose a single MCP `code` tool backed by grouped AI SDK tools.

```ts
import { tool } from "ai";
import { z } from "zod";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { codeMcpServer } from "@cloudflare/codemode/mcp";

const server = codeMcpServer({
  executor: new DynamicWorkerExecutor({ loader: env.LOADER }),
  tools: {
    github: {
      listIssues: tool({
        description: "List issues",
        inputSchema: z.object({ repo: z.string() }),
        execute: async ({ repo }) => ({ repo, issues: [] })
      })
    }
  }
});
```

The model writes code like:

```js
async () => {
  return await codemode.github.listIssues({ repo: "cloudflare/agents" });
};
```

### `openApiMcpServer({ apis, executor })`

Expose a single MCP `code` tool for one or more OpenAPI specs. Each API becomes a namespace with `spec()` and `request(...)`.

```ts
import { openApiMcpServer } from "@cloudflare/codemode/mcp";

const server = openApiMcpServer({
  executor,
  apis: {
    cloudflare: {
      spec,
      description: "Cloudflare API",
      request: async (opts) => {
        const url = new URL(`https://api.cloudflare.com/client/v4${opts.path}`);
        return fetch(url, {
          method: opts.method,
          headers: { Authorization: `Bearer ${token}` }
        }).then((res) => res.json());
      }
    }
  }
});
```

The model writes code like:

```js
async () => {
  const spec = await codemode.cloudflare.spec({});
  const path = Object.keys(spec.paths)[0];
  return await codemode.cloudflare.request({
    method: "GET",
    path
  });
};
```

## Utilities

### `sanitizeToolName(name)`

Converts group and tool names into valid JavaScript identifiers. Handles hyphens, dots, digits, reserved words.

```ts
import { sanitizeToolName } from "@cloudflare/codemode";

sanitizeToolName("my-tool"); // "my_tool"
sanitizeToolName("3d-render"); // "_3d_render"
sanitizeToolName("delete"); // "delete_"
```

### `normalizeCode(code)`

Normalizes LLM-generated code into a valid async arrow function. Strips markdown fences and handles various function formats. Called automatically by `createCodeTool` and `DynamicWorkerExecutor`.

````ts
import { normalizeCode } from "@cloudflare/codemode";

normalizeCode("```js\nconst x = 1;\nx\n```");
// "async () => {\nconst x = 1;\nreturn (x)\n}"
````

### `generateTypesFromJsonSchema(tools)`

Generates grouped TypeScript type definitions from plain JSON Schema descriptors.

```ts
import { generateTypesFromJsonSchema } from "@cloudflare/codemode";

const types = generateTypesFromJsonSchema({
  github: {
    listIssues: {
      description: "List issues",
      inputSchema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Repository name" }
        },
        required: ["repo"]
      }
    }
  }
});

console.log(types.github);
// type GithubListIssuesInput = { ... }
// declare namespace codemode { namespace github { ... } }
```

### `generateTypes(tools)` (AI SDK)

Generates grouped TypeScript type definitions from grouped AI SDK tools or grouped Zod tool descriptors.

```ts
import { generateTypes } from "@cloudflare/codemode/ai";

const types = generateTypes({
  github: myGithubTools,
  gmail: myGmailTools
});

console.log(types.github);
console.log(types.gmail);
```

## Module Structure

| Module                     | Requires                                 | Exports                                                                                                                           |
| -------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `@cloudflare/codemode`     | none                                     | `sanitizeToolName`, `normalizeCode`, `generateTypesFromJsonSchema`, `jsonSchemaToType`, `DynamicWorkerExecutor`, `ToolDispatcher` |
| `@cloudflare/codemode/ai`  | `ai`, `zod`                              | `createCodeTool`, `generateTypes`, `GroupedToolDescriptors`, `ToolDescriptor`, `ToolDescriptors`                                  |
| `@cloudflare/codemode/mcp` | `@modelcontextprotocol/sdk`, `ai`, `zod` | `codeMcpServer`, `openApiMcpServer`                                                                                               |

## Limitations

- Tools with `needsApproval` are **excluded** from codemode descriptions and execution
- Requires a Cloudflare Workers environment for `DynamicWorkerExecutor`
- Executes JavaScript, not TypeScript

## Examples

- [`examples/codemode/`](../../examples/codemode/) — full project-management app using `codemode.pm.*`
- [`examples/codemode-mcp/`](../../examples/codemode-mcp/) — MCP `code` tool backed by grouped AI SDK tools
- [`examples/codemode-mcp-openapi/`](../../examples/codemode-mcp-openapi/) — namespaced OpenAPI MCP server with `spec()` + `request()`

## License

MIT
