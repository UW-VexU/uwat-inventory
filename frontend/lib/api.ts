export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

export async function api<T>(path: string, { method = 'GET', body }: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiFailure(0, 'offline', "Can't reach the server. Check your connection.");
  }

  const data = (await response.json().catch(() => null)) as
    | (T & { error?: { code: string; message: string } })
    | null;
  if (response.ok) return data as T;

  if (response.status === 401 && !path.startsWith('/api/auth')) window.location.assign('/login');
  throw new ApiFailure(
    response.status,
    data?.error?.code ?? 'server_error',
    data?.error?.message ?? 'Something went wrong on the server.',
  );
}

/** Sends a file as it is, for uploads that aren't JSON. */
export async function putFile<T>(path: string, file: File): Promise<T> {
  const response = await fetch(path, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  const data = (await response.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (response.ok) return data as T;
  throw new ApiFailure(response.status, data?.error?.code ?? 'server_error', data?.error?.message ?? 'Upload failed.');
}

/** crypto.randomUUID needs HTTPS, and this may run on a plain-HTTP team server. */
export function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
