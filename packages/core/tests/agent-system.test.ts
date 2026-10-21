import { describe, it, expect, beforeEach } from 'bun:test'
import { AiCircuitBreaker } from '../src/agent/circuit-breaker'

describe('Durable Session, Sub-Agent Swarm Orchestrator & Circuit Breaker', () => {
  let circuitBreaker: AiCircuitBreaker

  beforeEach(() => {
    circuitBreaker = new AiCircuitBreaker()
  })

  it('should route to fallback LLM provider when primary provider opens circuit breaker', () => {
    expect(circuitBreaker.getHealthyProvider()).toBe('gemini')

    // Simulate 3 failures on primary provider 'gemini'
    circuitBreaker.recordFailure('gemini')
    circuitBreaker.recordFailure('gemini')
    circuitBreaker.recordFailure('gemini')

    // Primary provider is OPEN, circuit breaker switches to next priority 'openai'
    expect(circuitBreaker.getHealthyProvider()).toBe('openai')

    // Recording success on fallback resets its state
    circuitBreaker.recordSuccess('openai')
    expect(circuitBreaker.getHealthyProvider()).toBe('openai')
  })
})
