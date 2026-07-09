// Configure at build time via EXPO_PUBLIC_API_BASE_URL. Fall back to the dev
// LAN IP only as a last resort.
//   Physical device: use your Mac's local IP
//   Android emulator: use 10.0.2.2
//   iOS simulator: use localhost
const envBase =
  typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_BASE_URL : undefined;
export const BASE_URL = (envBase ?? 'http://192.168.15.220:8090').replace(/\/+$/, '');

// Shared secret matching config.php's `api_token` on the server. The phone
// reaches the backend over the LAN, so auth-guard.php's loopback allowance
// doesn't cover it — every write must carry this token. Configured at build
// time via EXPO_PUBLIC_API_TOKEN.
export const API_TOKEN =
  (typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_TOKEN : undefined) ?? '';

export async function apiPost<T>(body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (API_TOKEN) headers.Authorization = `Bearer ${API_TOKEN}`;
    const response = await fetch(`${BASE_URL}/save-music.php`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}
