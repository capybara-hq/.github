export type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
export type Handler = Reply | ((init: { body: unknown }) => Reply);

/** A fake `fetch` driven by a table of `METHOD url` -> reply. Unlisted requests throw. */
export function fakeFetch(table: Record<string, Handler>) {
  const calls: { key: string; body: unknown }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body });
    const handler = table[key];
    if (!handler) throw new Error(`unexpected request: ${key}`);
    const reply = typeof handler === "function" ? handler({ body }) : handler;
    const status = reply.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
      status,
      headers: reply.headers,
    });
  }) as typeof fetch;
  return { fetch: impl, calls };
}

