/*
 * Robot soccer simulation engine — pure TypeScript, no React.
 *
 * Coordinates are millimetres with the origin at the centre spot:
 *   +x → towards the OPPONENT goal (right on screen), +y → down on screen.
 * Our goal is on the left (x = -4500).
 *
 * Each tick the engine:
 *   1. works out which zone (situation) the ball is in — highest priority wins on overlap,
 *   2. runs every friendly robot's block stack for that zone (restarting stacks when the zone
 *      changes),
 *   3. runs a simple opponent AI,
 *   4. integrates robot + ball physics, contacts, kicks and goals.
 */

import { StrategyConfig, ScriptBlock, RobotRoutine } from '../types/strategy';
import { gridDimsFor, quartersOfSituation, quarterAt } from '../utils/zones';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const FIELD = {
  halfX: 4200, // touchline-to-centre along x (field lines)
  halfY: 2800,
  outerX: 4500, // drawing extent incl. run-off
  outerY: 3000,
  goalHalfW: 800,
  goalDepth: 250,
};

/**
 * Physical model — every number here is a real-world quantity, tune them to match your robots.
 *
 * Ball: regulation golf ball (45.9 g, Ø42.7 mm). There is NO kicker — a "kick" is the robot
 * driving through the ball, and the ball's speed comes purely from the collision:
 *     ball speed ≈ (1 + e) · (robot speed along the hit line) · 5/7
 * (5/7 because a struck solid ball loses that share of its energy to start rolling).
 */
export const PHYSICS = {
  robotMass: 0.8, // kg
  robotMaxSpeed: 1500, // mm/s at 100 %
  robotAccel: 2500, // mm/s²
  robotTurnRate: 360, // deg/s

  ballMass: 0.0459, // kg
  ballRadius: 21.35, // mm
  restitution: 0.55, // golf ball vs robot bumper (0 = dead, 1 = perfectly bouncy)
  rollingDecel: 550, // mm/s² — rolling resistance on carpet ≈ 0.056 · g
  linearDrag: 0.25, // 1/s — extra speed-proportional loss (carpet pile, air)
  rollFactor: 5 / 7, // speed kept after sliding → rolling transition (solid sphere)
  wallRestitution: 0.5, // ball bouncing off the field walls
  stopSpeed: 15, // mm/s — below this the ball comes to rest
};

export const ROBOT_R = 90;
export const BALL_R = PHYSICS.ballRadius;

const MAX_SPEED = PHYSICS.robotMaxSpeed;
const MAX_ACCEL = PHYSICS.robotAccel;
const MAX_TURN = PHYSICS.robotTurnRate;
const CONTACT = ROBOT_R + BALL_R;

const OWN_GOAL: [number, number] = [-FIELD.halfX - 300, 0];

/* ------------------------------------------------------------------ */
/* Named spots usable in block parameters, e.g. [Left Flank]           */
/* ------------------------------------------------------------------ */

export const NAMED_SPOTS: Record<string, [number, number]> = {
  center: [0, 0],
  centre: [0, 0],
  midfield: [-1000, 0],
  goal: [-4050, 0],
  'post l': [-4050, -650],
  'post r': [-4050, 650],
  'penalty spot': [-3200, 0],
  'penalty arc': [-2900, 0],
  'left flank': [-2200, -1800],
  'right flank': [-2200, 1800],
  'left corner': [-4000, -2600],
  'right corner': [-4000, 2600],
  'opp goal': [4050, 0],
  'opp post l': [4050, -650],
  'opp post r': [4050, 650],
  'opp penalty spot': [3200, 0],
  'opp penalty arc': [2900, 0],
  'opp left flank': [2200, -1800],
  'opp right flank': [2200, 1800],
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** First number in a string like "80%", "60°/s", "450" — or the fallback. */
export const parseNum = (raw: unknown, fallback: number): number => {
  const m = String(raw ?? '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : fallback;
};

/**
 * A point parameter: either "[x, y]" in CENTIMETRES from the centre spot
 * (+x towards the opponent goal, +y towards the LEFT touchline / top of screen),
 * or a named spot like "[Left Flank]". Returns null if it can't be understood.
 */
export const parsePoint = (raw: unknown): [number, number] | null => {
  const str = String(raw ?? '')
    .toLowerCase()
    .replace(/[\[\]()]/g, '')
    .trim();
  const nums = str.match(/-?\d+(\.\d+)?/g);
  if (nums && nums.length >= 2 && !/[a-z]{2,}/.test(str.replace(/\b(cm|mm)\b/g, ''))) {
    const x = parseFloat(nums[0]) * 10;
    const y = -parseFloat(nums[1]) * 10;
    return [clamp(x, -FIELD.halfX, FIELD.halfX), clamp(y, -FIELD.halfY, FIELD.halfY)];
  }
  const key = str.replace(/\s+/g, ' ');
  return NAMED_SPOTS[key] ?? null;
};

/* ------------------------------------------------------------------ */
/* World model                                                         */
/* ------------------------------------------------------------------ */

export interface SimBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SimRobot {
  id: number;
  label: string;
  team: 'friendly' | 'opponent';
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number; // degrees, 0 = +x
  home: [number, number, number];
}

export interface ExecState {
  routineId: string | null;
  blockIdx: number;
  phase: number;
  t: number; // seconds spent in current block
  turnTarget: number | null;
  status: string;
  target: [number, number] | null;
}

export interface SimWorld {
  time: number;
  ball: SimBall;
  friendly: SimRobot[];
  opponents: SimRobot[];
  exec: Record<number, ExecState>;
  activeSituationId: string | null;
  score: { us: number; them: number };
  events: string[];
  opponentsEnabled: boolean;
  oppKickCooldown: number;
}

interface Command {
  tx: number;
  ty: number;
  speed: number; // 0..1
  face: number | null; // desired heading (deg)
  spin: number; // deg/s (overrides face when non-zero)
  /** A strike is armed: the robot is deliberately driving through the ball along (dx, dy). */
  kick: { dx: number; dy: number; minAlign: number } | null;
}

const FRIENDLY_HOME: [number, number, number][] = [
  [-1200, 0, 0],
  [-2400, -800, 0],
  [-4000, 0, 0],
  [-2000, 900, 0],
  [-3000, -1700, 0],
];
const OPP_HOME: [number, number, number][] = [
  [1200, 400, 180],
  [2200, -700, 180],
  [4000, 0, 180],
  [1800, 900, 180],
];

const freshExec = (): ExecState => ({
  routineId: null,
  blockIdx: 0,
  phase: 0,
  t: 0,
  turnTarget: null,
  status: 'idle',
  target: null,
});

export const createWorld = (): SimWorld => {
  const friendly = FRIENDLY_HOME.map((h, i) => ({
    id: i + 1,
    label: `BOT ${i + 1}`,
    team: 'friendly' as const,
    x: h[0],
    y: h[1],
    vx: 0,
    vy: 0,
    angle: h[2],
    home: h,
  }));
  const opponents = OPP_HOME.map((h, i) => ({
    id: 101 + i,
    label: `B${i + 1}`,
    team: 'opponent' as const,
    x: h[0],
    y: h[1],
    vx: 0,
    vy: 0,
    angle: h[2],
    home: h,
  }));
  const exec: Record<number, ExecState> = {};
  friendly.forEach((r) => (exec[r.id] = freshExec()));
  return {
    time: 0,
    ball: { x: 0, y: 0, vx: 0, vy: 0 },
    friendly,
    opponents,
    exec,
    activeSituationId: null,
    score: { us: 0, them: 0 },
    events: [],
    opponentsEnabled: true,
    oppKickCooldown: 0,
  };
};

/** Robots back to their kick-off spots, block stacks restarted. */
export const resetPositions = (w: SimWorld, ball: [number, number] = [0, 0]) => {
  [...w.friendly, ...w.opponents].forEach((r) => {
    r.x = r.home[0];
    r.y = r.home[1];
    r.angle = r.home[2];
    r.vx = 0;
    r.vy = 0;
  });
  w.ball = { x: ball[0], y: ball[1], vx: 0, vy: 0 };
  Object.keys(w.exec).forEach((k) => (w.exec[+k] = freshExec()));
  w.activeSituationId = null;
};

const log = (w: SimWorld, msg: string) => {
  const t = Math.floor(w.time);
  const stamp = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  w.events = [`${stamp} ${msg}`, ...w.events].slice(0, 40);
};

/* ------------------------------------------------------------------ */
/* Zones                                                               */
/* ------------------------------------------------------------------ */

const PRIORITY_RANK: Record<string, number> = {
  Critical: 3,
  'High Priority': 2,
  'Medium Priority': 1,
  'Low Priority': 0,
};

let quarterCache: { strategy: StrategyConfig | null; map: Map<string, Set<string>> } = {
  strategy: null,
  map: new Map(),
};

const zoneQuarters = (strategy: StrategyConfig) => {
  if (quarterCache.strategy !== strategy) {
    const { cols, rows } = gridDimsFor(strategy.resolution);
    const map = new Map<string, Set<string>>();
    strategy.situations.forEach((s) =>
      map.set(s.id, quartersOfSituation(s as typeof s & { selectedQuarters?: string[] }, cols, rows))
    );
    quarterCache = { strategy, map };
  }
  return quarterCache.map;
};

/** All zones containing a field point, best (highest priority, then list order) first. */
export const zonesAt = (strategy: StrategyConfig, x: number, y: number) => {
  const { cols, rows } = gridDimsFor(strategy.resolution);
  const u = clamp(((x + FIELD.halfX) / (2 * FIELD.halfX)) * cols, 0, cols);
  const v = clamp(((y + FIELD.halfY) / (2 * FIELD.halfY)) * rows, 0, rows);
  const q = quarterAt(u, v, cols, rows);
  if (!q) return [];
  const map = zoneQuarters(strategy);
  return strategy.situations
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => map.get(s.id)?.has(q))
    .sort(
      (a, b) =>
        (PRIORITY_RANK[b.s.priority] ?? 0) - (PRIORITY_RANK[a.s.priority] ?? 0) || a.i - b.i
    )
    .map(({ s }) => s);
};

/* ------------------------------------------------------------------ */
/* Block execution                                                     */
/* ------------------------------------------------------------------ */

const angleDiff = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;
const hyp = Math.hypot;

/** Point where segment AB meets the line from the ball to our goal, or the closest point on AB. */
const shadowOnSegment = (
  a: [number, number],
  b: [number, number],
  ball: SimBall,
  goal: [number, number]
): [number, number] => {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const [x3, y3] = [ball.x, ball.y];
  const [x4, y4] = goal;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) > 1e-6) {
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((x3 - x1) * dx + (y3 - y1) * dy) / len2, 0, 1);
  return [x1 + t * dx, y1 + t * dy];
};

const hold = (bot: SimRobot): Command => ({
  tx: bot.x,
  ty: bot.y,
  speed: 1,
  face: null,
  spin: 0,
  kick: null,
});

/** Expected ball speed (mm/s) when a robot hits a resting ball dead-centre at v mm/s. */
export const strikeBallSpeed = (v: number) => {
  const { robotMass: M, ballMass: m, restitution: e, rollFactor } = PHYSICS;
  return ((1 + e) * M) / (M + m) * v * rollFactor;
};

/**
 * Approach-and-strike towards `aim`. There is no kicker: the robot backs off far enough to reach
 * its strike speed, lines up behind the ball and drives straight THROUGH it. How hard the ball
 * goes depends only on how fast the robot is moving at contact.
 * st.phase: 0 = lining up, 2 = striking (committed), 1 = contact made (block finishes).
 */
const planKick = (
  w: SimWorld,
  bot: SimRobot,
  aim: [number, number],
  strike: number, // 0..1 fraction of max speed at contact
  minAlign: number,
  st: ExecState,
  label: string
): Command => {
  const b = w.ball;
  let dx = aim[0] - b.x;
  let dy = aim[1] - b.y;
  const dl = hyp(dx, dy) || 1;
  dx /= dl;
  dy /= dl;
  const face = (Math.atan2(dy, dx) * 180) / Math.PI;

  const vStrike = MAX_SPEED * strike;
  // distance needed to reach strike speed from rest, plus a little margin
  const runUp = clamp((vStrike * vStrike) / (2 * MAX_ACCEL) + 60, 140, 900);
  const behind: [number, number] = [b.x - dx * (CONTACT + runUp), b.y - dy * (CONTACT + runUp)];

  const toBallX = b.x - bot.x;
  const toBallY = b.y - bot.y;
  const toBallL = hyp(toBallX, toBallY) || 1;
  const align = (toBallX * dx + toBallY * dy) / toBallL;
  const expect = strikeBallSpeed(hyp(bot.vx, bot.vy));

  // Committed strike: keep driving through the ball until contact (or it got away from us)
  if (st.phase === 2) {
    if (toBallL > CONTACT + runUp + 500 || align < minAlign - 0.15) {
      st.phase = 0; // ball moved / we drifted off line → line up again
    } else {
      st.status = `${label}: striking — ${(hyp(bot.vx, bot.vy) / 1000).toFixed(2)} m/s → ball ~${(
        expect / 1000
      ).toFixed(2)} m/s`;
      return {
        tx: b.x + dx * (CONTACT + 1500), // aim well past the ball so we don't brake before contact
        ty: b.y + dy * (CONTACT + 1500),
        speed: strike,
        face,
        spin: 0,
        kick: { dx, dy, minAlign },
      };
    }
  }

  // Wrong side of the ball → go round it
  const ahead = (bot.x - b.x) * dx + (bot.y - b.y) * dy > -CONTACT * 0.5;
  if (ahead && toBallL < CONTACT + runUp + 300) {
    const side = (bot.x - b.x) * -dy + (bot.y - b.y) * dx >= 0 ? 1 : -1;
    st.status = `${label}: circling ball`;
    return {
      tx: behind[0] + -dy * side * 300,
      ty: behind[1] + dx * side * 300,
      speed: 0.7,
      face,
      spin: 0,
      kick: null,
    };
  }

  const settled = hyp(bot.x - behind[0], bot.y - behind[1]) < 70 && hyp(bot.vx, bot.vy) < 250;
  const ballStill = hyp(b.vx, b.vy) < 300;
  const facing = Math.abs(angleDiff(bot.angle, face)) < 15;
  if (settled && align >= minAlign && ballStill && facing) {
    st.phase = 2;
  }
  st.status = `${label}: lining up (align ${align.toFixed(2)})`;
  return { tx: behind[0], ty: behind[1], speed: 0.8, face, spin: 0, kick: null };
};

interface BlockResult {
  cmd: Command;
  done: boolean;
}

const runBlock = (
  w: SimWorld,
  bot: SimRobot,
  block: ScriptBlock,
  st: ExecState,
  isLast: boolean
): BlockResult => {
  const p = block.params as Record<string, string | undefined>;
  const ball = w.ball;
  const distBall = hyp(ball.x - bot.x, ball.y - bot.y);
  const faceBall = (Math.atan2(ball.y - bot.y, ball.x - bot.x) * 180) / Math.PI;

  switch (block.type) {
    case 'move': {
      const start = parsePoint(p.start) ?? [bot.x, bot.y];
      const stop = parsePoint(p.stop) ?? start;
      const speed = clamp(parseNum(p.speed, 80) / 100, 0.05, 1);
      const tgt = st.phase === 0 ? start : stop;
      const d = hyp(tgt[0] - bot.x, tgt[1] - bot.y);
      const heading = d > 30 ? (Math.atan2(tgt[1] - bot.y, tgt[0] - bot.x) * 180) / Math.PI : null;
      st.status = st.phase === 0 ? 'Move: to start' : 'Move: to stop';
      if (d < 60) {
        if (st.phase === 0 && hyp(stop[0] - start[0], stop[1] - start[1]) > 60) st.phase = 1;
        else return { cmd: { ...hold(bot), tx: tgt[0], ty: tgt[1] }, done: true };
      }
      return { cmd: { tx: tgt[0], ty: tgt[1], speed, face: heading, spin: 0, kick: null }, done: false };
    }

    case 'turn': {
      const rate = Math.max(5, Math.abs(parseNum(p.speed, 60)));
      if (st.turnTarget === null) st.turnTarget = bot.angle + parseNum(p.angle, 180);
      const remaining = st.turnTarget - bot.angle;
      st.status = `Turn: ${Math.round(Math.abs(remaining))}° left`;
      if (Math.abs(remaining) < 1.5) return { cmd: hold(bot), done: true };
      return {
        cmd: { ...hold(bot), spin: Math.sign(remaining) * Math.min(rate, Math.abs(remaining) * 20) },
        done: false,
      };
    }

    case 'spin': {
      const rpm = parseNum(p.rpm, 450);
      st.status = `Spin: ${rpm} rpm`;
      return { cmd: { ...hold(bot), spin: rpm * 6 }, done: st.t >= 1.5 };
    }

    case 'defender': {
      const a = parsePoint(p.start) ?? NAMED_SPOTS['left flank'];
      const b = parsePoint(p.stop) ?? NAMED_SPOTS['penalty arc'];
      const [tx, ty] = shadowOnSegment(a, b, ball, OWN_GOAL);
      st.status = 'Defender: shadowing ball';
      const yieldNow = !isLast && distBall < 420 && st.t > 0.3;
      return { cmd: { tx, ty, speed: 1, face: faceBall, spin: 0, kick: null }, done: yieldNow };
    }

    case 'goalkeeper': {
      const a = parsePoint(p.start) ?? NAMED_SPOTS['post l'];
      const b = parsePoint(p.stop) ?? NAMED_SPOTS['post r'];
      const [tx, ty] = shadowOnSegment(a, b, ball, OWN_GOAL);
      st.status = 'GoalKeeper: covering goal';
      const yieldNow = !isLast && distBall < 550 && st.t > 0.3;
      return { cmd: { tx, ty, speed: 1, face: faceBall, spin: 0, kick: null }, done: yieldNow };
    }

    case 'kickA':
    case 'kickB': {
      const minAlign = clamp(parseNum(p.threshold, block.type === 'kickA' ? 0.85 : 0.65), 0, 1);
      const pct = clamp(parseNum(p.speed, block.type === 'kickA' ? 95 : 75) / 100, 0.05, 1);
      if (st.t > 12) {
        st.status = 'Kick: gave up (timeout)';
        return { cmd: hold(bot), done: true };
      }
      if (st.phase === 1) return { cmd: hold(bot), done: true }; // kicked last tick
      let aim: [number, number];
      if (block.type === 'kickA') {
        const keeper = w.opponentsEnabled ? w.opponents.find((o) => o.id === 103) : undefined;
        aim = [FIELD.halfX + 200, keeper ? (keeper.y > 0 ? -480 : 480) : 0];
      } else {
        const mates = w.friendly
          .filter((m) => m.id !== bot.id)
          .map((m) => ({ m, fwd: m.x - ball.x, d: hyp(m.x - ball.x, m.y - ball.y) }))
          .filter((o) => o.d > 500)
          .sort((a, b) => b.fwd - a.fwd || a.d - b.d);
        aim = mates.length ? [mates[0].m.x, mates[0].m.y] : [FIELD.halfX + 200, 0];
      }
      return {
        cmd: planKick(w, bot, aim, pct, minAlign, st, block.type === 'kickA' ? 'KickA' : 'KickB'),
        done: false,
      };
    }

    default:
      st.status = `Unknown block "${String(block.type)}"`;
      return { cmd: hold(bot), done: true };
  }
};

/* ------------------------------------------------------------------ */
/* Opponent AI                                                         */
/* ------------------------------------------------------------------ */

const opponentCommand = (w: SimWorld, o: SimRobot): Command => {
  const b = w.ball;
  if (o.id === 101) {
    // striker: get behind the ball and push towards our goal
    const dx = OWN_GOAL[0] - b.x;
    const dy = OWN_GOAL[1] - b.y;
    const l = hyp(dx, dy) || 1;
    // back off a short run-up, then drive through the ball (same physics as our robots)
    const bx = b.x - (dx / l) * (CONTACT + 350);
    const by = b.y - (dy / l) * (CONTACT + 350);
    const close = hyp(o.x - bx, o.y - by) < 140 || hyp(o.x - b.x, o.y - b.y) < CONTACT + 300;
    return {
      tx: close ? b.x + (dx / l) * 800 : bx,
      ty: close ? b.y + (dy / l) * 800 : by,
      speed: 0.75,
      face: (Math.atan2(dy, dx) * 180) / Math.PI,
      spin: 0,
      kick: w.oppKickCooldown <= 0 ? { dx: dx / l, dy: dy / l, minAlign: 0.7 } : null,
    };
  }
  if (o.id === 103) {
    return {
      tx: FIELD.halfX - 150,
      ty: clamp(b.y * 0.8, -650, 650),
      speed: 1,
      face: 180,
      spin: 0,
      kick: null,
    };
  }
  const homeY = o.home[1];
  return {
    tx: clamp(b.x + 900, 300, 2600),
    ty: clamp(homeY + (b.y - homeY) * 0.35, -2400, 2400),
    speed: 0.6,
    face: (Math.atan2(b.y - o.y, b.x - o.x) * 180) / Math.PI,
    spin: 0,
    kick: null,
  };
};

/* ------------------------------------------------------------------ */
/* Physics                                                             */
/* ------------------------------------------------------------------ */

const drive = (r: SimRobot, c: Command, dt: number) => {
  const dx = c.tx - r.x;
  const dy = c.ty - r.y;
  const d = hyp(dx, dy);
  const vmax = MAX_SPEED * c.speed;
  const want = d > 3 ? Math.min(vmax, Math.sqrt(2 * MAX_ACCEL * d) * 0.9) : 0;
  const wx = d > 3 ? (dx / d) * want : 0;
  const wy = d > 3 ? (dy / d) * want : 0;
  const ex = wx - r.vx;
  const ey = wy - r.vy;
  const el = hyp(ex, ey);
  const maxDv = MAX_ACCEL * dt;
  if (el > maxDv) {
    r.vx += (ex / el) * maxDv;
    r.vy += (ey / el) * maxDv;
  } else {
    r.vx = wx;
    r.vy = wy;
  }
  r.x = clamp(r.x + r.vx * dt, -FIELD.outerX + ROBOT_R, FIELD.outerX - ROBOT_R);
  r.y = clamp(r.y + r.vy * dt, -FIELD.outerY + ROBOT_R, FIELD.outerY - ROBOT_R);

  if (c.spin) r.angle += c.spin * dt;
  else if (c.face !== null) {
    const diff = angleDiff(r.angle, c.face);
    r.angle += clamp(diff, -MAX_TURN * dt, MAX_TURN * dt);
  }
};

/**
 * Robot ↔ ball collision using conservation of momentum with restitution.
 * The ball only gets the velocity the robot actually hits it with (no scripted kick power):
 *   impulse j = (1 + e) · v_rel·n / (1/m_ball + 1/m_robot)
 * Glancing hits only transfer the component along the contact normal, so the ball squirts off
 * sideways if the robot isn't lined up. Returns true if this was a deliberate, lined-up strike.
 */
const ballContact = (w: SimWorld, r: SimRobot, kick: Command['kick']): boolean => {
  const b = w.ball;
  const dx = b.x - r.x;
  const dy = b.y - r.y;
  const d = hyp(dx, dy);
  if (d >= CONTACT) return false;

  const nx = d ? dx / d : 1;
  const ny = d ? dy / d : 0;

  // resolve overlap — the robot is ~17× heavier, so the ball does the moving
  b.x = r.x + nx * CONTACT;
  b.y = r.y + ny * CONTACT;

  const vRel = (r.vx - b.vx) * nx + (r.vy - b.vy) * ny; // closing speed along the normal
  if (vRel <= 0) return false; // already separating

  const { ballMass: m, robotMass: M, restitution: e, rollFactor } = PHYSICS;
  const j = ((1 + e) * vRel) / (1 / m + 1 / M); // kg·mm/s
  const dvBall = (j / m) * rollFactor; // part of the energy goes into spin as it starts rolling
  b.vx += nx * dvBall;
  b.vy += ny * dvBall;
  r.vx -= (nx * j) / M;
  r.vy -= (ny * j) / M;

  if (!kick) return false;
  const align = nx * kick.dx + ny * kick.dy;
  return align >= kick.minAlign && vRel > 150; // a real hit, not a gentle nudge
};

const separateRobots = (all: SimRobot[]) => {
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = hyp(dx, dy) || 0.01;
      const min = ROBOT_R * 2;
      if (d < min) {
        const push = (min - d) / 2;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
      }
    }
  }
};

const stepBall = (w: SimWorld, dt: number): 'us' | 'them' | null => {
  const b = w.ball;
  const sp = hyp(b.vx, b.vy);
  if (sp > 0) {
    // rolling resistance (constant) + speed-proportional losses
    const decel = PHYSICS.rollingDecel + PHYSICS.linearDrag * sp;
    let ns = Math.max(0, sp - decel * dt);
    if (ns < PHYSICS.stopSpeed) ns = 0;
    b.vx *= ns / sp;
    b.vy *= ns / sp;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  if (Math.abs(b.x) > FIELD.halfX) {
    if (Math.abs(b.y) < FIELD.goalHalfW) return b.x > 0 ? 'us' : 'them';
    b.x = Math.sign(b.x) * FIELD.halfX;
    b.vx = -b.vx * PHYSICS.wallRestitution;
  }
  if (Math.abs(b.y) > FIELD.halfY) {
    b.y = Math.sign(b.y) * FIELD.halfY;
    b.vy = -b.vy * PHYSICS.wallRestitution;
  }
  return null;
};

/* ------------------------------------------------------------------ */
/* Main step                                                           */
/* ------------------------------------------------------------------ */

export const routineFor = (strategy: StrategyConfig, situationId: string | null, robotId: number) =>
  situationId
    ? strategy.routines.find((r) => r.situationId === situationId && r.robotId === robotId) ?? null
    : null;

export const step = (w: SimWorld, strategy: StrategyConfig, dt: number) => {
  w.time += dt;
  w.oppKickCooldown -= dt;

  // 1. Which zone is the ball in?
  const zone = zonesAt(strategy, w.ball.x, w.ball.y)[0] ?? null;
  const zoneId = zone?.id ?? null;
  if (zoneId !== w.activeSituationId) {
    w.activeSituationId = zoneId;
    log(w, zone ? `Ball entered ${zone.name}` : 'Ball left all zones');
  }

  // 2. Friendly robots run their stacks for that zone
  const commands = new Map<number, Command>();
  w.friendly.forEach((bot) => {
    const st = w.exec[bot.id];
    const routine: RobotRoutine | null = routineFor(strategy, zoneId, bot.id);
    if ((routine?.id ?? null) !== st.routineId) {
      Object.assign(st, freshExec(), { routineId: routine?.id ?? null });
    }
    if (!routine || routine.blocks.length === 0) {
      st.status = zoneId ? 'No stack in this zone — holding' : 'No active zone — holding';
      st.target = null;
      commands.set(bot.id, hold(bot));
      return;
    }
    if (st.blockIdx >= routine.blocks.length) st.blockIdx = 0;
    const block = routine.blocks[st.blockIdx];
    const isLast = st.blockIdx === routine.blocks.length - 1;
    const { cmd, done } = runBlock(w, bot, block, st, isLast);
    st.t += dt;
    st.target = [cmd.tx, cmd.ty];
    commands.set(bot.id, cmd);
    if (done) {
      st.blockIdx = (st.blockIdx + 1) % routine.blocks.length; // stacks loop while the zone is active
      st.phase = 0;
      st.t = 0;
      st.turnTarget = null;
    }
  });

  // 3. Opponents
  const opps = w.opponentsEnabled ? w.opponents : [];
  opps.forEach((o) => commands.set(o.id, opponentCommand(w, o)));

  // 4. Physics
  w.friendly.forEach((r) => drive(r, commands.get(r.id)!, dt));
  opps.forEach((r) => drive(r, commands.get(r.id)!, dt));
  separateRobots([...w.friendly, ...opps]);

  w.friendly.forEach((r) => {
    const cmd = commands.get(r.id)!;
    if (ballContact(w, r, cmd.kick)) {
      const st = w.exec[r.id];
      const routine = routineFor(strategy, zoneId, r.id);
      const blk = routine?.blocks[st.blockIdx];
      if (blk && (blk.type === 'kickA' || blk.type === 'kickB')) {
        st.phase = 1; // finishes the kick block next tick
        log(w, `${r.label} ${blk.type === 'kickA' ? 'shot (KickA)' : 'passed (KickB)'}`);
      }
    }
  });
  opps.forEach((r) => {
    if (ballContact(w, r, commands.get(r.id)!.kick)) w.oppKickCooldown = 1.2;
  });

  const goal = stepBall(w, dt);
  if (goal) {
    w.score[goal] += 1;
    log(w, goal === 'us' ? 'GOAL! We scored' : 'Goal conceded');
    resetPositions(w);
  }
};