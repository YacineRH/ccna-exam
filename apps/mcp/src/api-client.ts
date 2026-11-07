/**
 * Client HTTP de l'API ExamForge. Le serveur MCP n'écrit jamais en base :
 * tout passe par l'API et donc par ses règles de validation.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
}

export function createApiClient(baseUrl: string, serviceToken: string, fetchImpl: typeof fetch = fetch): ApiClient {
  const root = baseUrl.replace(/\/+$/, '');
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${root}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${serviceToken}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `HTTP ${res.status}`, err?.details);
    }
    return data as T;
  }
  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
  };
}
