/*
 * Main machine server. Run from the project root:  npm run server
 *
 *   POST /api/strategy     ← client laptops send a strategy (raw JSON body); replies with its SHA-256
 *   GET  /api/strategy     → the strategy currently loaded
 *   POST /api/match/start  { "side": "left" | "right" }  — robots start running the strategy
 *   POST /api/match/stop   — every robot stops immediately
 *   GET  /api/status       → match / vision / robot status
 *   GET  /api/ping
 *   WS   /ws               → pushes { type: 'strategy' } on every new strategy, { type: 'status' } at 10 Hz
 */
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { startController, isMatchRunning, startMatch, stopMatch, getStatus, VISION_PORT } from './controller';

const PORT = 8080;
const DIR = path.resolve('server/strategies'); // relative to where you run it: the project root
const ACTIVE_FILE = path.join(DIR, '_active.json');
fs.mkdirSync(DIR, { recursive: true });

export interface ActiveStrategy {
  strategy: any; // StrategyConfig
  hash: string; // sha256 of the exact bytes received
  bytes: number;
  from: string; // sender IP
  receivedAt: string;
}

// Survive restarts: reload the last strategy that was received (a broken file is ignored)
let active: ActiveStrategy | null = null;
try {
  if (fs.existsSync(ACTIVE_FILE)) active = JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8'));
} catch (e) {
  console.warn(`[STRATEGY] couldn't read ${ACTIVE_FILE}: ${(e as Error).message}`);
}
export const getActive = () => active;

const server = createServer();
const wss = new WebSocketServer({ server, path: '/ws' });
const broadcast = (msg: unknown) => {
  const text = JSON.stringify(msg);
  wss.clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(text));
};
wss.on('connection', (ws) => {
  if (active) ws.send(JSON.stringify({ type: 'strategy', active }));
});

const app = express();
// Chrome asks before a web page talks to a machine on the local network (Private Network Access);
// this answers "yes" to that check. Must come before cors() so it's on the preflight reply too.
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});
app.use(cors()); // clients run the app from their own laptop (different origin)
// Take the body as raw text so the hash is over the exact bytes the client sent
app.use('/api/strategy', express.text({ type: '*/*', limit: '5mb' }));
app.use('/api/match', express.json());

app.post('/api/strategy', (req, res) => {
  const raw = typeof req.body === 'string' ? req.body : '';
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
    bytes: Buffer.byteLength(raw, 'utf8'),
    from: (req.ip ?? '?').replace(/^::ffff:/, ''),
    receivedAt: new Date().toISOString(),
  };
  // write-then-rename so a crash mid-write can't leave a half-written _active.json
  fs.writeFileSync(ACTIVE_FILE + '.tmp', JSON.stringify(active));
  fs.renameSync(ACTIVE_FILE + '.tmp', ACTIVE_FILE);
  broadcast({ type: 'strategy', active });
  console.log(`[STRATEGY] ${safeName} from ${active.from} (${hash.slice(0, 12)}, ${active.bytes} B)`);
  res.json({ ok: true, hash, bytes: active.bytes, filename: s.filename });
});

app.get('/api/strategy', (_req, res) => (active ? res.json(active) : res.status(404).json({ error: 'none' })));

app.post('/api/match/start', (req, res) => {
  if (!active) return res.status(409).json({ error: 'No strategy loaded — send one first' });
  const side = req.body?.side === 'right' ? 'right' : 'left';
  startMatch(side);
  console.log(`[MATCH] START (our goal: ${side}) running ${active.strategy?.filename}`);
  res.json({ ok: true, status: getStatus(active) });
});

app.post('/api/match/stop', (_req, res) => {
  stopMatch();
  console.log('[MATCH] STOP');
  res.json({ ok: true, status: getStatus(active) });
});

app.get('/api/status', (_req, res) => res.json(getStatus(active)));
app.get('/api/ping', (_req, res) => res.json({ ok: true, name: 'robot-soccer-main' }));

server.on('request', app);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Main machine listening on :${PORT} (vision in on UDP :${VISION_PORT})`);
  if (active) console.log(`[STRATEGY] reloaded ${active.strategy?.filename} (${active.hash.slice(0, 12)})`);
});
startController(getActive, broadcast);
