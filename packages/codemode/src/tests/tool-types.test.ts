/**
 * Tests for generateTypes edge cases (AI SDK dependent).
 * Core schema conversion tests (both JSON Schema and Zod paths) live in
 * schema-conversion.test.ts.
 * sanitizeToolName tests live in utils.test.ts.
 *
 * Each test uses toBe with the exact expected output so these tests
 * double as documentation for the output format.
 */
import { describe, it, expect } from "vitest";
import { generateTypes } from "../tool-types";
import { fromJSONSchema } from "zod";
import { jsonSchema } from "ai";
import type { ToolSet } from "ai";
import type { ToolDescriptors } from "../tool-types";

function genTypes(
  tools: Record<string, unknown>,
  groupName = "github"
): string {
  return generateTypes({
    [groupName]: tools as unknown as ToolSet
  })[groupName];
}

describe("generateTypes edge cases", () => {
  it("should handle empty grouped tool set", () => {
    expect(generateTypes({})).toEqual({});
  });

  it("should handle empty groups", () => {
    expect(generateTypes({ github: {} }).github).toBe(
      [
        "declare namespace codemode {",
        "    namespace github {",
        "    }",
        "}"
      ].join("\n")
    );
  });

  it("should handle MCP tools with input and output schemas (fromJSONSchema)", () => {
    const inputSchema = {
      type: "object" as const,
      properties: {
        city: { type: "string" as const, description: "City name" },
        units: {
          type: "string" as const,
          enum: ["celsius", "fahrenheit"],
          description: "Temperature units"
        },
        includeForecast: { type: "boolean" as const }
      },
      required: ["city"]
    };

    const outputSchema = {
      type: "object" as const,
      properties: {
        temperature: {
          type: "number" as const,
          description: "Current temp"
        },
        humidity: { type: "number" as const },
        conditions: { type: "string" as const },
        forecast: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: {
              day: { type: "string" as const },
              high: { type: "number" as const },
              low: { type: "number" as const }
            }
          }
        }
      },
      required: ["temperature", "conditions"]
    };

    const tools: ToolDescriptors = {
      getWeather: {
        description: "Get weather for a city",
        inputSchema: fromJSONSchema(inputSchema),
        outputSchema: fromJSONSchema(outputSchema)
      }
    };

    const result = generateTypes({ github: tools }).github;

    expect(result).toBe(
      [
        "type GithubGetWeatherInput = {",
        "    /** City name */",
        "    city: string;",
        '    units?: "celsius" | "fahrenheit";',
        "    includeForecast?: boolean;",
        "}",
        "type GithubGetWeatherOutput = {",
        "    /** Current temp */",
        "    temperature: number;",
        "    humidity?: number;",
        "    conditions: string;",
        "    forecast?: {",
        "        day?: string;",
        "        high?: number;",
        "        low?: number;",
        "    }[];",
        "}",
        "",
        "declare namespace codemode {",
        "    namespace github {",
        "        /**",
        "         * Get weather for a city",
        "         * @param input.city - City name",
        "         */",
        "        function getWeather(input: GithubGetWeatherInput): Promise<GithubGetWeatherOutput>;",
        "    }",
        "}"
      ].join("\n")
    );
  });

  it("should handle null inputSchema gracefully", () => {
    const result = genTypes({
      broken: { description: "Broken tool", inputSchema: null }
    });

    expect(result).toBe(
      [
        "type GithubBrokenInput = unknown",
        "type GithubBrokenOutput = unknown",
        "",
        "declare namespace codemode {",
        "    namespace github {",
        "        /**",
        "         * Broken tool",
        "         */",
        "        function broken(input: GithubBrokenInput): Promise<GithubBrokenOutput>;",
        "    }",
        "}"
      ].join("\n")
    );
  });

  it("should handle undefined inputSchema gracefully", () => {
    const result = genTypes({
      broken: { description: "Broken tool", inputSchema: undefined }
    });

    expect(result).toBe(
      [
        "type GithubBrokenInput = unknown",
        "type GithubBrokenOutput = unknown",
        "",
        "declare namespace codemode {",
        "    namespace github {",
        "        /**",
        "         * Broken tool",
        "         */",
        "        function broken(input: GithubBrokenInput): Promise<GithubBrokenOutput>;",
        "    }",
        "}"
      ].join("\n")
    );
  });

  it("should handle string inputSchema gracefully", () => {
    const result = genTypes({
      broken: { description: "Broken tool", inputSchema: "not a schema" }
    });

    expect(result).toBe(
      [
        "type GithubBrokenInput = unknown",
        "type GithubBrokenOutput = unknown",
        "",
        "declare namespace codemode {",
        "    namespace github {",
        "        /**",
        "         * Broken tool",
        "         */",
        "        function broken(input: GithubBrokenInput): Promise<GithubBrokenOutput>;",
        "    }",
        "}"
      ].join("\n")
    );
  });

  it("should isolate errors: one throwing tool does not break others", () => {
    const throwingSchema = {
      get jsonSchema(): never {
        throw new Error("Schema explosion");
      }
    };

    const tools = {
      good1: {
        description: "Good first",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: { a: { type: "string" as const } }
        })
      },
      bad: {
        description: "Bad tool",
        inputSchema: throwingSchema
      },
      good2: {
        description: "Good second",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: { b: { type: "number" as const } }
        })
      }
    };

    const result = genTypes(tools);

    expect(result).toBe(
      [
        "type GithubGood1Input = {",
        "    a?: string;",
        "}",
        "type GithubGood1Output = unknown",
        "type GithubBadInput = unknown",
        "type GithubBadOutput = unknown",
        "type GithubGood2Input = {",
        "    b?: number;",
        "}",
        "type GithubGood2Output = unknown",
        "",
        "declare namespace codemode {",
        "    namespace github {",
        "        /**",
        "         * Good first",
        "         */",
        "        function good1(input: GithubGood1Input): Promise<GithubGood1Output>;",
        "        /**",
        "         * Bad tool",
        "         */",
        "        function bad(input: GithubBadInput): Promise<GithubBadOutput>;",
        "        /**",
        "         * Good second",
        "         */",
        "        function good2(input: GithubGood2Input): Promise<GithubGood2Output>;",
        "    }",
        "}"
      ].join("\n")
    );
  });

  it("should sanitize group names in namespaces and type prefixes", () => {
    const result = genTypes(
      {
        "list-issues": {
          description: "List issues",
          inputSchema: jsonSchema({
            type: "object" as const,
            properties: { repo: { type: "string" as const } }
          })
        }
      },
      "my-github"
    );

    expect(result).toContain("type MyGithubListIssuesInput = {");
    expect(result).toContain("namespace my_github {");
    expect(result).toContain(
      "function list_issues(input: MyGithubListIssuesInput): Promise<MyGithubListIssuesOutput>;"
    );
  });
});
