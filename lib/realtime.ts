type TenantEvent = {
  type: string;
  tenantId: string;
  payload: unknown;
  at: string;
};

type Subscriber = (event: TenantEvent) => void;

const globalRealtime = globalThis as unknown as {
  crmTenantSubscribers?: Map<string, Set<Subscriber>>;
};

const subscribers = globalRealtime.crmTenantSubscribers ?? new Map<string, Set<Subscriber>>();
globalRealtime.crmTenantSubscribers = subscribers;

export function emitTenantEvent(tenantId: string, type: string, payload: unknown) {
  const event: TenantEvent = {
    type,
    tenantId,
    payload,
    at: new Date().toISOString()
  };

  subscribers.get(tenantId)?.forEach((subscriber) => subscriber(event));
}

export function subscribeTenantEvents(tenantId: string, signal?: AbortSignal) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      const send = (event: TenantEvent) => {
        write(`event: ${event.type}\n`);
        write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const subscriber: Subscriber = send;
      const tenantSubscribers = subscribers.get(tenantId) ?? new Set<Subscriber>();
      tenantSubscribers.add(subscriber);
      subscribers.set(tenantId, tenantSubscribers);

      write("event: connected\n");
      write(`data: ${JSON.stringify({ type: "connected", tenantId, at: new Date().toISOString() })}\n\n`);

      const heartbeat = setInterval(() => {
        write("event: heartbeat\n");
        write(`data: ${JSON.stringify({ type: "heartbeat", at: new Date().toISOString() })}\n\n`);
      }, 25000);

      const cleanup = () => {
        clearInterval(heartbeat);
        tenantSubscribers.delete(subscriber);
        if (tenantSubscribers.size === 0) {
          subscribers.delete(tenantId);
        }
        try {
          controller.close();
        } catch {
          // The browser may have already closed the stream.
        }
      };

      signal?.addEventListener("abort", cleanup, { once: true });
    }
  });
}
