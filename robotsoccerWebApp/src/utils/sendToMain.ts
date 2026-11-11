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

/** SHA-256 of a string as hex, or null where crypto.subtle isn't available (plain http on a LAN IP). */
const sha256 = async (text: string): Promise<string | null> => {
  if (!globalThis.crypto?.subtle) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Sends the strategy to the main machine. The server hashes the exact bytes it received and
 * returns the hash; we compare it with our own so we know it has the identical strategy.
 */
export async function sendToMain(host: string, strategy: StrategyConfig): Promise<SendResult> {
  const body = JSON.stringify(strategy, null, 2);
  const url = `http://${host.trim()}:${MAIN_PORT}/api/strategy`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(4000),
    });
  } catch (err) {
    const timedOut = (err as Error).name === 'TimeoutError';
    throw new Error(
      timedOut
        ? `No answer from ${host}:${MAIN_PORT} — is the server running and the firewall open?`
        : `Can't reach ${host}:${MAIN_PORT} — check the IP in SETUP and that both are on the same Wi-Fi`
    );
  }

  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);

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