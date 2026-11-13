// One typed API client + a React Query client whose onError routes cross-cutting
// failures by status code (ClassPe pattern). Queries retry; mutations never.
import { QueryClient } from '@tanstack/react-query';

const API_BASE = (import.meta as any).env?.VITE_API_URL || '';
const TOKEN_KEY = 'sa_token';

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function setToken(t: string) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

export class ApiError extends Error {
  status: number;
  url: string;
  code?: string;
  constructor(status: number, url: string, body: any) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.url = url;
    this.code = body?.code;
  }
}

export async function apiRequest<T = any>(method: string, path: string, data?: any): Promise<T> {
  const token = getToken();
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new ApiError(res.status, path, body);
    if (res.status === 401) {
      setToken('');
      // let the AuthContext react on next render
      window.dispatchEvent(new CustomEvent('auth:logout'));
    }
    throw err;
  }
  return body as T;
}

// Query helper: the query key's first element is the API path.
export const apiGet = <T = any>(path: string) => apiRequest<T>('GET', path);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: ({ queryKey }) => apiGet(queryKey[0] as string),
      retry: 2,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 }, // never auto-retry writes
  },
});
