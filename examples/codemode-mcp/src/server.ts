import { createMcpHandler } from "agents/mcp";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { codeMcpServer } from "@cloudflare/codemode/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tool } from "ai";
import { z } from "zod";

function createUpstreamServer() {
  const server = new McpServer({
    name: "demo-tools",
    version: "1.0.0"
  });

  server.registerTool(
    "add",
    {
      description: "Add two numbers together",
      inputSchema: {
        a: z.number().describe("First number"),
        b: z.number().describe("Second number")
      }
    },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }]
    })
  );

  server.registerTool(
    "greet",
    {
      description: "Generate a greeting message",
      inputSchema: {
        name: z.string().describe("Name to greet"),
        language: z
          .enum(["en", "es", "fr"])
          .optional()
          .describe("Language for the greeting")
      }
    },
    async ({ name, language }) => {
      const greetings = {
        en: `Hello, ${name}!`,
        es: `¡Hola, ${name}!`,
        fr: `Bonjour, ${name}!`
      };
      const text = greetings[language ?? "en"];
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "list_items",
    {
      description: "List items with optional filtering",
      inputSchema: {
        category: z.string().optional().describe("Filter by category"),
        limit: z.number().optional().describe("Max items to return")
      }
    },
    async ({ category, limit }) => {
      const items = [
        { id: 1, name: "Widget", category: "hardware" },
        { id: 2, name: "Gadget", category: "hardware" },
        { id: 3, name: "Service A", category: "software" },
        { id: 4, name: "Service B", category: "software" },
        { id: 5, name: "Manual", category: "docs" }
      ];
      let filtered = category
        ? items.filter((item) => item.category === category)
        : items;
      if (limit) filtered = filtered.slice(0, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(filtered) }]
      };
    }
  );

  return server;
}

function createGroupedTools() {
  return {
    demo: {
      add: tool({
        description: "Add two numbers together",
        inputSchema: z.object({
          a: z.number().describe("First number"),
          b: z.number().describe("Second number")
        }),
        execute: async ({ a, b }) => ({
          content: [{ type: "text", text: String(a + b) }]
        })
      }),
      greet: tool({
        description: "Generate a greeting message",
        inputSchema: z.object({
          name: z.string().describe("Name to greet"),
          language: z
            .enum(["en", "es", "fr"])
            .optional()
            .describe("Language for the greeting")
        }),
        execute: async ({ name, language }) => {
          const greetings = {
            en: `Hello, ${name}!`,
            es: `¡Hola, ${name}!`,
            fr: `Bonjour, ${name}!`
          };
          const text = greetings[language ?? "en"];
          return { content: [{ type: "text", text }] };
        }
      }),
      list_items: tool({
        description: "List items with optional filtering",
        inputSchema: z.object({
          category: z.string().optional().describe("Filter by category"),
          limit: z.number().optional().describe("Max items to return")
        }),
        execute: async ({ category, limit }) => {
          const items = [
            { id: 1, name: "Widget", category: "hardware" },
            { id: 2, name: "Gadget", category: "hardware" },
            { id: 3, name: "Service A", category: "software" },
            { id: 4, name: "Service B", category: "software" },
            { id: 5, name: "Manual", category: "docs" }
          ];
          let filtered = category
            ? items.filter((item) => item.category === category)
            : items;
          if (limit) filtered = filtered.slice(0, limit);
          return {
            content: [{ type: "text", text: JSON.stringify(filtered) }]
          };
        }
      })
    }
  };
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      const upstream = createUpstreamServer();
      return createMcpHandler(upstream, { route: "/mcp" })(request, env, ctx);
    }

    if (url.pathname === "/codemode") {
      const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
      const server = codeMcpServer({
        tools: createGroupedTools(),
        executor,
        name: "demo-codemode"
      });
      return createMcpHandler(server, { route: "/codemode" })(
        request,
        env,
        ctx
      );
    }

    return new Response("Not found. Use /mcp or /codemode", { status: 404 });
  }
};
