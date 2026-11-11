import { StrategyConfig } from '../types/strategy';

/** Port the main machine's server listens on (server/index.ts). */
export const MAIN_PORT = 8080;

export interface SendResult {
  hash: string;
  bytes: number;
  filename: string;
  /** False when this browser can't hash (not localhost / https), so the check was skipped. */
  verified: boolean;
}

/** "192.168.1.50", "http://192.168.1.50:8080/" … → "http://192.168.1.50:8080" */
export const mainUrl = (host: string) => {
  const h = host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return `http://${h.includes(':') ? h : `${h}:${MAIN_PORT}`}`;
};

/** SHA-256 of a string as hex, or null where crypto.subtle isn't available (plain http on a LAN IP). */
const sha256 = async (text: string): Promise<string | null> => {
  if (!globalThis.crypto?.subtle) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** fetch to the main machine with friendly errors for the usual network problems. */
const callMain = async (host: string, path: string, init: RequestInit = {}, timeoutMs = 4000) => {
  const base = mainUrl(host);
  // An https page may not call an http server (mixed content) — the browser blocks it silently
  if (typeof location !== 'undefined' && location.protocol === 'https:') {
    throw new Error(
      `This page is https, so the browser blocks plain-http calls to ${base}. Open the app at http://localhost:3000 instead.`
    );
  }
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = (err as Error).name === 'TimeoutError';
    throw new Error(
      timedOut
        ? `No answer from ${base} — is the server running (npm run server) and port ${MAIN_PORT} open in its firewall?`
        : `Can't reach ${base} — check the IP in SETUP and that both machines are on the same Wi-Fi`
    );
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
};

/**
 * Sends the strategy to the main machine. The server hashes the exact bytes it received and
 * returns the hash; we compare it with our own so we know it has the identical strategy.
 */
export async function sendToMain(host: string, strategy: StrategyConfig): Promise<SendResult> {
  const body = JSON.stringify(strategy, null, 2);
  const data = await callMain(host, '/api/strategy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const ours = await sha256(body);
  if (ours && ours !== data.hash) {
    throw new Error('Hash mismatch — the main machine received a different file. Send again.');
  }
  return {
    hash: String(data.hash),
    bytes: Number(data.bytes),
    filename: String(data.filename ?? strategy.filename),
    verified: !!ours,
  };
}

/** Is the main machine there? Returns the filename of the strategy it currently has (or null). */
export async function pingMain(host: string): Promise<{ strategy: string | null; running: boolean }> {
  await callMain(host, '/api/ping', {}, 2500);
  const st = await callMain(host, '/api/status', {}, 2500);
  return { strategy: st.strategy?.filename ?? null, running: !!st.running };
}

/** START / STOP on the main machine. `side` = which goal is ours as the camera sees it. */
export const startMatch = (host: string, side: 'left' | 'right' = 'left') =>
  callMain(host, '/api/match/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ side }),
  });
export const stopMatch = (host: string) => callMain(host, '/api/match/stop', { method: 'POST' }, 2000);
