import { describe, expect, it } from 'bun:test'
import { StructuredToolCallAdapter } from '../src/agentic/structured-tool-call-adapter'

describe('StructuredToolCallAdapter', () => {
  const adapter = new StructuredToolCallAdapter()

  it('formats tools and parses tagged calls', () => {
    const prompt = adapter.formatToolsPrompt([
      {
        name: 'fetch_weather',
        description: 'Get weather forecast',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ])
    expect(prompt).toContain('<tools>')
    expect(prompt).toContain('fetch_weather')
    expect(prompt).toContain('<tool_call>')

    const parsed = adapter.parseResponse('Let me check.\n<tool_call>{"name":"fetch_weather","arguments":{"city":"Tokyo"}}</tool_call>')
    expect(parsed.hasToolCalls).toBe(true)
    expect(parsed.toolCalls).toEqual([{ name: 'fetch_weather', arguments: { city: 'Tokyo' } }])
    expect(parsed.content).toBe('Let me check.')
  })

  it('repairs trailing commas, supports tagless JSON and rejects array arguments', () => {
    expect(adapter.parseResponse('<tool_call>{"name":"check","arguments":{"id":"1",},}</tool_call>').toolCalls).toEqual([{ name: 'check', arguments: { id: '1' } }])
    expect(adapter.parseResponse('{"name":"check","arguments":{"id":"2"}}').toolCalls).toEqual([{ name: 'check', arguments: { id: '2' } }])
    expect(adapter.parseResponse('{"name":"check","arguments":[1,2]}').hasToolCalls).toBe(false)
  })
})
