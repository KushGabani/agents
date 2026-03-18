import { expect, test } from "@playwright/test";

/**
 * E2E tests for @cloudflare/codemode with a real AI binding.
 *
 * These verify the full pipeline:
 *   user prompt → LLM generates code via createCodeTool → DynamicWorkerExecutor
 *   runs the code in an isolated Worker → tool functions called via RPC → result returned.
 *
 * Uses Workers AI (@cf/zai-org/glm-4.7-flash) — no API key needed.
 */

async function runChat(
  request: import("@playwright/test").APIRequestContext,
  baseURL: string,
  userMessage: string
): Promise<string> {
  const res = await request.post(`${baseURL}/run`, {
    headers: { "Content-Type": "application/json" },
    data: {
      messages: [
        {
          id: `msg-${crypto.randomUUID()}`,
          role: "user",
          parts: [{ type: "text", text: userMessage }]
        }
      ]
    },
    timeout: 45_000
  });
  expect(res.ok()).toBe(true);
  return res.text();
}

test.describe("codemode e2e (Workers AI)", () => {
  test.skip(
    !process.env.CLOUDFLARE_API_TOKEN,
    "Requires CLOUDFLARE_API_TOKEN to run wrangler dev with Workers AI"
  );
  test.setTimeout(45_000);

  test("LLM generates and executes code that calls pm.addNumbers", async ({
    request,
    baseURL
  }) => {
    const response = await runChat(
      request,
      baseURL!,
      "What is 17 + 25? Use the codemode tool with codemode.pm.addNumbers to calculate this."
    );

    expect(response).toContain("42");
  });

  test("LLM generates and executes code that calls pm.getWeather", async ({
    request,
    baseURL
  }) => {
    const response = await runChat(
      request,
      baseURL!,
      "What is the weather in London? Use the codemode tool with codemode.pm.getWeather."
    );

    const lower = response.toLowerCase();
    expect(
      lower.includes("london") ||
        lower.includes("22") ||
        lower.includes("sunny")
    ).toBe(true);
  });

  test("LLM generates and executes code that calls pm.listProjects", async ({
    request,
    baseURL
  }) => {
    const response = await runChat(
      request,
      baseURL!,
      "List all projects using the codemode tool with codemode.pm.listProjects."
    );

    const lower = response.toLowerCase();
    expect(lower.includes("alpha") || lower.includes("beta")).toBe(true);
  });

  test("LLM generates code with multiple namespaced tool calls", async ({
    request,
    baseURL
  }) => {
    const response = await runChat(
      request,
      baseURL!,
      "Using the codemode tool, first get the weather in Paris with codemode.pm.getWeather, then add the numbers 10 and 5 with codemode.pm.addNumbers. Return both results."
    );

    const lower = response.toLowerCase();
    expect(
      lower.includes("paris") ||
        lower.includes("22") ||
        lower.includes("15") ||
        lower.includes("sunny")
    ).toBe(true);
  });

  test("generateTypes returns grouped type definitions", async ({
    request,
    baseURL
  }) => {
    const res = await request.get(`${baseURL}/types`);
    expect(res.ok()).toBe(true);

    const data = await res.json();
    const types = data.types as Record<string, string>;

    expect(types.pm).toContain("declare namespace codemode");
    expect(types.pm).toContain("namespace pm");
    expect(types.pm).toContain("addNumbers");
    expect(types.pm).toContain("getWeather");
    expect(types.pm).toContain("createProject");
    expect(types.pm).toContain("listProjects");
  });
});
