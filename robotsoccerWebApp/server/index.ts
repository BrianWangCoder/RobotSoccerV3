import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { startController, isMatchRunning } from './controller';

const PORT = 8080;
const DIR = path.resolve('server/strategies');
const ACTIVE_FILE = path.join(DIR, '_active.json');
fs.mkdirSync(DIR, { recursive: true });

export interface ActiveStrategy {
  strategy: any;      // StrategyConfig
  hash: string;       // sha256 of the exact bytes received
  bytes: number;
  from: string;       // sender IP
  receivedAt: string;
}

// Survive restarts: reload the last strategy that was received
let active: ActiveStrategy | null = fs.existsSync(ACTIVE_FILE)
  ? JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8'))
  : null;
export const getActive = () => active;

const app = express();
app.use(cors()); // clients run the app from their own laptop (different origin)
// Take the body as raw text so the hash is over the exact bytes the client sent
app.use('/api/strategy', express.text({ type: 'application/json', limit: '5mb' }));

app.post('/api/strategy', (req, res) => {
  const raw = req.body as string;
  let s: any;
  try {
    s = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'Body is not valid JSON' });
  }
  if (!Array.isArray(s?.routines) || !Array.isArray(s?.situations)) {
    return res.status(400).json({ error: 'Not a strategy (missing routines/situations)' });
  }
  if (isMatchRunning()) {
    return res.status(409).json({ error: 'Match is running — press STOP on the main machine first' });
  }

  const hash = createHash('sha256').update(raw, 'utf8').digest('hex');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = String(s.filename ?? 'strategy.json').replace(/[^\w.-]/g, '_');
  fs.writeFileSync(path.join(DIR, `${stamp}_${safeName}`), raw); // history of everything received

  active = {
    strategy: s,
    hash,
    bytes: Buffer.byteLength(raw),
    from: req.ip ?? '?',
    receivedAt: new Date().toISOString(),
  };
  fs.writeFileSync(ACTIVE_FILE, JSON.stringify(active));
  broadcast({ type: 'strategy', active });
  console.log(`[STRATEGY] ${safeName} from ${active.from} (${hash.slice(0, 12)})`);
  res.json({ ok: true, hash, bytes: active.bytes, filename: s.filename });
});

app.get('/api/strategy', (_req, res) => (active ? res.json(active) : res.status(404).json({ error: 'none' })));
app.get('/api/ping', (_req, res) => res.json({ ok: true, name: 'robot-soccer-main' }));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
export const broadcast = (msg: unknown) => {
  const text = JSON.stringify(msg);
  wss.clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(text));
};
wss.on('connection', (ws) => active && ws.send(JSON.stringify({ type: 'strategy', active })));

server.listen(PORT, '0.0.0.0', () => console.log(`Main machine listening on :${PORT}`));
startController(getActive, broadcast);