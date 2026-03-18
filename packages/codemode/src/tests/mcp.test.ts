import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tool } from "ai";
import { env } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { DynamicWorkerExecutor } from "../executor";
import { codeMcpServer, openApiMcpServer } from "../mcp";

function createGroupedTools() {
  return {
    math: {
      add: tool({
        description: "Add two numbers",
        inputSchema: z.object({
          a: z.number().describe("First number"),
          b: z.number().describe("Second number")
        }),
        execute: async ({ a, b }) => ({
          content: [{ type: "text", text: String(a + b) }]
        })
      })
    },
    greetings: {
      greet: tool({
        description: "Generate a greeting",
        inputSchema: z.object({
          name: z.string().describe("Name to greet")
        }),
        execute: async ({ name }) => ({
          content: [{ type: "text", text: `Hello, ${name}!` }]
        })
      })
    }
  };
}

async function connectClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

function callText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ type: string; text: string }>)[0].text;
}

describe("codeMcpServer", () => {
  it("should expose a single code tool", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const wrapped = codeMcpServer({ tools: createGroupedTools(), executor });
    const client = await connectClient(wrapped);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["code"]);

    await client.close();
  });

  it("code tool description should declare grouped codemode namespaces", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const wrapped = codeMcpServer({ tools: createGroupedTools(), executor });
    const client = await connectClient(wrapped);

    const { tools } = await client.listTools();
    const description = tools[0].description ?? "";

    expect(description).toContain("declare namespace codemode");
    expect(description).toContain("namespace math");
    expect(description).toContain("namespace greetings");
    expect(description).toContain(
      "function add(input: MathAddInput): Promise<MathAddOutput>;"
    );
    expect(description).toContain(
      "function greet(input: GreetingsGreetInput): Promise<GreetingsGreetOutput>;"
    );
    expect(description).toContain(
      "Example: async () => { const r = await codemode.math.add({}); return r; }"
    );

    await client.close();
  });

  it("code tool should call grouped add(10, 32) and return 42", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const wrapped = codeMcpServer({ tools: createGroupedTools(), executor });
    const client = await connectClient(wrapped);

    const result = await client.callTool({
      name: "code",
      arguments: {
        code: `async () => {
          const r = await codemode.math.add({ a: 10, b: 32 });
          return r;
        }`
      }
    });

    expect(JSON.parse(callText(result)).content[0].text).toBe("42");

    await client.close();
  });

  it("code tool should chain across namespaces", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const wrapped = codeMcpServer({ tools: createGroupedTools(), executor });
    const client = await connectClient(wrapped);

    const result = await client.callTool({
      name: "code",
      arguments: {
        code: `async () => {
          const sum = await codemode.math.add({ a: 5, b: 3 });
          const greeting = await codemode.greetings.greet({ name: "Result is " + sum.content[0].text });
          return greeting;
        }`
      }
    });

    expect(JSON.parse(callText(result)).content[0].text).toBe(
      "Hello, Result is 8!"
    );

    await client.close();
  });

  it("code tool should return error on throw", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const wrapped = codeMcpServer({ tools: createGroupedTools(), executor });
    const client = await connectClient(wrapped);

    const result = await client.callTool({
      name: "code",
      arguments: {
        code: "async () => { throw new Error('test error'); }"
      }
    });

    expect(callText(result)).toBe("Error: test error");

    await client.close();
  });

  it("code tool should return namespace/tool not found errors", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const wrapped = codeMcpServer({ tools: createGroupedTools(), executor });
    const client = await connectClient(wrapped);

    const missingNamespace = await client.callTool({
      name: "code",
      arguments: {
        code: "async () => await codemode.missing.tool({})"
      }
    });
    expect(callText(missingNamespace)).toBe(
      'Error: Namespace "missing" not found'
    );

    const missingTool = await client.callTool({
      name: "code",
      arguments: {
        code: "async () => await codemode.math.nonexistent({})"
      }
    });
    expect(callText(missingTool)).toBe(
      'Error: Tool "nonexistent" not found in namespace "math"'
    );

    await client.close();
  });
});

describe("openApiMcpServer", () => {
  const sampleSpec = {
    openapi: "3.0.0",
    info: {
      title: "Users API",
      version: "1.0.0"
    },
    paths: {
      "/users": {
        get: {
          summary: "List users",
          tags: ["users"],
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer" }
            }
          ]
        }
      }
    }
  };

  const billingSpec = {
    openapi: "3.0.0",
    info: {
      title: "Billing API",
      version: "1.0.0"
    },
    paths: {
      "/invoices": {
        get: {
          summary: "List invoices",
          tags: ["billing"]
        }
      }
    }
  };

  it("should expose a single code tool", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const server = openApiMcpServer({
      apis: {
        users: { spec: sampleSpec, request: async () => ({}) },
        billing: { spec: billingSpec, request: async () => ({}) }
      },
      executor
    });
    const client = await connectClient(server);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["code"]);

    await client.close();
  });

  it("code tool description should include shared interfaces and all API namespaces", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const server = openApiMcpServer({
      apis: {
        users: {
          spec: sampleSpec,
          request: async () => ({}),
          description: "Users API"
        },
        billing: {
          spec: billingSpec,
          request: async () => ({})
        }
      },
      executor
    });
    const client = await connectClient(server);

    const { tools } = await client.listTools();
    const description = tools[0].description ?? "";

    expect(description).toContain("interface OpenApiSpec {");
    expect(description).toContain("interface RequestOptions {");
    expect(description).toContain("namespace users");
    expect(description).toContain("namespace billing");
    expect(description).toContain(
      "function spec(input: UsersSpecInput): Promise<UsersSpecOutput>;"
    );
    expect(description).toContain(
      "function request(input: UsersRequestInput): Promise<UsersRequestOutput>;"
    );

    await client.close();
  });

  it("code tool should list spec paths via codemode.users.spec()", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const server = openApiMcpServer({
      apis: {
        users: { spec: sampleSpec, request: async () => ({}) }
      },
      executor
    });
    const client = await connectClient(server);

    const result = await client.callTool({
      name: "code",
      arguments: {
        code: "async () => { const spec = await codemode.users.spec({}); return Object.keys(spec.paths); }"
      }
    });

    expect(JSON.parse(callText(result))).toEqual(["/users"]);

    await client.close();
  });

  it("code tool should proxy codemode.users.request() to host-side function", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const requestSpy = vi.fn(async (opts) => ({
      status: 200,
      method: opts.method,
      path: opts.path,
      data: [{ id: 1, name: "Alice" }]
    }));
    const server = openApiMcpServer({
      apis: {
        users: { spec: sampleSpec, request: requestSpy }
      },
      executor
    });
    const client = await connectClient(server);

    const result = await client.callTool({
      name: "code",
      arguments: {
        code: 'async () => await codemode.users.request({ method: "GET", path: "/users" })'
      }
    });

    expect(JSON.parse(callText(result))).toEqual({
      status: 200,
      method: "GET",
      path: "/users",
      data: [{ id: 1, name: "Alice" }]
    });
    expect(requestSpy).toHaveBeenCalledWith({ method: "GET", path: "/users" });

    await client.close();
  });

  it("code tool should allow mixing spec + request across APIs", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const server = openApiMcpServer({
      apis: {
        users: {
          spec: sampleSpec,
          request: async (opts) => ({ api: "users", path: opts.path })
        },
        billing: {
          spec: billingSpec,
          request: async (opts) => ({ api: "billing", path: opts.path })
        }
      },
      executor
    });
    const client = await connectClient(server);

    const result = await client.callTool({
      name: "code",
      arguments: {
        code: `async () => {
          const userSpec = await codemode.users.spec({});
          const billingSpec = await codemode.billing.spec({});
          return {
            usersPath: Object.keys(userSpec.paths)[0],
            billing: await codemode.billing.request({ method: "GET", path: Object.keys(billingSpec.paths)[0] })
          };
        }`
      }
    });

    expect(JSON.parse(callText(result))).toEqual({
      usersPath: "/users",
      billing: { api: "billing", path: "/invoices" }
    });

    await client.close();
  });

  it("should resolve $refs before injecting specs", async () => {
    const specWithRefs = {
      openapi: "3.0.0",
      info: {
        title: "Items API",
        version: "1.0.0"
      },
      paths: {
        "/items": {
          get: {
            summary: "List items",
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/ItemList" }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          ItemList: {
            type: "array",
            items: { type: "object", properties: { id: { type: "string" } } }
          }
        }
      }
    };

    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const server = openApiMcpServer({
      apis: {
        items: { spec: specWithRefs, request: async () => ({}) }
      },
      executor
    });
    const client = await connectClient(server);

    const result = await client.callTool({
      name: "code",
      arguments: {
        code: "async () => { const spec = await codemode.items.spec({}); return spec.paths['/items'].get.responses['200'].content['application/json'].schema; }"
      }
    });

    expect(JSON.parse(callText(result))).toEqual({
      type: "array",
      items: { type: "object", properties: { id: { type: "string" } } }
    });

    await client.close();
  });
});
