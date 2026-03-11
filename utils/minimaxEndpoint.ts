/**
 * MiniMax API endpoint resolution + native HTTP for Capacitor.
 *
 * Web/dev mode:  Vite proxy `/api/minimax/*` → api.minimaxi.com
 * Capacitor native: CapacitorHttp (bypasses CORS via native networking)
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';

const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const PROXY_MAP: Record<string, string> = {
  '/api/minimax/t2a': 'https://api.minimaxi.com/v1/t2a_v2',
  '/api/minimax/get-voice': 'https://api.minimaxi.com/v1/get_voice',
};

/**
 * Return the actual URL to fetch for a given proxy path.
 */
export function resolveMinimaxUrl(proxyPath: string): string {
  if (isNative() && PROXY_MAP[proxyPath]) {
    return PROXY_MAP[proxyPath];
  }
  return proxyPath;
}

/**
 * A fetch-like wrapper that uses CapacitorHttp on native platforms
 * to bypass CORS restrictions, and regular fetch on web.
 *
 * Returns a Response-like object with .ok, .status, and .json() method.
 */
export async function minimaxFetch(
  proxyPath: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ ok: boolean; status: number; json: () => Promise<any> }> {
  const url = resolveMinimaxUrl(proxyPath);

  if (!isNative()) {
    const res = await fetch(url, init);
    return res;
  }

  // Use CapacitorHttp for native — this goes through native networking, no CORS
  const response = await CapacitorHttp.request({
    url,
    method: init.method || 'POST',
    headers: init.headers || {},
    data: init.body ? JSON.parse(init.body) : undefined,
  });

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.data,
  };
}
