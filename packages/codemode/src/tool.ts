import { asSchema, tool, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import { type Executor, type ToolFns } from "./executor";
import { normalizeCode } from "./normalize";
import {
  generateTypes,
  type GroupedToolDescriptors,
  type ToolDescriptors
} from "./tool-types";
import { sanitizeToolName } from "./utils";

const DEFAULT_DESCRIPTION = `Execute code to achieve a goal.

Available:
{{types}}

Write an async arrow function in JavaScript that returns the result.
Do NOT use TypeScript syntax — no type annotations, interfaces, or generics.
Do NOT define named functions then call them — just write the arrow function body directly.

{{example}}`;

export interface CreateCodeToolOptions {
  tools: GroupedToolDescriptors;
  executor: Executor;
  /**
   * Custom tool description. Use {{types}} as a placeholder for the generated type definitions.
   */
  description?: string;
}

const codeSchema = z.object({
  code: z.string().describe("JavaScript async arrow function to execute")
});

type CodeInput = z.infer<typeof codeSchema>;
type CodeOutput = { code: string; result: unknown; logs?: string[] };

/**
 * Create a codemode tool that allows LLMs to write and execute code
 * with access to your tools in a sandboxed environment.
 *
 * Returns an AI SDK compatible tool.
 */
function hasNeedsApproval(t: Record<string, unknown>): boolean {
  return "needsApproval" in t && t.needsApproval != null;
}

function buildExample(tools: GroupedToolDescriptors): string {
  const [firstGroupEntry] = Object.entries(tools);
  if (!firstGroupEntry) {
    return "Example: async () => null";
  }

  const [groupName, groupTools] = firstGroupEntry;
  const [firstToolEntry] = Object.entries(groupTools);
  if (!firstToolEntry) {
    return "Example: async () => null";
  }

  const [toolName] = firstToolEntry;
  return `Example: async () => { const r = await codemode.${sanitizeToolName(groupName)}.${sanitizeToolName(toolName)}({}); return r; }`;
}

function filterApprovalTools(
  tools: GroupedToolDescriptors
): GroupedToolDescriptors {
  const filtered: GroupedToolDescriptors = {};

  for (const [groupName, groupTools] of Object.entries(tools)) {
    const nextGroup: ToolDescriptors | ToolSet = {};
    for (const [name, toolDef] of Object.entries(groupTools)) {
      if (!hasNeedsApproval(toolDef as Record<string, unknown>)) {
        (nextGroup as Record<string, unknown>)[name] = toolDef;
      }
    }
    filtered[groupName] = nextGroup;
  }

  return filtered;
}

export function createCodeTool(
  options: CreateCodeToolOptions
): Tool<CodeInput, CodeOutput> {
  const tools = filterApprovalTools(options.tools);
  const typesByGroup = generateTypes(tools);
  const combinedTypes = Object.values(typesByGroup).join("\n\n");
  const executor = options.executor;

  const description = (options.description ?? DEFAULT_DESCRIPTION)
    .replace("{{types}}", combinedTypes)
    .replace("{{example}}", buildExample(tools));

  return tool({
    description,
    inputSchema: codeSchema,
    execute: async ({ code }) => {
      const fns: ToolFns = {};

      for (const [groupName, groupTools] of Object.entries(tools)) {
        const sanitizedGroupName = sanitizeToolName(groupName);
        fns[sanitizedGroupName] = {};

        for (const [name, toolDef] of Object.entries(groupTools)) {
          const execute =
            "execute" in toolDef
              ? (toolDef.execute as (args: unknown) => Promise<unknown>)
              : undefined;
          if (!execute) continue;

          const rawSchema =
            "inputSchema" in toolDef
              ? toolDef.inputSchema
              : "parameters" in toolDef
                ? (toolDef as Record<string, unknown>).parameters
                : undefined;

          const schema = rawSchema != null ? asSchema(rawSchema) : undefined;
          const wrappedExecute = schema?.validate
            ? async (args: unknown) => {
                const result = await schema.validate!(args);
                if (!result.success) throw result.error;
                return execute(result.value);
              }
            : execute;

          fns[sanitizedGroupName][sanitizeToolName(name)] = wrappedExecute;
        }
      }

      const normalizedCode = normalizeCode(code);
      const executeResult = await executor.execute(normalizedCode, fns);

      if (executeResult.error) {
        const logCtx = executeResult.logs?.length
          ? `\n\nConsole output:\n${executeResult.logs.join("\n")}`
          : "";
        throw new Error(
          `Code execution failed: ${executeResult.error}${logCtx}`
        );
      }

      const output: CodeOutput = { code, result: executeResult.result };
      if (executeResult.logs) output.logs = executeResult.logs;
      return output;
    }
  });
}
