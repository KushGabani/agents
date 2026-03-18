import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asSchema, type ToolSet } from "ai";
import type { JSONSchema7 } from "json-schema";
import { z } from "zod";
import type { Executor, ToolFns } from "./executor";
import {
  generateTypesFromJsonSchema,
  type GroupedJsonSchemaToolDescriptors
} from "./json-schema-types";
import { generateTypes } from "./tool-types";
import { sanitizeToolName } from "./utils";

// -- Shared utilities --

const CHARS_PER_TOKEN = 4;
const MAX_TOKENS = 6000;
const MAX_CHARS = MAX_TOKENS * CHARS_PER_TOKEN;

function truncateResponse(content: unknown): string {
  const text =
    typeof content === "string"
      ? content
      : (JSON.stringify(content, null, 2) ?? "undefined");

  if (text.length <= MAX_CHARS) {
    return text;
  }

  const truncated = text.slice(0, MAX_CHARS);
  const estimatedTokens = Math.ceil(text.length / CHARS_PER_TOKEN);

  return `${truncated}\n\n--- TRUNCATED ---\nResponse was ~${estimatedTokens.toLocaleString()} tokens (limit: ${MAX_TOKENS.toLocaleString()}). Use more specific queries to reduce response size.`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildExampleFromGroups(
  groups: Record<string, Record<string, unknown>>
): string {
  for (const [groupName, tools] of Object.entries(groups)) {
    const [firstToolEntry] = Object.entries(tools);
    if (!firstToolEntry) continue;
    const [toolName] = firstToolEntry;
    return `Example: async () => { const r = await codemode.${sanitizeToolName(groupName)}.${sanitizeToolName(toolName)}({}); return r; }`;
  }
  return "Example: async () => null";
}

function executeCodeTool(
  server: McpServer,
  description: string,
  executor: Executor,
  fns: ToolFns
): void {
  server.registerTool(
    "code",
    {
      description,
      inputSchema: {
        code: z.string().describe("JavaScript async arrow function to execute")
      }
    },
    async ({ code }) => {
      try {
        const result = await executor.execute(code, fns);
        if (result.error) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${result.error}` }
            ],
            isError: true
          };
        }
        return {
          content: [
            { type: "text" as const, text: truncateResponse(result.result) }
          ]
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${formatError(error)}` }
          ],
          isError: true
        };
      }
    }
  );
}

// -- codeMcpServer --

const CODE_DESCRIPTION = `Execute code to achieve a goal.

Available:
{{types}}

Write an async arrow function in JavaScript that returns the result.
Do NOT use TypeScript syntax — no type annotations, interfaces, or generics.
Do NOT define named functions then call them — just write the arrow function body directly.

{{example}}`;

export interface CodeMcpServerOptions {
  tools: Record<string, ToolSet>;
  executor: Executor;
  name?: string;
  version?: string;
}

export function codeMcpServer(options: CodeMcpServerOptions): McpServer {
  const { tools, executor, name = "codemode", version = "1.0.0" } = options;
  const typesByGroup = generateTypes(tools);
  const combinedTypes = Object.values(typesByGroup).join("\n\n");
  const description = CODE_DESCRIPTION.replace(
    "{{types}}",
    combinedTypes
  ).replace("{{example}}", buildExampleFromGroups(tools));

  const fns: ToolFns = {};
  for (const [groupName, groupTools] of Object.entries(tools)) {
    const sanitizedGroupName = sanitizeToolName(groupName);
    fns[sanitizedGroupName] = {};

    for (const [toolName, toolDef] of Object.entries(groupTools)) {
      const execute = toolDef.execute;
      if (!execute) continue;

      const rawSchema =
        "inputSchema" in toolDef
          ? toolDef.inputSchema
          : (toolDef as { parameters?: unknown }).parameters;
      const schema =
        rawSchema != null
          ? asSchema(rawSchema as Parameters<typeof asSchema>[0])
          : undefined;
      fns[sanitizedGroupName][sanitizeToolName(toolName)] = schema?.validate
        ? async (args: unknown) => {
            const result = await schema.validate!(args);
            if (!result.success) throw result.error;
            return execute(result.value as never, {} as never);
          }
        : async (args: unknown) => execute(args as never, {} as never);
    }
  }

  const server = new McpServer({ name, version });
  executeCodeTool(server, description, executor, fns);
  return server;
}

// -- openApiMcpServer --

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  contentType?: string;
  rawBody?: boolean;
}

export interface ApiDefinition {
  spec: Record<string, unknown>;
  request: (options: RequestOptions) => Promise<unknown>;
  description?: string;
}

export interface OpenApiMcpServerOptions {
  apis: Record<string, ApiDefinition>;
  executor: Executor;
  name?: string;
  version?: string;
}

/**
 * Resolve internal $ref pointers in a JSON object against the root document.
 * Only handles `#/` internal refs. External file refs are left as-is.
 */
function resolveRefs(
  obj: unknown,
  root: Record<string, unknown>,
  seen = new Set<string>()
): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveRefs(item, root, seen));
  }

  const record = obj as Record<string, unknown>;

  if ("$ref" in record && typeof record.$ref === "string") {
    const ref = record.$ref;
    if (seen.has(ref)) return { $circular: ref };
    if (!ref.startsWith("#/")) return record;
    seen.add(ref);

    const parts = ref
      .slice(2)
      .split("/")
      .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
    let resolved: unknown = root;
    for (const part of parts) {
      resolved = (resolved as Record<string, unknown>)?.[part];
    }
    const result = resolveRefs(resolved, root, seen);
    seen.delete(ref);
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = resolveRefs(value, root, seen);
  }
  return result;
}

const OPENAPI_SHARED_TYPES = `// OpenAPI 3.x spec with $refs resolved inline.
// The spec object follows the standard OpenAPI 3.x structure.

interface OperationObject {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: "query" | "header" | "path" | "cookie";
    required?: boolean;
    schema?: unknown;
    description?: string;
  }>;
  requestBody?: {
    required?: boolean;
    description?: string;
    content?: Record<string, { schema?: unknown }>;
  };
  responses?: Record<string, {
    description?: string;
    content?: Record<string, { schema?: unknown }>;
  }>;
  security?: Array<Record<string, string[]>>;
  deprecated?: boolean;
}

interface PathItem {
  summary?: string;
  description?: string;
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
  head?: OperationObject;
  options?: OperationObject;
  trace?: OperationObject;
  parameters?: OperationObject["parameters"];
}

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, PathItem>;
  servers?: Array<{ url: string; description?: string }>;
  components?: Record<string, unknown>;
  tags?: Array<{ name: string; description?: string }>;
}

interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  contentType?: string;
  rawBody?: boolean;
}`;

function buildOpenApiTypes(apis: GroupedJsonSchemaToolDescriptors): string {
  const typesByGroup = generateTypesFromJsonSchema(apis);
  return `${OPENAPI_SHARED_TYPES}\n\n${Object.values(typesByGroup).join("\n\n")}`;
}

function buildOpenApiDescription(
  apis: GroupedJsonSchemaToolDescriptors,
  apiDescriptions: string[]
): string {
  const firstApi = Object.keys(apis)[0];
  const safeApi = firstApi ? sanitizeToolName(firstApi) : "api";
  const details =
    apiDescriptions.length > 0 ? `\n\n${apiDescriptions.join("\n")}` : "";

  return `Execute API calls using JavaScript code. Inspect specs with codemode.<api>.spec() and make host-side requests with codemode.<api>.request(...).

Available:
${buildOpenApiTypes(apis)}

Write an async arrow function in JavaScript that returns the result.
Do NOT use TypeScript syntax — no type annotations, interfaces, or generics.
Do NOT define named functions then call them — just write the arrow function body directly.

Example: async () => {
  const spec = await codemode.${safeApi}.spec();
  const path = Object.keys(spec.paths)[0];
  return await codemode.${safeApi}.request({ method: "GET", path });
}${details}`;
}

export function openApiMcpServer(options: OpenApiMcpServerOptions): McpServer {
  const { apis, executor, name = "openapi", version = "1.0.0" } = options;
  const server = new McpServer({ name, version });

  const fns: ToolFns = {};
  const apiToolDescriptors: GroupedJsonSchemaToolDescriptors = {};
  const apiDescriptions: string[] = [];

  for (const [apiName, api] of Object.entries(apis)) {
    const resolvedSpec = resolveRefs(api.spec, api.spec) as Record<
      string,
      unknown
    >;
    const sanitizedApiName = sanitizeToolName(apiName);

    fns[sanitizedApiName] = {
      spec: async () => resolvedSpec,
      request: async (args: unknown) => api.request(args as RequestOptions)
    };

    const requestSchema: JSONSchema7 = {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"]
        },
        path: { type: "string" },
        query: {
          type: "object",
          additionalProperties: {
            anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }]
          }
        },
        body: true,
        contentType: { type: "string" },
        rawBody: { type: "boolean" }
      },
      required: ["method", "path"]
    };

    apiToolDescriptors[apiName] = {
      spec: {
        description: api.description
          ? `Get the fully resolved ${api.description} OpenAPI spec`
          : `Get the fully resolved ${apiName} OpenAPI spec`,
        inputSchema: {
          type: "object",
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          additionalProperties: true
        }
      },
      request: {
        description: api.description
          ? `Execute a request against ${api.description}`
          : `Execute a request against ${apiName}`,
        inputSchema: requestSchema,
        outputSchema: {
          type: "object",
          additionalProperties: true
        }
      }
    };

    if (api.description) {
      apiDescriptions.push(`- ${sanitizedApiName}: ${api.description}`);
    }
  }

  const description = buildOpenApiDescription(
    apiToolDescriptors,
    apiDescriptions
  );
  executeCodeTool(server, description, executor, fns);
  return server;
}
