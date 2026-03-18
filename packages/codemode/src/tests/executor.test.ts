/**
 * Tests for the Executor interface contract and DynamicWorkerExecutor.
 *
 * Uses vitest-pool-workers — tests run inside a real Workers runtime
 * with a real WorkerLoader binding, no mocks needed.
 */
import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:test";
import {
  DynamicWorkerExecutor,
  ToolDispatcher,
  type ToolFns
} from "../executor";

describe("ToolDispatcher", () => {
  it("should dispatch tool calls and return JSON result", async () => {
    const double = vi.fn(async (args: unknown) => {
      const input = args as Record<string, unknown>;
      return { doubled: (input.n as number) * 2 };
    });
    const fns: ToolFns = { math: { double } };
    const dispatcher = new ToolDispatcher(fns);

    const resJson = await dispatcher.call(
      "math",
      "double",
      JSON.stringify({ n: 5 })
    );
    const data = JSON.parse(resJson);

    expect(data.result).toEqual({ doubled: 10 });
    expect(double).toHaveBeenCalledWith({ n: 5 });
  });

  it("should return error for unknown namespace", async () => {
    const dispatcher = new ToolDispatcher({});

    const resJson = await dispatcher.call("missing", "double", "{}");
    const data = JSON.parse(resJson);

    expect(data.error).toContain("missing");
  });

  it("should return error for unknown tool in existing namespace", async () => {
    const dispatcher = new ToolDispatcher({ math: {} });

    const resJson = await dispatcher.call("math", "nonexistent", "{}");
    const data = JSON.parse(resJson);

    expect(data.error).toContain("nonexistent");
    expect(data.error).toContain("math");
  });

  it("should return error when tool function throws", async () => {
    const fns: ToolFns = {
      utilities: {
        broken: async () => {
          throw new Error("something broke");
        }
      }
    };
    const dispatcher = new ToolDispatcher(fns);

    const resJson = await dispatcher.call("utilities", "broken", "{}");
    const data = JSON.parse(resJson);

    expect(data.error).toBe("something broke");
  });

  it("should handle empty args string", async () => {
    const noArgs = vi.fn(async () => "ok");
    const fns: ToolFns = { utilities: { noArgs } };
    const dispatcher = new ToolDispatcher(fns);

    const resJson = await dispatcher.call("utilities", "noArgs", "");
    const data = JSON.parse(resJson);

    expect(data.result).toBe("ok");
    expect(noArgs).toHaveBeenCalledWith({});
  });
});

describe("DynamicWorkerExecutor", () => {
  it("should execute simple code that returns a value", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const result = await executor.execute("async () => 42", {});
    expect(result.result).toBe(42);
    expect(result.error).toBeUndefined();
  });

  it("should call tool functions via namespaced codemode proxy", async () => {
    const add = vi.fn(async (args: unknown) => {
      const input = args as Record<string, unknown>;
      return (input.a as number) + (input.b as number);
    });
    const fns: ToolFns = { math: { add } };
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const result = await executor.execute(
      "async () => await codemode.math.add({ a: 3, b: 4 })",
      fns
    );

    expect(result.result).toBe(7);
    expect(add).toHaveBeenCalledWith({ a: 3, b: 4 });
  });

  it("should handle multiple sequential tool calls across namespaces", async () => {
    const getWeather = vi.fn(async () => ({ temp: 72 }));
    const searchWeb = vi.fn(async (args: unknown) => {
      const input = args as Record<string, unknown>;
      return { results: [`news about ${input.query as string}`] };
    });
    const fns: ToolFns = {
      weather: { getWeather },
      search: { searchWeb }
    };
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const code = `async () => {
      const weather = await codemode.weather.getWeather({});
      const news = await codemode.search.searchWeb({ query: "temp " + weather.temp });
      return { weather, news };
    }`;

    const result = await executor.execute(code, fns);
    expect(result.result).toEqual({
      weather: { temp: 72 },
      news: { results: ["news about temp 72"] }
    });
    expect(getWeather).toHaveBeenCalledTimes(1);
    expect(searchWeb).toHaveBeenCalledTimes(1);
  });

  it("should return error when code throws", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const result = await executor.execute(
      'async () => { throw new Error("boom"); }',
      {}
    );
    expect(result.error).toBe("boom");
  });

  it("should return error when tool function throws", async () => {
    const fail = vi.fn(async () => {
      throw new Error("tool error");
    });
    const fns: ToolFns = { utilities: { fail } };
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const result = await executor.execute(
      "async () => await codemode.utilities.fail({})",
      fns
    );
    expect(result.error).toBe("tool error");
  });

  it("should handle concurrent tool calls via Promise.all", async () => {
    const fns: ToolFns = {
      utilities: {
        slow: async (args: unknown) => {
          const input = args as Record<string, unknown>;
          return { id: input.id as number };
        }
      }
    };
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const code = `async () => {
      const [a, b, c] = await Promise.all([
        codemode.utilities.slow({ id: 1 }),
        codemode.utilities.slow({ id: 2 }),
        codemode.utilities.slow({ id: 3 })
      ]);
      return [a, b, c];
    }`;

    const result = await executor.execute(code, fns);
    expect(result.result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("should capture console.log output", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const result = await executor.execute(
      'async () => { console.log("hello"); console.warn("careful"); return "done"; }',
      {}
    );

    expect(result.result).toBe("done");
    expect(result.logs).toContain("hello");
    expect(result.logs).toContain("[warn] careful");
  });

  it("should handle code containing backticks and template literals", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const result = await executor.execute(
      'async () => { return `hello ${"world"}`; }',
      {}
    );

    expect(result.result).toBe("hello world");
  });

  it("should block external fetch by default (globalOutbound: null)", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const result = await executor.execute(
      'async () => { const r = await fetch("https://example.com"); return r.status; }',
      {}
    );

    expect(result.error).toBeDefined();
  });

  it("should preserve closures in tool functions", async () => {
    const secret = "api-key-123";
    const fns: ToolFns = {
      auth: {
        getSecret: async () => ({ key: secret })
      }
    };
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const result = await executor.execute(
      "async () => await codemode.auth.getSecret({})",
      fns
    );
    expect(result.result).toEqual({ key: "api-key-123" });
  });

  it("should make custom modules importable in sandbox code", async () => {
    const executor = new DynamicWorkerExecutor({
      loader: env.LOADER,
      modules: {
        "helpers.js": 'export function greet(name) { return "hello " + name; }'
      }
    });

    const code = `async () => {
      const { greet } = await import("helpers.js");
      return greet("world");
    }`;

    const result = await executor.execute(code, {});
    expect(result.result).toBe("hello world");
    expect(result.error).toBeUndefined();
  });

  it("should not allow custom modules to override executor.js", async () => {
    const executor = new DynamicWorkerExecutor({
      loader: env.LOADER,
      modules: {
        "executor.js": "export default class Evil {}"
      }
    });

    const result = await executor.execute("async () => 1 + 1", {});
    expect(result.result).toBe(2);
    expect(result.error).toBeUndefined();
  });

  it("should normalize code automatically (strip fences, wrap expressions)", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const result = await executor.execute("```js\n1 + 1\n```", {});
    expect(result.result).toBe(2);
    expect(result.error).toBeUndefined();
  });

  it("should normalize bare expressions into async arrow functions", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const result = await executor.execute("42", {});
    expect(result.result).toBe(42);
    expect(result.error).toBeUndefined();
  });

  it("should sanitize group and tool names", async () => {
    const listIssues = vi.fn(async () => [{ id: 1, title: "bug" }]);
    const fns: ToolFns = {
      "my-github": {
        "list-issues": listIssues
      }
    };
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const result = await executor.execute(
      "async () => await codemode.my_github.list_issues({})",
      fns
    );

    expect(result.result).toEqual([{ id: 1, title: "bug" }]);
    expect(listIssues).toHaveBeenCalledWith({});
  });

  it("should return namespace errors from the sandbox", async () => {
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const result = await executor.execute(
      "async () => await codemode.missing.tool({})",
      {}
    );

    expect(result.error).toContain('Namespace "missing" not found');
  });

  it("should include timeout in execution", async () => {
    const executor = new DynamicWorkerExecutor({
      loader: env.LOADER,
      timeout: 100
    });

    const result = await executor.execute(
      "async () => { await new Promise(r => setTimeout(r, 5000)); return 'done'; }",
      {}
    );

    expect(result.error).toContain("timed out");
  });
});
