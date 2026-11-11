/*
 * Main machine: runs the received strategy on the REAL robots.
 *
 *   camera / vision process ──UDP JSON──▶ this file ──UDP wheel speeds──▶ 5 × ESP32-S3
 *
 * Every tick (60 Hz) it copies the latest vision frame into an engine world, runs the exact same
 * block-stack logic as the simulator (engine.runStacks + engine.wheelCommand) and sends each robot
 * the left/right wheel speeds it should drive at. No vision, no strategy, or match stopped → 0, 0.
 */
import dgram from 'dgram';
import type { ActiveStrategy } from './index';
import {
  BALL_R,
  ROBOT_HALF,
  SimRobot,
  SimWorld,
  createWorld,
  registerHit,
  runStacks,
  unstick,
  wheelCommand,
  Command,
} from '../src/sim/engine';

/* ---------------- robots ---------------- */

/** Give each ESP32 a fixed IP (DHCP reservation on the router, or a static IP in the firmware). */
const ROBOT_IPS: Record<number, string> = {
  1: '192.168.1.201',
  2: '192.168.1.202',
  3: '192.168.1.203',
  4: '192.168.1.204',
  5: '192.168.1.205',
};
const ROBOT_PORT = 4210;
// Bench test without robots: ROBOT_IP=127.0.0.1 npm run server  → every packet goes to that address
if (process.env.ROBOT_IP) Object.keys(ROBOT_IPS).forEach((k) => (ROBOT_IPS[+k] = process.env.ROBOT_IP!));
const TICK_HZ = 60;

/**
 * Robot packet, 7 bytes, little-endian:
 *   [0]    0xA5 magic
 *   [1]    robot id (1..5)
 *   [2]    sequence number (wraps 0..255) — firmware can drop out-of-order packets
 *   [3..4] int16 left wheel speed, mm/s (+ = forward)
 *   [5..6] int16 right wheel speed, mm/s
 * Firmware: run a speed PID per wheel on the encoders, and STOP if no packet for 200 ms.
 */
let seq = 0;
const udp = dgram.createSocket('udp4');
udp.on('error', (e) => console.error('[ROBOT UDP]', e.message)); // never crash the server on a send error
const sendWheels = (id: number, wl: number, wr: number) => {
  const pkt = Buffer.alloc(7);
  pkt.writeUInt8(0xa5, 0);
  pkt.writeUInt8(id, 1);
  pkt.writeUInt8(seq, 2);
  pkt.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(wl))), 3);
  pkt.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(wr))), 5);
  udp.send(pkt, ROBOT_PORT, ROBOT_IPS[id], () => {});
};

/* ---------------- vision input ---------------- */

/**
 * The vision process (camera + AprilTags, any language) sends one JSON datagram per frame to
 * UDP port VISION_PORT on this machine, in ENGINE coordinates:
 *   { "ball": { "x": mm, "y": mm } | null,
 *     "robots": [ { "id": 1, "x": mm, "y": mm, "angle": deg }, ... ] }   // OUR robots only
 * mm from the centre spot, +x towards the goal we ATTACK when side = 'left', +y DOWN the camera
 * image, angle 0 = facing +x, positive = clockwise in the image. Robots not seen are left out.
 */
export const VISION_PORT = 10006;
const STALE_S = 0.25; // older vision than this → robots stop
const LOST_S = 0.5; // a robot unseen this long is taken out of play (stopped)

interface VisionFrame {
  ball: { x: number; y: number } | null;
  robots: { id: number; x: number; y: number; angle: number }[];
}
let lastFrame: VisionFrame | null = null;
let lastFrameAt = 0; // s (performance.now based)
let visionFps = 0;
const nowS = () => performance.now() / 1000;

const visionSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
visionSock.on('error', (e) => console.error('[VISION UDP]', e.message));
visionSock.on('message', (buf) => {
  try {
    const f = JSON.parse(buf.toString('utf8')) as VisionFrame;
    if (!Array.isArray(f.robots)) return;
    const t = nowS();
    if (lastFrameAt) visionFps = visionFps * 0.9 + (1 / Math.max(1e-3, t - lastFrameAt)) * 0.1;
    lastFrame = f;
    lastFrameAt = t;
  } catch {
    /* ignore junk packets */
  }
});
visionSock.bind(VISION_PORT, '0.0.0.0', () => console.log(`Vision input on UDP :${VISION_PORT}`));

/* ---------------- match state ---------------- */

/** Which goal is OURS this half: 'left' = we attack +x as seen by the camera, 'right' = flipped. */
export type Side = 'left' | 'right';
let running = false;
let side: Side = 'left';
export const isMatchRunning = () => running;

let world: SimWorld = freshWorld();
let worldHash: string | null = null; // strategy the world's block state belongs to

function freshWorld(): SimWorld {
  const w = createWorld();
  w.opponentsEnabled = false; // opponents are real; the engine never drives them here
  w.noReferee = true;
  w.friendly.forEach((r) => (r.benched = true)); // until vision sees them
  return w;
}

export const startMatch = (s: Side) => {
  side = s;
  world = freshWorld(); // block stacks start from the top
  running = true;
};
export const stopMatch = () => {
  running = false;
  stopAll();
};

const stopAll = () => {
  world.friendly.forEach((r) => {
    r.wl = r.wr = 0;
    sendWheels(r.id, 0, 0);
  });
};

/* ---------------- control loop ---------------- */

const seenAt: Record<number, number> = {};
const lastCmd = new Map<number, Command>();
let prevBall = { x: 0, y: 0, vx: 0, vy: 0 };

/** Copy the latest vision frame into the world (pose, plus velocities by differencing). */
const applyVision = (f: VisionFrame, dt: number, t: number) => {
  const k = side === 'right' ? -1 : 1; // flipped half: rotate the field 180°
  const a = 0.5; // velocity smoothing (vision is noisy)
  if (f.ball) {
    const x = f.ball.x * k;
    const y = f.ball.y * k;
    const b = world.ball;
    b.vx = b.vx * (1 - a) + ((x - b.x) / dt) * a;
    b.vy = b.vy * (1 - a) + ((y - b.y) / dt) * a;
    b.x = x;
    b.y = y;
  } else {
    world.ball.vx = world.ball.vy = 0; // ball hidden: assume it's where we last saw it
  }
  f.robots.forEach((v) => {
    const r = world.friendly.find((b) => b.id === v.id);
    if (!r) return;
    const x = v.x * k;
    const y = v.y * k;
    if (r.benched) {
      r.vx = r.vy = 0; // just (re)appeared: no velocity history
    } else {
      r.vx = r.vx * (1 - a) + ((x - r.x) / dt) * a;
      r.vy = r.vy * (1 - a) + ((y - r.y) / dt) * a;
    }
    r.x = x;
    r.y = y;
    r.angle = side === 'right' ? v.angle + 180 : v.angle;
    r.benched = false;
    seenAt[r.id] = t;
  });
  world.friendly.forEach((r) => {
    if (!r.benched && t - (seenAt[r.id] ?? 0) > LOST_S) {
      r.benched = true; // lost by the camera → stop it rather than drive blind
      r.wl = r.wr = 0;
    }
  });
};

/**
 * No kicker and no contact sensor: a hit is seen by the camera. If a robot was striking and the
 * ball is now right by it and suddenly moving fast along the strike line, count that as the hit.
 */
const detectHits = (strategy: any) => {
  const b = world.ball;
  world.friendly.forEach((r) => {
    const kick = lastCmd.get(r.id)?.kick;
    if (!kick || r.benched) return;
    const near = Math.hypot(b.x - r.x, b.y - r.y) < (ROBOT_HALF + BALL_R) * 1.6;
    const along = b.vx * kick.dx + b.vy * kick.dy;
    const before = prevBall.vx * kick.dx + prevBall.vy * kick.dy;
    if (near && along > Math.max(kick.minSpeed ?? 150, 200) && along - before > 150) {
      registerHit(world, strategy, r);
    }
  });
};

export function startController(getActive: () => ActiveStrategy | null, broadcast: (m: unknown) => void) {
  let last = nowS();
  let lastStatus = 0;
  setInterval(() => {
    const t = nowS();
    const dt = Math.min(0.1, Math.max(1e-3, t - last)); // real elapsed time, not the nominal tick
    last = t;
    const act = getActive();

    // A new strategy arrived → restart every robot's block stack
    if (act && act.hash !== worldHash) {
      worldHash = act.hash;
      world = freshWorld();
    }

    const fresh = lastFrame && t - lastFrameAt < STALE_S;
    if (!running || !act || !fresh) {
      stopAll();
    } else {
      world.time += dt;
      const before = new Map(world.friendly.map((r) => [r, [r.x, r.y] as const]));
      applyVision(lastFrame!, dt, t);
      detectHits(act.strategy);
      const cmds = runStacks(world, act.strategy, dt);
      const active = world.friendly.filter((r) => !r.benched);
      unstick(active, before, world.time, dt); // backs a jammed robot off, same as the sim
      world.friendly.forEach((r: SimRobot) => {
        const cmd = cmds.get(r.id);
        if (r.benched || !cmd) {
          r.wl = r.wr = 0;
        } else {
          wheelCommand(r, cmd, dt, world.time); // sets r.wl / r.wr (ramped)
          lastCmd.set(r.id, cmd);
        }
        sendWheels(r.id, r.wl, r.wr);
      });
      prevBall = { ...world.ball };
    }
    seq = (seq + 1) & 0xff;

    // Live status for anyone watching (ws://main:8080/ws), 10 times a second
    if (t - lastStatus > 0.1) {
      lastStatus = t;
      broadcast({ type: 'status', status: getStatus(act) });
    }
  }, 1000 / TICK_HZ);
}

export const getStatus = (act: ActiveStrategy | null = null) => ({
  running,
  side,
  strategy: act ? { filename: act.strategy?.filename, hash: act.hash } : null,
  vision: { fresh: !!lastFrame && nowS() - lastFrameAt < STALE_S, fps: Math.round(visionFps) },
  zone: world.activeSituationId,
  ball: { x: Math.round(world.ball.x), y: Math.round(world.ball.y) },
  robots: world.friendly.map((r) => ({
    id: r.id,
    seen: !r.benched,
    x: Math.round(r.x),
    y: Math.round(r.y),
    angle: Math.round(r.angle),
    wl: Math.round(r.wl),
    wr: Math.round(r.wr),
    status: world.exec[r.id]?.status ?? '',
  })),
  events: world.events.slice(0, 10),
});
