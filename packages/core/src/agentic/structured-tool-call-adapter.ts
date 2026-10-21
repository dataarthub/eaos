import type { McpToolDefinition } from '../plugin-sdk/types'

/**
 * Model-facing tool name with optional description and parameter schema.
 * @see {@link StructuredToolCallAdapter}
 */
export interface StructuredToolDefinition {
  
  /** Exact registered tool identity; parsing/discovery does not authorize its execution. */
  name: string
  
  /** Human-readable metadata describing the capability, workflow node or requirement to host users. */
  description?: string
  
/** JSON Schema describing tool arguments; the host validates arguments before execution. */
  parameters?: Record<string, unknown>
}

/**
 * Parsed tool name and object arguments prior to host validation/authorization.
 * @see {@link StructuredToolCallAdapter}
 */
export interface StructuredToolCall {
  
  /** Exact registered tool identity; parsing/discovery does not authorize its execution. */
  name: string
  
/** Object-valued parsed tool arguments awaiting schema validation and authorization. */
  arguments: Record<string, unknown>
}

/**
 * Remaining model text and extracted tool calls with a convenience presence flag.
 * @see {@link StructuredToolCallAdapter}
 */
export interface StructuredToolCallResponse {
  
  /** Loaded skill instructions, model response text or proposed file content; treat external text as untrusted input. */
  content: string
  
/** Parsed tool requests in encounter order; parsing does not execute them. */
  toolCalls: StructuredToolCall[]
  
/** Whether at least one syntactically accepted call was extracted. */
  hasToolCalls: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeArguments(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return {}
  return isRecord(value) ? value : null
}

/**
 * Format tool catalogs and extract tool-call objects from model text.
 * @remarks Parsing is not tool authorization or argument-schema validation; use the host execution gate before invoking extracted calls.
 *
 * @example
 * ```typescript
 * import { StructuredToolCallAdapter } from "@alneas/eaos-core/agentic/structured-tool-call-adapter";
 * const adapter = new StructuredToolCallAdapter();
 * console.log(adapter.parseResponse('<tool_call>{"name":"notes.list","arguments":{}}</tool_call>').toolCalls);
 * ```
 */
export class StructuredToolCallAdapter {
  /**
   * Format tool definitions into the tools/tool_call prompt convention.
   * @param tools - Ordered tool definitions; an empty list yields an empty prompt.
   * @returns A prompt containing pretty-printed function metadata and a tool-call format instruction.
   * @throws JSON serialization errors in parameter definitions propagate.
   * @example
   * ```typescript
   * import { StructuredToolCallAdapter } from "@alneas/eaos-core/agentic/structured-tool-call-adapter";
   * const adapter = new StructuredToolCallAdapter();
   * console.log(adapter.formatToolsPrompt([{ name: "notes.list", parameters: { type: "object" } }]));
   * ```
   */
  formatToolsPrompt(tools: Array<McpToolDefinition | StructuredToolDefinition>): string {
    if (!tools || tools.length === 0) return ''

    const formattedTools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))

    return [
      '<tools>',
      JSON.stringify(formattedTools, null, 2),
      '</tools>',
      '',
      'You may call one or more tools to assist the user.',
      'When you need to call a tool, format your output exactly as:',
      '<tool_call>',
      '{"name": "tool_name", "arguments": {"arg1": "val1"}}',
      '</tool_call>',
    ].join('\n')
  }

  /**
   * Extract object-valued calls from tool_call tags or a bare JSON object.
   * @param rawOutput - Model output; tagged JSON may be retried after removing trailing commas. Null/missing arguments normalize to an empty object.
   * @returns Calls plus remaining trimmed text and hasToolCalls; malformed tagged segments are removed from content even when no call is accepted.
   * @remarks Does not validate tool names or schemas, execute calls, or authorize side effects.
   * @example
   * ```typescript
   * import { StructuredToolCallAdapter } from "@alneas/eaos-core/agentic/structured-tool-call-adapter";
   * const adapter = new StructuredToolCallAdapter();
   * console.log(adapter.parseResponse('{"name":"notes.list","arguments":{}}'));
   * ```
   */
  parseResponse(rawOutput: string): StructuredToolCallResponse {
    const toolCalls: StructuredToolCall[] = []
    let content = rawOutput

    const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g
    let match: RegExpExecArray | null

    while ((match = toolCallRegex.exec(rawOutput)) !== null) {
      const toolCallJson = match[1].trim()
      try {
        const parsed = JSON.parse(toolCallJson)
        const argumentsValue = isRecord(parsed) ? normalizeArguments(parsed.arguments) : null
        if (isRecord(parsed) && typeof parsed.name === 'string' && argumentsValue) {
          toolCalls.push({ name: parsed.name, arguments: argumentsValue })
        }
      } catch {
        const repaired = toolCallJson.replace(/,\s*([}\]])/g, '$1')
        try {
          const parsed = JSON.parse(repaired)
          const argumentsValue = isRecord(parsed) ? normalizeArguments(parsed.arguments) : null
          if (isRecord(parsed) && typeof parsed.name === 'string' && argumentsValue) {
            toolCalls.push({ name: parsed.name, arguments: argumentsValue })
          }
        } catch {
          // Invalid model output is ignored and remains ordinary content.
        }
      }
    }

    content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim()

    if (toolCalls.length === 0 && rawOutput.trim().startsWith('{') && rawOutput.trim().endsWith('}')) {
      try {
        const parsed = JSON.parse(rawOutput.trim())
        const argumentsValue = isRecord(parsed) ? normalizeArguments(parsed.arguments ?? parsed.parameters) : null
        if (isRecord(parsed) && typeof parsed.name === 'string' && argumentsValue) {
          toolCalls.push({ name: parsed.name, arguments: argumentsValue })
          content = ''
        }
      } catch {
        // Ordinary text output.
      }
    }

    return { content, toolCalls, hasToolCalls: toolCalls.length > 0 }
  }
}
