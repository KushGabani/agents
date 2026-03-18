/**
 * Tests for the AI-free JSON Schema → TypeScript conversion.
 * These functions have zero dependency on ai/zod and work with plain
 * JSON Schema objects — the kind you get from MCP tool definitions
 * or OpenAPI specs.
 *
 * Each test uses toBe with the exact expected output so these tests
 * double as documentation for the output format.
 */
import { describe, it, expect } from "vitest";
import {
  generateTypesFromJsonSchema,
  jsonSchemaToType
} from "../json-schema-types";

// ---------------------------------------------------------------------------
// jsonSchemaToType — single schema → type declaration
// ---------------------------------------------------------------------------

describe("jsonSchemaToType", () => {
  it("converts a simple object with required and optional fields", () => {
    const result = jsonSchemaToType(
      {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" }
        },
        required: ["name"]
      },
      "UserInput"
    );

    expect(result).toBe(
      [
        "type UserInput = {",
        "    name: string;",
        "    age?: number;",
        "}"
      ].join("\n")
    );
  });

  it("converts string enums", () => {
    const result = jsonSchemaToType(
      {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "inactive", "pending"] }
        }
      },
      "StatusInput"
    );

    expect(result).toBe(
      [
        "type StatusInput = {",
        '    status?: "active" | "inactive" | "pending";',
        "}"
      ].join("\n")
    );
  });

  it("converts nested objects", () => {
    const result = jsonSchemaToType(
      {
        type: "object",
        properties: {
          address: {
            type: "object",
            properties: {
              street: { type: "string" },
              zip: { type: "string" }
            },
            required: ["street"]
          }
        }
      },
      "PersonInput"
    );

    expect(result).toBe(
      [
        "type PersonInput = {",
        "    address?: {",
        "        street: string;",
        "        zip?: string;",
        "    };",
        "}"
      ].join("\n")
    );
  });

  it("converts arrays with typed items", () => {
    const result = jsonSchemaToType(
      {
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
          scores: { type: "array", items: { type: "number" } }
        }
      },
      "DataInput"
    );

    expect(result).toBe(
      [
        "type DataInput = {",
        "    tags?: string[];",
        "    scores?: number[];",
        "}"
      ].join("\n")
    );
  });

  it("converts a bare string schema", () => {
    expect(jsonSchemaToType({ type: "string" }, "NameInput")).toBe(
      "type NameInput = string"
    );
  });

  it("converts an empty object schema to Record<string, unknown>", () => {
    expect(jsonSchemaToType({ type: "object" }, "EmptyInput")).toBe(
      "type EmptyInput = Record<string, unknown>"
    );
  });
});

// ---------------------------------------------------------------------------
// generateTypesFromJsonSchema — grouped MCP-style tool descriptors
// ---------------------------------------------------------------------------

describe("generateTypesFromJsonSchema", () => {
  it("generates types for a single grouped tool with descriptions", () => {
    const result = generateTypesFromJsonSchema({
      weather: {
        getWeather: {
          description: "Get weather for a city",
          inputSchema: {
            type: "object",
            properties: {
              city: { type: "string", description: "City name" },
              units: {
                type: "string",
                enum: ["celsius", "fahrenheit"]
              }
            },
            required: ["city"]
          }
        }
      }
    });

    expect(result.weather).toBe(
      [
        "type WeatherGetWeatherInput = {",
        "    /** City name */",
        "    city: string;",
        '    units?: "celsius" | "fahrenheit";',
        "}",
        "type WeatherGetWeatherOutput = unknown",
        "",
        "declare namespace codemode {",
        "    namespace weather {",
        "        /**",
        "         * Get weather for a city",
        "         * @param input.city - City name",
        "         */",
        "        function getWeather(input: WeatherGetWeatherInput): Promise<WeatherGetWeatherOutput>;",
        "    }",
        "}"
      ].join("\n")
    );
  });

  it("generates types for multiple tools with name sanitization", () => {
    const result = generateTypesFromJsonSchema({
      github: {
        search: {
          description: "Search for items",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
              limit: { type: "number" }
            },
            required: ["query"]
          }
        },
        "get-item": {
          description: "Get an item by ID",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string" }
            },
            required: ["id"]
          }
        }
      }
    });

    expect(result.github).toBe(
      [
        "type GithubSearchInput = {",
        "    query: string;",
        "    limit?: number;",
        "}",
        "type GithubSearchOutput = unknown",
        "type GithubGetItemInput = {",
        "    id: string;",
        "}",
        "type GithubGetItemOutput = unknown",
        "",
        "declare namespace codemode {",
        "    namespace github {",
        "        /**",
        "         * Search for items",
        "         */",
        "        function search(input: GithubSearchInput): Promise<GithubSearchOutput>;",
        "        /**",
        "         * Get an item by ID",
        "         */",
        "        function get_item(input: GithubGetItemInput): Promise<GithubGetItemOutput>;",
        "    }",
        "}"
      ].join("\n")
    );
  });

  it("generates typed output schemas when provided", () => {
    const result = generateTypesFromJsonSchema({
      github: {
        getUser: {
          description: "Get a user",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"]
          },
          outputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string" }
            },
            required: ["name", "email"]
          }
        }
      }
    });

    expect(result.github).toBe(
      [
        "type GithubGetUserInput = {",
        "    id: string;",
        "}",
        "type GithubGetUserOutput = {",
        "    name: string;",
        "    email: string;",
        "}",
        "",
        "declare namespace codemode {",
        "    namespace github {",
        "        /**",
        "         * Get a user",
        "         */",
        "        function getUser(input: GithubGetUserInput): Promise<GithubGetUserOutput>;",
        "    }",
        "}"
      ].join("\n")
    );
  });

  it("handles an empty grouped tool set", () => {
    expect(generateTypesFromJsonSchema({})).toEqual({});
  });

  it("generates an empty namespace for an empty group", () => {
    const result = generateTypesFromJsonSchema({ github: {} });

    expect(result.github).toBe(
      [
        "declare namespace codemode {",
        "    namespace github {",
        "    }",
        "}"
      ].join("\n")
    );
  });

  it("sanitizes group names in namespaces and type prefixes", () => {
    const result = generateTypesFromJsonSchema({
      "my-github": {
        "list-issues": {
          description: "List issues in a repository",
          inputSchema: {
            type: "object",
            properties: {
              owner: { type: "string" },
              repo: { type: "string" }
            },
            required: ["owner", "repo"]
          }
        }
      }
    });

    expect(result["my-github"]).toContain("type MyGithubListIssuesInput = {");
    expect(result["my-github"]).toContain("namespace my_github {");
    expect(result["my-github"]).toContain(
      "function list_issues(input: MyGithubListIssuesInput): Promise<MyGithubListIssuesOutput>;"
    );
  });

  it("generates types from MCP-style tool definitions", () => {
    const result = generateTypesFromJsonSchema({
      github: {
        create_issue: {
          description: "Create a GitHub issue",
          inputSchema: {
            type: "object" as const,
            properties: {
              owner: {
                type: "string" as const,
                description: "Repository owner"
              },
              repo: {
                type: "string" as const,
                description: "Repository name"
              },
              title: {
                type: "string" as const,
                description: "Issue title"
              },
              body: {
                type: "string" as const,
                description: "Issue body"
              },
              labels: {
                type: "array" as const,
                items: { type: "string" as const },
                description: "Labels to add"
              }
            },
            required: ["owner", "repo", "title"] as string[]
          }
        },
        list_issues: {
          description: "List issues in a repository",
          inputSchema: {
            type: "object" as const,
            properties: {
              owner: { type: "string" as const },
              repo: { type: "string" as const },
              state: {
                type: "string" as const,
                enum: ["open", "closed", "all"]
              },
              per_page: { type: "number" as const }
            },
            required: ["owner", "repo"] as string[]
          }
        }
      }
    });

    expect(result.github).toBe(
      [
        "type GithubCreateIssueInput = {",
        "    /** Repository owner */",
        "    owner: string;",
        "    /** Repository name */",
        "    repo: string;",
        "    /** Issue title */",
        "    title: string;",
        "    /** Issue body */",
        "    body?: string;",
        "    /** Labels to add */",
        "    labels?: string[];",
        "}",
        "type GithubCreateIssueOutput = unknown",
        "type GithubListIssuesInput = {",
        "    owner: string;",
        "    repo: string;",
        '    state?: "open" | "closed" | "all";',
        "    per_page?: number;",
        "}",
        "type GithubListIssuesOutput = unknown",
        "",
        "declare namespace codemode {",
        "    namespace github {",
        "        /**",
        "         * Create a GitHub issue",
        "         * @param input.owner - Repository owner",
        "         * @param input.repo - Repository name",
        "         * @param input.title - Issue title",
        "         * @param input.body - Issue body",
        "         * @param input.labels - Labels to add",
        "         */",
        "        function create_issue(input: GithubCreateIssueInput): Promise<GithubCreateIssueOutput>;",
        "        /**",
        "         * List issues in a repository",
        "         */",
        "        function list_issues(input: GithubListIssuesInput): Promise<GithubListIssuesOutput>;",
        "    }",
        "}"
      ].join("\n")
    );
  });
});
