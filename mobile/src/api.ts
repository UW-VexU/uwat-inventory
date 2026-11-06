export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let server = '';
let token: string | null = null;

export function connect(nextServer: string, nextToken: string | null) {
  server = nextServer.replace(/\/$/, '');
  token = nextToken;
}

async function send(path: string, method: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`${server}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiFailure(0, `Can't reach ${server}. Check the phone and server are on the same network.`);
  }
}

export async function api<T>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await send(path, method, body);
  const data = (await response.json().catch(() => null)) as (T & { error?: { message: string } }) | null;
  if (response.ok) return data as T;
  throw new ApiFailure(response.status, data?.error?.message ?? 'Something went wrong on the server.');
}

export async function apiText(path: string): Promise<string> {
  const response = await send(path, 'GET');
  if (!response.ok) throw new ApiFailure(response.status, "Couldn't load the board drawing.");
  return response.text();
}
