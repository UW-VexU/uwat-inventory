export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Anything else the server said, like which bag a repeat scan matched. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Identifies one change sent to the server, so a retry after a dropped connection isn't applied twice. */
export const newRequestId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

let server = '';
let token: string | null = null;

export function connect(nextServer: string, nextToken: string | null) {
  server = nextServer.replace(/\/$/, '');
  token = nextToken;
}

/** A server on another network never answers, and iOS would otherwise wait about a minute. */
const TIMEOUT_MS = 10_000;

async function send(path: string, method: string, body?: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${server}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiFailure(0, `Can't reach ${server}. Check the phone and server are on the same network.`);
  } finally {
    clearTimeout(timer);
  }
}

export async function api<T>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await send(path, method, body);
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: { message: string } & Record<string, unknown> })
    | null;
  if (response.ok) return data as T;
  throw new ApiFailure(response.status, data?.error?.message ?? 'Something went wrong on the server.', data?.error ?? {});
}

export async function apiText(path: string): Promise<string> {
  const response = await send(path, 'GET');
  if (!response.ok) throw new ApiFailure(response.status, "Couldn't load the board drawing.");
  return response.text();
}
