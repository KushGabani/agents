import { createMcpHandler } from "agents/mcp";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { openApiMcpServer } from "@cloudflare/codemode/mcp";

const CLOUDFLARE_SPEC_URL =
  "https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json";

let specCache: Record<string, unknown> | null = null;

async function getSpec(): Promise<Record<string, unknown>> {
  if (specCache) return specCache;
  const res = await fetch(CLOUDFLARE_SPEC_URL);
  if (!res.ok) throw new Error(`Failed to fetch spec: ${res.status}`);
  specCache = (await res.json()) as Record<string, unknown>;
  return specCache;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return new Response(
        JSON.stringify({
          error: "Authorization header with Bearer token required"
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const spec = await getSpec();
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });

    const server = openApiMcpServer({
      apis: {
        cloudflare: {
          spec,
          description:
            "Cloudflare API. Replace path parameters like {account_id} and {zone_id} with real values from a prior search or list call.",
          request: async (opts) => {
            const url = new URL(
              `https://api.cloudflare.com/client/v4${opts.path}`
            );
            if (opts.query) {
              for (const [key, value] of Object.entries(opts.query)) {
                if (value !== undefined) {
                  url.searchParams.set(key, String(value));
                }
              }
            }

            const headers: Record<string, string> = {
              Authorization: `Bearer ${token}`
            };
            if (opts.contentType) {
              headers["Content-Type"] = opts.contentType;
            } else if (opts.body) {
              headers["Content-Type"] = "application/json";
            }

            const res = await fetch(url.toString(), {
              method: opts.method,
              headers,
              body: opts.body
                ? opts.rawBody
                  ? (opts.body as string)
                  : JSON.stringify(opts.body)
                : undefined
            });

            return await res.json();
          }
        }
      },
      executor,
      name: "cloudflare"
    });

    return createMcpHandler(server)(request, env, ctx);
  }
};
