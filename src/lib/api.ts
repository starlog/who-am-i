const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

export function apiUrl(path: string) {
  return basePath + path;
}

export async function apiFetch(path: string, options?: RequestInit) {
  return fetch(apiUrl(path), options);
}
