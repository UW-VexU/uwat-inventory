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
/**
 * Tailscale on a phone goes to sleep when idle, and the dev API restarts whenever its code
 * changes. Either can drop the first request, so it gets one more go after this long. Changes
 * carry a requestId or set a value outright, so a retry applies once. Deleting is the exception:
 * a second try after one that landed would report the thing as already gone, so it isn't retried.
 */
const RETRY_AFTER_MS = 1500;
/** What a proxy in front of the API answers while the API itself is restarting. */
const RESTARTING = new Set([502, 503, 504]);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function attempt(path: string, method: string, body: unknown, controller: AbortController): Promise<Response> {
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
  } finally {
    clearTimeout(timer);
  }
}

async function send(path: string, method: string, body?: unknown): Promise<Response> {
  const retries = method === 'DELETE' ? 0 : 1;
  for (let tries = 1; ; tries += 1) {
    const controller = new AbortController();
    try {
      const response = await attempt(path, method, body, controller);
      if (tries <= retries && RESTARTING.has(response.status)) {
        await wait(RETRY_AFTER_MS);
        continue;
      }
      return response;
    } catch {
      // A request that ran out of time has already waited long enough. A quick failure gets another go.
      if (tries <= retries && !controller.signal.aborted) {
        await wait(RETRY_AFTER_MS);
        continue;
      }
      throw new ApiFailure(0, `Can't reach ${server}. Check Tailscale is on, and that the server's computer is awake.`);
    }
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
