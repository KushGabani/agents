# codemode-mcp-openapi

Demonstrates how to turn one or more OpenAPI specs into a single MCP `code` tool using `openApiMcpServer`.

## What this shows

`openApiMcpServer` takes an `apis` map and creates one `code` tool. Each API becomes a namespace with:

- `codemode.<api>.spec({})` — inspect the fully resolved OpenAPI spec
- `codemode.<api>.request({...})` — execute host-side API requests

Auth tokens and base URLs live in your `request()` function on the host. The sandbox that runs LLM-generated code has no outbound network access and never sees secrets.

This example connects to the live [Cloudflare API](https://api.cloudflare.com/) using the official OpenAPI spec. Pass a Cloudflare API token via the `Authorization` header.

## How to run

```bash
npm install
npm start
```

Then connect an MCP client with your Cloudflare API token:

```
Authorization: Bearer <your-cf-api-token>
```

The Worker reads the spec from GitHub on first request and caches it for the lifetime of the isolate.

## Key pattern

```ts
import { openApiMcpServer } from "@cloudflare/codemode/mcp";

const server = openApiMcpServer({
  executor,
  apis: {
    cloudflare: {
      spec,
      description: "Cloudflare API",
      request: async (opts) => {
        const url = new URL(`https://api.example.com${opts.path}`);
        const res = await fetch(url, {
          method: opts.method,
          headers: { Authorization: `Bearer ${token}` },
          body: opts.body ? JSON.stringify(opts.body) : undefined
        });
        return res.json();
      }
    }
  }
});
```

The model can inspect the spec and execute requests in one code block:

```js
async () => {
  const spec = await codemode.cloudflare.spec({});
  const zonesPath = Object.keys(spec.paths).find((path) => path === "/zones");
  return await codemode.cloudflare.request({ method: "GET", path: zonesPath });
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

- [codemode-mcp](../codemode-mcp/) — MCP `code` tool backed by grouped AI SDK tools
- [`@cloudflare/codemode` docs](../../packages/codemode/README.md)
