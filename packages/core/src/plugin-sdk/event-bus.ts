/**
 * Listener called synchronously during publish; returned Promises are not awaited by DomainEventBus.
 * @see {@link createDomainEventBus}
 * @typeParam T - Payload shape agreed by publisher/listener; defaults to any without runtime validation.
 * @param payload - Original published payload reference; each listener receives the same object.
 * @returns No value, or a Promise completing listener work. DomainEventBus does not await/catch returned Promises.
 * @example
 * ```typescript
 * import type { EventHandler } from "@alneas/eaos-core/plugin-sdk/event-bus";
 * const listener: EventHandler<{ id: string }> = payload => { console.log(payload.id); };
 * listener({ id: "note-1" });
 * ```
 */
export type EventHandler<T = any> = (payload: T) => Promise<void> | void

/**
 * Maintain in-memory subscriptions and dispatch payloads synchronously.
 * @remarks No persistence, buffering, retries or tenant filtering is supplied. Use one bus per host/request scope; listeners receive the original payload reference.
 *
 * @example
 * ```typescript
 * import { DomainEventBus } from "@alneas/eaos-core/plugin-sdk/event-bus";
 * const bus = new DomainEventBus();
 * const handler = (payload: { id: string }) => { console.log(payload.id); };
 * bus.subscribe("note.created", handler);
 * bus.publish("note.created", { id: "note-1" });
 * bus.unsubscribe("note.created", handler);
 * ```
 */
export class DomainEventBus {
  private listeners: Map<string, Set<EventHandler>> = new Map()

  /**
   * Invoke current listeners synchronously in Set iteration order.
   * @typeParam T - Payload type agreed by publisher and listener; no runtime check occurs.
   * @param eventName - Exact subscription key.
   * @param payload - Payload passed by reference to each listener.
   * @returns No value; synchronous dispatch has finished, but listener Promises are not awaited.
   * @throws Synchronous listener errors propagate and stop dispatch to later listeners.
   * @remarks Rejected listener Promises are not handled by the bus; listeners must handle asynchronous failures.
   * @example
   * ```typescript
   * import { DomainEventBus } from "@alneas/eaos-core/plugin-sdk/event-bus";
   * const bus = new DomainEventBus();
   * bus.publish("note.created", { id: "note-1" });
   * ```
   */
  publish<T>(eventName: string, payload: T): void {
    const handlers = this.listeners.get(eventName)
    if (handlers) {
      handlers.forEach((handler) => handler(payload))
    }
  }

  /**
   * Add a listener to an event key.
   * @typeParam T - Payload type agreed by publisher and listener; no runtime check occurs.
   * @param eventName - Exact event key.
   * @param handler - Listener invoked during publish with the original payload. Repeated registration of the same function is deduplicated.
   * @returns No value; the listener is registered.
   * @remarks Caller owns unsubscription; payload typing is a caller contract rather than runtime validation.
   * @example
   * ```typescript
   * import { DomainEventBus } from "@alneas/eaos-core/plugin-sdk/event-bus";
   * const bus = new DomainEventBus();
   * const handler = (payload: { id: string }) => { console.log(payload.id); };
   * bus.subscribe("note.created", handler);
   * bus.unsubscribe("note.created", handler);
   * ```
   */
  subscribe<T>(eventName: string, handler: EventHandler<T>): void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set())
    }
    this.listeners.get(eventName)!.add(handler)
  }

  /**
   * Remove a listener by its function identity.
   * @typeParam T - Payload type agreed by publisher and listener; no runtime check occurs.
   * @param eventName - Subscription key.
   * @param handler - The same function reference passed to subscribe.
   * @returns No value; absent subscriptions are ignored.
   * @example
   * ```typescript
   * import { DomainEventBus } from "@alneas/eaos-core/plugin-sdk/event-bus";
   * const bus = new DomainEventBus();
   * const handler = (payload: { id: string }) => { console.log(payload.id); };
   * bus.subscribe("note.created", handler);
   * bus.unsubscribe("note.created", handler);
   * ```
   */
  unsubscribe<T>(eventName: string, handler: EventHandler<T>): void {
    const handlers = this.listeners.get(eventName)
    if (handlers) {
      handlers.delete(handler)
    }
  }
}


/**
 * Create an event bus scoped to one host or request context.
 * @returns A new bus with no listeners.
 * @remarks Subscriptions are not shared with other bus instances; caller owns listener cleanup.
 * @example
 * ```typescript
 * import { createDomainEventBus } from "@alneas/eaos-core/plugin-sdk/event-bus";
 * const bus = createDomainEventBus();
 * bus.publish("demo", { message: "hello" });
 * ```
 */
export function createDomainEventBus(): DomainEventBus {
  return new DomainEventBus()
}
