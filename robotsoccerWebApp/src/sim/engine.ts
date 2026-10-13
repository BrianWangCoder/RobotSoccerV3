/*
 * Robot soccer simulation engine — pure TypeScript, no React.
 *
 * Coordinates are millimetres with the origin at the centre spot:
 *   +x → towards the OPPONENT goal (right on screen), +y → down on screen.
 * Our goal is on the left (x = -FIELD.halfX). The field is 265 × 185 cm.
 *
 * Each tick the engine:
 *   1. works out which zone (situation) the ball is in — highest priority wins on overlap,
 *   2. runs every friendly robot's block stack for that zone (restarting stacks when the zone
 *      changes),
 *   3. runs a simple opponent AI,
 *   4. integrates robot + ball physics, contacts, kicks and goals.
 */

import { StrategyConfig, ScriptBlock, RobotRoutine } from '../types/strategy';
import { gridDimsFor, shapeOfSituation, pointInShape, ZoneShape } from '../utils/zones';
import { loopEndOf, loopStartOf } from '../utils/loops';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/**
 * The real field: 265 × 185 cm of playing surface enclosed by walls (no run-off), with small
 * angled pieces in the corners and the goals recessed behind the end walls. Markings measured
 * from a photo of the field. Everything on the pitch derives from these numbers (mm).
 */
export const FIELD = {
  halfX: 1325, // centre → end wall / goal line
  halfY: 925, // centre → side wall
  corner: 70, // leg length of the angled corner pieces
  goalHalfW: 200, // 40 cm goal mouth
  goalDepth: 120, // goal recess behind the wall
  penaltyDepth: 400, // penalty area: 40 cm deep × 80 cm wide, against the end wall
  penaltyHalfW: 400,
  goalAreaDepth: 180, // inner goal area: 18 × 50 cm
  goalAreaHalfW: 250,
  penaltyArcX: 280, // the arc on the front of the penalty area: centre (from the goal line) …
  penaltyArcR: 160, // … and radius
  centerR: 250, // centre circle radius
  /** Spot marks (± mirrored to all four quarters). */
  spots: [
    [350, 610],
    [950, 610],
  ] as [number, number][],
  outerX: 1475, // drawing extent: field + goal recess + a little margin
  outerY: 955,
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
  robotMaxSpeed: 1500, // mm/s at 100 % (top speed of each wheel)
  robotAccel: 2500, // mm/s² (how fast each wheel can change speed)
  robotTurnRate: 720, // deg/s — fastest spin on the spot (same wheel speeds as before, half the wheel spacing)
  wheelBase: 70, // mm between the two drive wheels (8.5 cm robot)
  sideGrip: 8000, // mm/s² — how quickly the tyres kill sideways sliding after a bump

  ballMass: 0.0459, // kg
  ballRadius: 21.35, // mm
  restitution: 0.6, // golf ball vs robot bumper (0 = dead, 1 = perfectly bouncy) — golf balls are lively
  rollingDecel: 270, // mm/s² — rolling resistance of a golf ball on the field mat ≈ 0.028 · g
  linearDrag: 0.08, // 1/s — extra speed-proportional loss (mat, air)
  rollFactor: 5 / 7, // speed kept after sliding → rolling transition (solid sphere)
  wallRestitution: 0.5, // ball bouncing off the field walls
  stopSpeed: 15, // mm/s — below this the ball comes to rest
};

/** Robots are SQUARE: this is half the side length (8.5 × 8.5 cm body). */
export const ROBOT_HALF = 42.5;
export const BALL_R = PHYSICS.ballRadius;

const MAX_SPEED = PHYSICS.robotMaxSpeed;
const MAX_ACCEL = PHYSICS.robotAccel;
const MAX_TURN = PHYSICS.robotTurnRate;
const WHEEL_BASE = PHYSICS.wheelBase;
/** Centre-to-ball distance when the ball touches the middle of a face. */
const CONTACT = ROBOT_HALF + BALL_R;

const OWN_GOAL: [number, number] = [-FIELD.halfX - 100, 0];

/* ------------------------------------------------------------------ */
/* Named spots usable in block parameters, e.g. [Left Flank]           */
/* ------------------------------------------------------------------ */

// mm, for the 265 × 185 cm field (see FIELD)
export const NAMED_SPOTS: Record<string, [number, number]> = {
  center: [0, 0],
  centre: [0, 0],
  midfield: [-315, 0],
  goal: [-1275, 0],
  'post l': [-1275, -150],
  'post r': [-1275, 150],
  'penalty spot': [-1045, 0],
  'penalty arc': [-885, 0],
  'left flank': [-695, -595],
  'right flank': [-695, 595],
  'left corner': [-1240, -840],
  'right corner': [-1240, 840],
  'opp goal': [1275, 0],
  'opp post l': [1275, -150],
  'opp post r': [1275, 150],
  'opp penalty spot': [1045, 0],
  'opp penalty arc': [885, 0],
  'opp left flank': [695, -595],
  'opp right flank': [695, 595],
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
  /** Left / right wheel speeds (mm/s, + = forward). Two DC motors are the ONLY way it moves. */
  wl: number;
  wr: number;
  /** Seconds it has been driving hard without getting anywhere (jammed against a robot / wall). */
  stuck: number;
  /** When jammed: a short straight back-off away from the obstacle, then back to its job. */
  escape: { tx: number; ty: number; until: number } | null;
  /** Taken out of play (parked in the rest area): no driving, no collisions, no ball. */
  benched: boolean;
  home: [number, number, number];
}

export interface ExecState {
  routineId: string | null;
  blockIdx: number;
  phase: number;
  t: number; // seconds spent in current block
  since: number; // world time the current phase started
  stuck: number; // GoalKeeper: how long the ball has been sitting dead against it (s)
  turnTarget: number | null;
  /** Move steps: where this block ends, and the heading it drives along (set when it starts). */
  stepGoal: [number, number] | null;
  stepHeading: number;
  status: string;
  target: [number, number] | null;
  /**
   * Last Defender / GoalKeeper block this robot ran. If the ball then leaves that zone and the
   * robot has no stack for the new zone, it keeps doing that job (back to its post, in range)
   * instead of freezing wherever it happened to be.
   */
  role: ScriptBlock | null;
  /** Defender / GoalKeeper: currently driving back onto its line after being knocked off it. */
  returning: boolean;
  /** C-loops: how many times each loop's body has run so far (by loop header id). */
  loopRuns: Record<string, number>;
}

export interface SimWorld {
  /**
   * Strategy-builder KickA preview: the ball never slows down (no friction), always rolls slowly,
   * and bounces off every wall (goals included) without losing speed.
   */
  endlessBall?: { speed: number };
  /** Strategy-builder previews: no lack-of-progress "referee". */
  noReferee?: boolean;
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
  /** Lack-of-progress watch: where the ball was, and since when it's barely moved. */
  progress: { x: number; y: number; since: number };
}

interface Command {
  tx: number;
  ty: number;
  speed: number; // 0..1
  face: number | null; // desired heading (deg)
  spin: number; // deg/s (overrides face when non-zero)
  /** A strike is armed: the robot is deliberately driving through the ball along (dx, dy). */
  kick: { dx: number; dy: number; minAlign: number; minSpeed?: number } | null;
  /**
   * Rail mode: keep the body pointed along this heading (either way round) and reach the target
   * by driving straight forwards / backwards along it — no turning to shuffle sideways.
   */
  axis?: number | null;
  /** Go-to: how close counts as "there" (mm) — default ARRIVE. */
  arrive?: number;
  /** Rail mode: stop exactly on the target (no jitter dead-band) — for measured moves. */
  precise?: boolean;
  /**
   * Straight-line go-to: turn on the spot until pointing (almost exactly) at the target, then
   * drive a straight line to it — no curving in from the side.
   */
  straight?: boolean;
  /**
   * Hard range limit: the robot's centre must stay within `max` mm of segment a–b. Speed
   * outwards is capped so it can always brake before the edge (moving inwards is never limited).
   */
  fence?: { a: [number, number]; b: [number, number]; max: number };
}

/** Kick-off spots (x, y, heading) for robots 1..5. */
export const FRIENDLY_HOME: [number, number, number][] = [
  [-380, 0, 0],
  [-755, -265, 0],
  [-1275, 0, 90], // robot 3: on the goal line, side-on (the GoalKeeper's stance)
  [-630, 300, 0],
  [-945, -560, 0],
];
const OPP_HOME: [number, number, number][] = [
  [380, 130, 180],
  [695, -230, 180],
  [1215, 0, 180],
  [570, 300, 180],
  [945, 560, 180], // B5 — mirrors our robot 5
];

const freshExec = (): ExecState => ({
  routineId: null,
  blockIdx: 0,
  phase: 0,
  t: 0,
  since: 0,
  stuck: 0,
  turnTarget: null,
  stepGoal: null,
  stepHeading: 0,
  status: 'idle',
  target: null,
  role: null,
  loopRuns: {},
  returning: false,
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
    wl: 0,
    wr: 0,
    stuck: 0,
    escape: null,
    benched: false,
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
    wl: 0,
    wr: 0,
    stuck: 0,
    escape: null,
    benched: false,
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
    progress: { x: 0, y: 0, since: 0 },
  };
};

/** Robots back to their kick-off spots, block stacks restarted. */
export const resetPositions = (w: SimWorld, ball: [number, number] = [0, 0]) => {
  [...w.friendly, ...w.opponents].forEach((r) => {
    if (r.benched) return; // robots in the rest area stay there
    r.x = r.home[0];
    r.y = r.home[1];
    r.angle = r.home[2];
    r.vx = 0;
    r.vy = 0;
    r.wl = 0;
    r.wr = 0;
    r.stuck = 0;
    r.escape = null;
  });
  w.ball = { x: ball[0], y: ball[1], vx: 0, vy: 0 };
  w.progress = { x: ball[0], y: ball[1], since: w.time };
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

let shapeCache: { strategy: StrategyConfig | null; map: Map<string, ZoneShape> } = {
  strategy: null,
  map: new Map(),
};

const zoneShapes = (strategy: StrategyConfig) => {
  if (shapeCache.strategy !== strategy) {
    const { cols, rows } = gridDimsFor(strategy.resolution);
    const map = new Map<string, ZoneShape>();
    strategy.situations.forEach((s) => map.set(s.id, shapeOfSituation(s, cols, rows)));
    shapeCache = { strategy, map };
  }
  return shapeCache.map;
};

/** All zones containing a field point, best (highest priority, then list order) first. */
export const zonesAt = (strategy: StrategyConfig, x: number, y: number) => {
  const u = clamp((x + FIELD.halfX) / (2 * FIELD.halfX), 0, 1);
  const v = clamp((y + FIELD.halfY) / (2 * FIELD.halfY), 0, 1);
  const map = zoneShapes(strategy);
  return strategy.situations
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => {
      const shape = map.get(s.id);
      return !!shape && pointInShape(u, v, shape);
    })
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

/** Default defender line (left/right as seen facing the opponent goal). */
const DEFENDER_LEFT: [number, number] = [-790, -400];
const DEFENDER_RIGHT: [number, number] = [-790, 400];

/** Shortest distance from (px, py) to segment AB (mm). */
/** Nearest point to (px, py) on segment a–b. */
const closestOnSegment = (
  px: number,
  py: number,
  a: [number, number],
  b: [number, number]
): [number, number] => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = clamp(((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return [a[0] + t * dx, a[1] + t * dy];
};

const distToSegment = (px: number, py: number, a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - a[0]) * dx + (py - a[1]) * dy) / len2, 0, 1);
  return hyp(px - (a[0] + t * dx), py - (a[1] + t * dy));
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
  label: string,
  requireStill = true, // clearances may strike a moving ball
  runUpMm?: number // how far behind the ball to line up before striking (mm); auto if omitted
): Command => {
  const b = w.ball;
  let dx = aim[0] - b.x;
  let dy = aim[1] - b.y;
  const dl = hyp(dx, dy) || 1;
  dx /= dl;
  dy /= dl;
  const face = (Math.atan2(dy, dx) * 180) / Math.PI;

  // Run-up: gap between the robot's bumper and the ball when it starts its strike.
  // A short run-up can't reach full speed, so it limits how hard the ball is hit.
  const auto = (MAX_SPEED * strike) ** 2 / (2 * MAX_ACCEL) + 60;
  let runUp = clamp(runUpMm ?? auto, 30, 600); // small field: never back off more than 60 cm
  // Near a wall the full run-up spot can be outside the field (the robot would wait there
  // forever). Lined up, the robot faces along the aim, so it needs this much room from walls:
  const roomX = ROBOT_HALF * (Math.abs(dx) + Math.abs(dy)) + 5;
  const roomY = roomX; // a square facing (dx, dy) sticks out the same amount in x and y
  const roomC = ROBOT_HALF * (Math.abs(dx + dy) + Math.abs(dx - dy)) / Math.SQRT2 + 5;
  const standable = (x: number, y: number) =>
    Math.abs(x) <= FIELD.halfX - roomX &&
    Math.abs(y) <= FIELD.halfY - roomY &&
    (Math.abs(x) + Math.abs(y)) / Math.SQRT2 <= CORNER_LIMIT - roomC;
  // 1) shorten the run-up until the lining-up spot fits …
  while (runUp > 30 && !standable(b.x - dx * (CONTACT + runUp), b.y - dy * (CONTACT + runUp))) runUp -= 10;
  const reachable = Math.min(MAX_SPEED * strike, Math.sqrt(2 * MAX_ACCEL * runUp));
  const behind: [number, number] = [b.x - dx * (CONTACT + runUp), b.y - dy * (CONTACT + runUp)];
  // 2) … and if the ball is so tight to a wall that even that spot is inside the wall (e.g. hitting
  // it along the wall), line up at the nearest spot the robot CAN stand — a little off the line,
  // but the ball still meets the flat front face, so it goes the chosen way
  if (!standable(behind[0], behind[1])) {
    behind[0] = clamp(behind[0], -(FIELD.halfX - roomX), FIELD.halfX - roomX);
    behind[1] = clamp(behind[1], -(FIELD.halfY - roomY), FIELD.halfY - roomY);
    const nx = Math.sign(behind[0]) / Math.SQRT2;
    const ny = Math.sign(behind[1]) / Math.SQRT2;
    const over = behind[0] * nx + behind[1] * ny - (CORNER_LIMIT - roomC);
    if (over > 0) {
      behind[0] -= nx * over;
      behind[1] -= ny * over;
    }
  }

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
        straight: true, // charge in a dead-straight line — the flat front sends the ball where it faces
      };
    }
  }

  // Wrong side of the ball → go round it
  const ahead = (bot.x - b.x) * dx + (bot.y - b.y) * dy > -CONTACT * 0.5;
  if (ahead && toBallL < CONTACT + runUp + 150) {
    const side = (bot.x - b.x) * -dy + (bot.y - b.y) * dx >= 0 ? 1 : -1;
    st.status = `${label}: circling ball`;
    return {
      // go round the ball tightly — just wide enough for the robot to pass it
      tx: behind[0] + -dy * side * 120,
      ty: behind[1] + dx * side * 120,
      speed: 0.7,
      face,
      spin: 0,
      kick: null,
    };
  }

  // Lined up tightly on the aim line: a square robot's flat front sends the ball wherever it's
  // facing at contact, so a few degrees / centimetres off here becomes a few degrees off target
  // …but if it's been trying for a while (crowded ball, robots bumping it), settle for a looser
  // line-up and take the shot rather than waiting forever
  const patient = st.t < 2.5;
  const settled =
    hyp(bot.x - behind[0], bot.y - behind[1]) < (patient ? 30 : 70) && hyp(bot.vx, bot.vy) < 150;
  const ballStill = !requireStill || hyp(b.vx, b.vy) < 300;
  // Square on AND no longer rotating (a two-wheel robot can't correct much once it charges)
  const facing =
    Math.abs(angleDiff(bot.angle, face)) < (patient ? 2 : 8) &&
    Math.abs(bot.wr - bot.wl) < (patient ? 15 : 40);
  if (settled && align >= minAlign && ballStill && facing) {
    st.phase = 2;
  }
  st.status = `${label}: lining up (align ${align.toFixed(2)}) · run-up ${Math.round(
    runUp / 10
  )} cm → max hit ${(reachable / 1000).toFixed(2)} m/s`;
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
      // Drive to the destination from wherever the robot is (older strategies may still carry a
      // "start" point — it's ignored)
      const tgt = parsePoint(p.stop) ?? [bot.x, bot.y];
      const speed = clamp(parseNum(p.speed, 80) / 100, 0.05, 1);
      const d = hyp(tgt[0] - bot.x, tgt[1] - bot.y);
      const heading = d > 30 ? (Math.atan2(tgt[1] - bot.y, tgt[0] - bot.x) * 180) / Math.PI : null;
      st.status = `Move: to destination · ${Math.round(d / 10)} cm away`;
      // arrived = there AND stopped (so it doesn't coast past into the next block)
      const stopped = Math.abs(bot.wl + bot.wr) / 2 < 40;
      if (d < 25 && stopped) return { cmd: { ...hold(bot), tx: tgt[0], ty: tgt[1] }, done: true };
      return {
        cmd: { tx: tgt[0], ty: tgt[1], speed, face: heading, spin: 0, kick: null, straight: true },
        done: false,
      };
    }

    case 'moveFromTo': {
      // Drive to the FROM point first, then on to the TO point
      const start = parsePoint(p.start) ?? [bot.x, bot.y];
      const stop = parsePoint(p.stop) ?? start;
      const speed = clamp(parseNum(p.speed, 80) / 100, 0.05, 1);
      const tgt = st.phase === 0 ? start : stop;
      const d = hyp(tgt[0] - bot.x, tgt[1] - bot.y);
      const heading = d > 30 ? (Math.atan2(tgt[1] - bot.y, tgt[0] - bot.x) * 180) / Math.PI : null;
      st.status = `Move from & to: ${st.phase === 0 ? 'to the start' : 'to the end'} · ${Math.round(d / 10)} cm away`;
      // reached a point = there AND stopped, so each leg starts from rest and runs straight
      if (d < 25 && Math.abs(bot.wl + bot.wr) / 2 < 40) {
        if (st.phase === 0 && hyp(stop[0] - start[0], stop[1] - start[1]) > 25) st.phase = 1;
        else return { cmd: { ...hold(bot), tx: tgt[0], ty: tgt[1] }, done: true };
      }
      return {
        cmd: { tx: tgt[0], ty: tgt[1], speed, face: heading, spin: 0, kick: null, straight: true },
        done: false,
      };
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

    case 'point': {
      // Face an absolute heading. Block angles: 0° = pointing right (towards the opponent goal),
      // counter-clockwise positive like a protractor (90° = up the screen). The engine's angles
      // run clockwise on screen (y points down), hence the minus sign.
      const deg = parseNum(p.angle, 90);
      const rate = Math.max(5, Math.abs(parseNum(p.speed, 180)));
      const remaining = angleDiff(bot.angle, -deg);
      st.status = `Point: to ${deg}° · ${Math.round(Math.abs(remaining))}° to go`;
      if (Math.abs(remaining) < 0.5 && Math.abs(bot.wr - bot.wl) < 20) return { cmd: hold(bot), done: true };
      return {
        cmd: {
          ...hold(bot),
          spin: Math.sign(remaining) * Math.max(8, Math.min(rate, Math.abs(remaining) * 20)),
        },
        done: false,
      };
    }

    case 'moveSteps': {
      // Drive straight along the way the robot is facing (negative = backwards), no turning
      const dist = parseNum(p.distance, 20) * 10; // cm → mm
      const speed = clamp(parseNum(p.speed, 50) / 100, 0.05, 1);
      if (!st.stepGoal) {
        const rad = (bot.angle * Math.PI) / 180;
        st.stepGoal = [bot.x + Math.cos(rad) * dist, bot.y + Math.sin(rad) * dist];
        st.stepHeading = bot.angle;
        st.turnTarget = Math.abs(dist); // closest it has got so far (for spotting a blocked move)
        st.since = w.time;
      }
      const rad = (st.stepHeading * Math.PI) / 180;
      const left = (st.stepGoal[0] - bot.x) * Math.cos(rad) + (st.stepGoal[1] - bot.y) * Math.sin(rad);
      st.status = `Move steps: ${Math.round(Math.abs(left) / 10)} cm to go`;
      const stopped = Math.abs(bot.wl + bot.wr) / 2 < 40;
      // something in the way (wall / robot): give up once it's made no progress for half a second
      if (Math.abs(left) < (st.turnTarget ?? Infinity) - 2) {
        st.turnTarget = Math.abs(left);
        st.since = w.time;
      }
      const tooLong = w.time - st.since > 0.5;
      if ((Math.abs(left) < 8 && stopped) || tooLong) {
        if (tooLong) st.status = 'Move steps: blocked — gave up';
        return { cmd: hold(bot), done: true };
      }
      return {
        cmd: {
          tx: st.stepGoal[0],
          ty: st.stepGoal[1],
          speed,
          face: null,
          spin: 0,
          kick: null,
          axis: st.stepHeading,
          precise: true,
        },
        done: false,
      };
    }

    case 'spin': {
      const rpm = parseNum(p.rpm, 450);
      const ms = Math.max(0, parseNum(p.duration, 1500)); // how long to spin for
      st.status = `Spin: ${rpm} rpm · ${Math.max(0, Math.round(ms - st.t * 1000))} ms left`;
      return { cmd: { ...hold(bot), spin: rpm * 6 }, done: st.t * 1000 >= ms };
    }

    case 'defender':
    case 'goalkeeper': {
      // Guard a line between LEFT and RIGHT (left/right as seen facing the opponent goal),
      // standing where the ball's path to our goal crosses it. If the ball comes within the
      // KICK-OUT range of the line, leave it, clear the ball away from our goal, then return.
      const isGK = block.type === 'goalkeeper';
      const label = isGK ? 'GoalKeeper' : 'Defender';
      const a =
        parsePoint(p.left ?? p.start) ?? (isGK ? NAMED_SPOTS['post l'] : DEFENDER_LEFT);
      const b =
        parsePoint(p.right ?? p.stop) ?? (isGK ? NAMED_SPOTS['post r'] : DEFENDER_RIGHT);
      const kickout = clamp(parseNum(p.kickout, 15), 0, 100) * 10; // cm → mm
      const ballToLine = distToSegment(ball.x, ball.y, a, b);

      if (isGK) {
        // GoalKeeper: always side-on — body pointed ALONG the goal line, never towards or away
        // from goal. It only shuttles left/right to stay between the ball and the goal, so it
        // blocks shots by being in the way (and knocks the ball with its front/back face if the
        // ball comes along the line). It never charges out.
        const lineHeading = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        let [tx, ty] = shadowOnSegment(a, b, ball, OWN_GOAL);
        // Read the shot: if the ball is rolling towards our goal, slide to where its path will
        // cross the keeper's line instead of just mirroring the ball's position
        const gdx = OWN_GOAL[0] - ball.x;
        const gdy = OWN_GOAL[1] - ball.y;
        if ((ball.vx * gdx + ball.vy * gdy) / (hyp(gdx, gdy) || 1) > 300) {
          const sx = b[0] - a[0];
          const sy = b[1] - a[1];
          const den = ball.vx * sy - ball.vy * sx;
          if (Math.abs(den) > 1e-6) {
            // ball + t·v = a + u·(b − a)  →  u along the line
            const u = ((a[0] - ball.x) * ball.vy - (a[1] - ball.y) * ball.vx) / den;
            const t = clamp(u, 0, 1);
            tx = a[0] + sx * t;
            ty = a[1] + sy * t;
          }
        }

        // Flick: a blocked ball can end up resting against the keeper's field-side face, where
        // sliding along the line can't move it. A quick part-spin swings a corner into it and
        // knocks it gently away, then the keeper squares back up (phase 20 = flicking).
        if (st.phase === 20) {
          const turned = Math.abs(angleDiff(st.turnTarget ?? bot.angle, bot.angle));
          if (turned > 4 && w.time - st.since < 0.35) {
            st.status = 'GoalKeeper: flicking the ball clear';
            return {
              cmd: { ...hold(bot), spin: Math.sign(angleDiff(bot.angle, st.turnTarget!)) * MAX_TURN },
              done: false,
            };
          }
          st.phase = 0;
          st.turnTarget = null;
          st.stuck = 0;
        }
        const lx = (b[0] - a[0]) / (hyp(b[0] - a[0], b[1] - a[1]) || 1);
        const ly = (b[1] - a[1]) / (hyp(b[0] - a[0], b[1] - a[1]) || 1);
        // the line's normal that points out into the field (away from our goal)
        const side = (bot.x - OWN_GOAL[0]) * -ly + (bot.y - OWN_GOAL[1]) * lx >= 0 ? 1 : -1;
        const fnx = -ly * side;
        const fny = lx * side;
        const relX = ball.x - bot.x;
        const relY = ball.y - bot.y;
        const out = relX * fnx + relY * fny; // how far the ball is out in front of the keeper
        const along = relX * lx + relY * ly;
        const resting =
          hyp(ball.vx, ball.vy) < 120 &&
          out > 0 &&
          out < CONTACT + 15 &&
          Math.abs(along) < ROBOT_HALF + BALL_R;
        st.stuck = resting ? st.stuck + 1 / 120 : 0;
        if (st.phase === 0 && st.stuck > 0.25 && w.time - st.since > 0.8) {
          // spin the way that pushes the ball towards the nearer side, not across the goal mouth
          const centre = (a[0] + b[0]) / 2 * lx + (a[1] + b[1]) / 2 * ly;
          const towards = Math.sign(ball.x * lx + ball.y * ly - centre) || 1;
          // spinning +angle moves the touching surface at ω·(−relY, relX): its share along the line
          const ccwPush = Math.sign(-relY * lx + relX * ly) || 1;
          st.phase = 20;
          st.since = w.time;
          st.turnTarget = bot.angle + 50 * towards * ccwPush;
          st.status = 'GoalKeeper: flicking the ball clear';
          return {
            cmd: { ...hold(bot), spin: Math.sign(towards * ccwPush) * MAX_TURN },
            done: false,
          };
        }
        // Strictly on its line: knocked / dragged off it → straight back to the nearest point on
        // the line (to within ~1 cm), square up along it, then carry on
        const gkOff = distToSegment(bot.x, bot.y, a, b);
        if (gkOff > (st.returning ? 10 : 35)) {
          st.returning = true;
          st.status = 'GoalKeeper: back onto the goal line';
          const along =
            Math.abs(angleDiff(bot.angle, lineHeading)) <= 90 ? lineHeading : lineHeading + 180;
          const [nx, ny] = closestOnSegment(bot.x, bot.y, a, b);
          return {
            cmd: { tx: nx, ty: ny, speed: 1, face: along, spin: 0, kick: null, arrive: 6 },
            done: false,
          };
        }
        st.returning = false;
        st.status = `GoalKeeper: sliding along the goal line · ball ${Math.round(ballToLine / 10)} cm out`;
        return {
          cmd: { tx, ty, speed: 1, face: null, spin: 0, kick: null, axis: lineHeading },
          done: false,
        };
      }
      // Everything this block does stays inside its range (kick-out distance around the line)
      const out = (cmd: Command, done = false): BlockResult => ({
        cmd: { ...cmd, fence: { a, b, max: kickout } },
        done,
      });

      // Phases: 0 guarding · 1 just hit (set by step) · 2 planKick strike (ball-behind fallback)
      //         10 squaring up to the ball · 11 charging it · 12 returning to post
      const setPhase = (ph: number) => {
        st.phase = ph;
        st.since = w.time;
      };
      const offLine = distToSegment(bot.x, bot.y, a, b);

      if (st.phase === 1) {
        // just cleared the ball: one hit, then straight back to post
        if (!isLast) return out(hold(bot), true); // hand over to the next block
        setPhase(12);
      }
      if (st.phase === 12 && offLine <= 10 && w.time - st.since > 0.3) st.phase = 0;

      // A fast ball heading for our goal gets BLOCKED first (stay on the line); once it's
      // slowed or bounced off, step out and clear it.
      const gdx = OWN_GOAL[0] - ball.x;
      const gdy = OWN_GOAL[1] - ball.y;
      const towardGoal = (ball.vx * gdx + ball.vy * gdy) / (hyp(gdx, gdy) || 1);
      const incoming = towardGoal > 500;
      const engaged = st.phase === 2 || st.phase === 10 || st.phase === 11;
      const clearing =
        kickout > 0 &&
        !incoming &&
        st.phase !== 12 &&
        ballToLine <= kickout + (engaged ? 120 : 0);
      if (clearing) {
        const gx = ball.x - OWN_GOAL[0];
        const gy = ball.y - OWN_GOAL[1];
        const gl = hyp(gx, gy) || 1;
        // No run-up: square up to the ball on the spot, then drive straight through it.
        // From the goal side that knocks it away from goal — only if the ball has slipped
        // behind us do we have to go round it first (else we'd push it into our own net).
        const toBall = distBall || 1;
        const bx = (ball.x - bot.x) / toBall;
        const by = (ball.y - bot.y) / toBall;
        const awayFromGoal = (bx * gx + by * gy) / gl;
        if (awayFromGoal > 0.2 || st.phase === 11) {
          if (st.phase !== 11) {
            if (st.phase !== 10) setPhase(10);
            const squared =
              Math.abs(angleDiff(bot.angle, faceBall)) < 10 && Math.abs(bot.wr - bot.wl) < 120;
            const gap = distBall - CONTACT;
            if (squared && gap < 50) {
              // Ball is touching us: with no room to pick up speed we'd only push it along.
              // Reverse a few cm so the next move is a proper hit.
              st.status = `${label}: making room to hit`;
              return out({
                tx: bot.x - bx * (80 - gap),
                ty: bot.y - by * (80 - gap),
                speed: 0.6,
                face: faceBall,
                spin: 0,
                kick: null,
              });
            }
            if (squared) setPhase(11);
            else {
              st.status = `${label}: turning to the ball`;
              return out({ ...hold(bot), face: faceBall });
            }
          }
          if (w.time - st.since < 2) {
            st.status = `${label}: clearing — hitting the ball`;
            return out({
              tx: ball.x + bx * 300, // just past the ball: full speed at contact, then brake
              ty: ball.y + by * 300,
              speed: 1,
              face: faceBall,
              spin: 0,
              // Any contact counts as the hit — then we go back, we don't dribble it away
              kick: { dx: bx, dy: by, minAlign: 0.3, minSpeed: 30 },
            });
          }
          setPhase(12); // charge took too long → give up and go back
        } else {
          const aim: [number, number] = [ball.x + (gx / gl) * 2500, ball.y + (gy / gl) * 2500];
          return out(planKick(w, bot, aim, 1, 0.5, st, `${label}: getting goal-side`, false, 30));
        }
      }
      // Ball escaped the band / we strayed too far → head back to the post
      if (engaged) setPhase(offLine > 120 ? 12 : 0);

      const [tx, ty] = shadowOnSegment(a, b, ball, OWN_GOAL);
      st.status =
        st.phase === 12
          ? `${label}: returning to post`
          : `${label}: guarding · ball ${Math.round(ballToLine / 10)} cm from line`;
      // Two-wheel robot: park ALONG the guard line and shuttle forwards/backwards on it, rather
      // than facing the ball and having to turn every time the shadow point slides sideways.
      const lineHeading = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      // Strictly on its path: knocked / dragged off the line (and not out clearing the ball) →
      // straight back to the nearest point on the line (to within ~1 cm), square up, carry on
      if (offLine > (st.returning || st.phase === 12 ? 10 : 35)) {
        st.returning = true;
        if (st.phase !== 12) st.status = `${label}: back onto its line`;
        const along =
          Math.abs(angleDiff(bot.angle, lineHeading)) <= 90 ? lineHeading : lineHeading + 180;
        const [nx, ny] = closestOnSegment(bot.x, bot.y, a, b);
        return out({ tx: nx, ty: ny, speed: 1, face: along, spin: 0, kick: null, arrive: 6 });
      }
      st.returning = false;
      return out({ tx, ty, speed: 1, face: null, spin: 0, kick: null, axis: lineHeading });
    }

    case 'kickA': {
      const minAlign = clamp(parseNum(p.threshold, 0.85), 0, 1);
      const pct = clamp(parseNum(p.speed, 95) / 100, 0.05, 1);
      if (st.t > 12) {
        st.status = 'Kick: gave up (timeout)';
        return { cmd: hold(bot), done: true };
      }
      if (st.phase === 1) return { cmd: hold(bot), done: true }; // kicked last tick
      // Hit the ball in the direction the player chose (no auto-aim at the goal).
      // Block angles: 0° = towards the opponent goal (right), counter-clockwise: 90° = up.
      const rad = (-parseNum(p.angle, 0) * Math.PI) / 180; // screen y points down
      const aim: [number, number] = [ball.x + Math.cos(rad) * 2500, ball.y + Math.sin(rad) * 2500];
      return {
        cmd: planKick(
          w,
          bot,
          aim,
          pct,
          minAlign,
          st,
          'KickA',
          true,
          // KickA gets right up to the ball: a short run-up (10 cm unless the block says otherwise)
          parseNum(p.runup, 10) * 10
        ),
        done: false,
      };
    }

    case 'loop': // loops are handled in step() before blocks run
    case 'loopEnd':
    case 'pause':
      // Stop here and hold position. Never finishes, so the blocks above run once; the stack
      // starts again from the top when the ball moves to another zone (or leaves and comes back).
      st.status = 'Paused — waiting for the ball to change zone';
      return { cmd: hold(bot), done: false };

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
    const bx = b.x - (dx / l) * (CONTACT + 200);
    const by = b.y - (dy / l) * (CONTACT + 200);
    const close = hyp(o.x - bx, o.y - by) < 100 || hyp(o.x - b.x, o.y - b.y) < CONTACT + 180;
    return {
      tx: close ? b.x + (dx / l) * 400 : bx,
      ty: close ? b.y + (dy / l) * 400 : by,
      speed: 0.75,
      face: (Math.atan2(dy, dx) * 180) / Math.PI,
      spin: 0,
      kick: w.oppKickCooldown <= 0 ? { dx: dx / l, dy: dy / l, minAlign: 0.7 } : null,
    };
  }
  if (o.id === 103) {
    return {
      tx: FIELD.halfX - 110,
      ty: clamp(b.y * 0.8, -(FIELD.goalHalfW - 60), FIELD.goalHalfW - 60),
      speed: 1,
      face: 180,
      spin: 0,
      kick: null,
    };
  }
  const homeY = o.home[1];
  return {
    tx: clamp(b.x + 300, 100, 820),
    ty: clamp(homeY + (b.y - homeY) * 0.35, -(FIELD.halfY - 150), FIELD.halfY - 150),
    speed: 0.6,
    face: (Math.atan2(b.y - o.y, b.x - o.x) * 180) / Math.PI,
    spin: 0,
    kick: null,
  };
};

/* ------------------------------------------------------------------ */
/* Physics                                                             */
/* ------------------------------------------------------------------ */

/**
 * Differential drive: the robot has two DC motors (left / right wheel) and NO sideways motion.
 * It can only roll along its heading; it steers by running the wheels at different speeds
 * (arcs), turns on the spot with the wheels opposed, and pivots with one wheel stopped.
 *
 * Go-to-point controller:
 *  - target well off to the side → turn on the spot towards it
 *  - otherwise drive forward and arc onto the line (inner wheel slower), slowing for big errors
 *  - target close BEHIND → reverse onto it instead of doing a U-turn (not while striking)
 *  - arrived → turn on the spot to the requested facing
 */
const ARRIVE = 25; // mm
const MAX_ROLL_YAW = 0.3; // rad/s (~17°/s) — the most a robot may turn while rolling: tiny corrections only

const drive = (r: SimRobot, cmd: Command, dt: number, now = 0) => {
  let c = cmd;
  if (r.escape) {
    if (now > r.escape.until || hyp(r.escape.tx - r.x, r.escape.ty - r.y) < ARRIVE) r.escape = null;
    else c = { tx: r.escape.tx, ty: r.escape.ty, speed: 0.7, face: null, spin: 0, kick: null };
  }
  const rad = (r.angle * Math.PI) / 180;
  const hx = Math.cos(rad);
  const hy = Math.sin(rad);
  const toRad = Math.PI / 180;
  const maxOmega = MAX_TURN * toRad; // rad/s
  const vmax = MAX_SPEED * c.speed;

  let v = 0; // desired forward speed, mm/s (negative = reversing)
  let omega = 0; // desired yaw rate, rad/s (+ = counter-clockwise, towards +angle)

  // Yaw rate that can still be braked to zero by the heading error (motors can't stop instantly),
  // so the robot settles on a heading instead of overshooting it
  const maxYawAccel = (2 * MAX_ACCEL) / WHEEL_BASE; // rad/s²
  const steer = (errDeg: number, gain: number) => {
    const e = errDeg * toRad;
    const cap = Math.min(maxOmega, Math.sqrt(2 * maxYawAccel * 0.85 * Math.abs(e)));
    return clamp(e * gain, -cap, cap);
  };

  const dx = c.tx - r.x;
  const dy = c.ty - r.y;
  const d = hyp(dx, dy);

  if (c.spin) {
    omega = clamp(c.spin * toRad, -maxOmega, maxOmega);
  } else if (c.axis != null) {
    // Rail mode: hold the axis heading (whichever way round is closer) and drive along it
    const h = Math.abs(angleDiff(r.angle, c.axis)) <= 90 ? c.axis : c.axis + 180;
    const hr = h * toRad;
    const along = dx * Math.cos(hr) + dy * Math.sin(hr); // + = ahead of us on the rail
    const lateral = -dx * Math.sin(hr) + dy * Math.cos(hr); // + = to our left
    const RAIL_DEADBAND = c.precise ? 4 : 40; // mm — ignore tiny shadow-point jitter instead of twitching
    if (Math.abs(along) > RAIL_DEADBAND) {
      v = Math.sign(along) * Math.min(vmax, Math.sqrt(2 * MAX_ACCEL * Math.abs(along)) * 0.9);
    }
    // Gentle heading nudge to soak up any drift off the rail (flipped when reversing)
    const drift = v ? (Math.atan2(lateral, 400) * 180) / Math.PI * Math.sign(v) : 0;
    const railErr = angleDiff(r.angle, h);
    if (Math.abs(railErr) > 3) {
      v = 0; // not lined up with the rail: square up on the spot first, then shuttle
      omega = steer(railErr, 8);
    } else {
      omega = clamp(steer(railErr + clamp(drift, -4, 4), 5), -MAX_ROLL_YAW, MAX_ROLL_YAW);
    }
  } else if (d > (c.arrive ?? ARRIVE)) {
    const bearing = (Math.atan2(dy, dx) * 180) / Math.PI;
    let err = angleDiff(r.angle, bearing);
    // Short hop to a point behind us: back onto it rather than turning round
    const reverse = !c.kick && Math.abs(err) > 110 && d < 500;
    if (reverse) err = angleDiff(r.angle, bearing + 180);
    const brake = Math.min(vmax, Math.sqrt(2 * MAX_ACCEL * d) * 0.9);
    // Robots NEVER arc: turn on the spot until lined up within 0.6° and no longer turning, then
    // drive a straight line, holding it with tiny corrections only. If the target moves more than
    // 4° off the line while rolling, stop and turn on the spot again.
    const rolling = Math.abs(r.wl + r.wr) / 2 > 60;
    const stillTurning = Math.abs(r.wr - r.wl) > 12;
    const lineUp = rolling ? Math.abs(err) > 4 : Math.abs(err) > 0.6 || stillTurning;
    if (lineUp) {
      omega = steer(err, 8); // turn on the spot
    } else {
      v = brake * Math.cos(err * toRad) * (reverse ? -1 : 1);
      omega = clamp(steer(err, 12), -MAX_ROLL_YAW, MAX_ROLL_YAW); // hold the straight line
    }
  } else if (c.face !== null) {
    omega = steer(angleDiff(r.angle, c.face), 8);
  }

  let brakeStraight = false;
  // NO ARCS: while the robot is rolling it may only steer gently (MAX_ROLL_YAW). Wanting to turn
  // harder than that means: brake to a stop in a straight line first, then turn on the spot.
  if (Math.abs(r.wl + r.wr) / 2 > 60 && Math.abs(omega) > MAX_ROLL_YAW + 1e-6) {
    v = 0;
    omega = 0;
    brakeStraight = true;
  }
  if (c.fence) {
    // The allowed area is a capsule (every point within `max` of segment a–b) — convex, so along
    // any straight line the robot can only travel a certain distance before leaving it.
    const { a, b, max } = c.fence;
    const inside = (x: number, y: number) => distToSegment(x, y, a, b) <= max;
    const brake = 2 * MAX_ACCEL * 0.7; // keep 30 % of the motors' braking in reserve
    /** How far the robot can roll along its heading (dir = ±1) and still be inside. */
    const room = (dir: number) => {
      if (!inside(r.x, r.y)) return 0;
      let lo = 0;
      let hi = 2 * (max + hyp(b[0] - a[0], b[1] - a[1])) + 10;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (inside(r.x + hx * dir * mid, r.y + hy * dir * mid)) lo = mid;
        else hi = mid;
      }
      return Math.max(0, lo - 5);
    };
    const cur = (r.wl + r.wr) / 2;
    if (!inside(r.x, r.y)) {
      // Outside (pushed out by a bump): only moves that bring it back in are allowed
      const d0 = distToSegment(r.x, r.y, a, b);
      const step = Math.sign(v) * 10;
      if (v && distToSegment(r.x + hx * step, r.y + hy * step, a, b) >= d0) v = 0;
    } else if (cur && (cur * cur) / brake >= room(Math.sign(cur))) {
      // Can only just stop in the room left → brake hard, in a straight line
      v = 0;
      omega = 0;
      brakeStraight = true;
    } else if (v) {
      const cap = Math.sqrt(brake * room(Math.sign(v)));
      if (Math.abs(v) > cap) v = Math.sign(v) * cap;
    }
  }

  // Body speeds → wheel speeds. If a wheel would exceed its top speed, scale BOTH down so the
  // arc stays the same shape (that's what a real speed-limited motor pair does).
  let tl = v - (omega * WHEEL_BASE) / 2;
  let tr = v + (omega * WHEEL_BASE) / 2;
  const over = Math.max(Math.abs(tl), Math.abs(tr)) / MAX_SPEED;
  if (over > 1) {
    tl /= over;
    tr /= over;
  }

  // Braking straight: if one wheel is faster the robot would keep curving while it slows, so
  // first bring the faster wheel down to the slower one (a few hundredths of a second), then stop
  if (brakeStraight && Math.abs(r.wl - r.wr) > 1) {
    tl = tr = Math.abs(r.wl) < Math.abs(r.wr) ? r.wl : r.wr;
  }

  // Each motor can only change speed so fast. Both wheels are ramped together (same fraction of
  // the way to their targets) so braking stays straight instead of slewing the robot round.
  const dv = MAX_ACCEL * dt;
  const ramp = Math.min(1, dv / Math.max(Math.abs(tl - r.wl), Math.abs(tr - r.wr), 1e-9));
  r.wl += (tl - r.wl) * ramp;
  r.wr += (tr - r.wr) * ramp;

  const fwd = (r.wl + r.wr) / 2;
  const yaw = (r.wr - r.wl) / WHEEL_BASE; // rad/s

  // Sideways velocity only exists from bumps/collisions, and the tyres scrub it off quickly
  const side = -r.vx * hy + r.vy * hx;
  const sideLeft = Math.sign(side) * Math.max(0, Math.abs(side) - PHYSICS.sideGrip * dt);

  r.angle += (yaw / toRad) * dt;
  const nrad = (r.angle * Math.PI) / 180;
  const nhx = Math.cos(nrad);
  const nhy = Math.sin(nrad);
  r.vx = nhx * fwd - nhy * sideLeft;
  r.vy = nhy * fwd + nhx * sideLeft;

  r.x += r.vx * dt;
  r.y += r.vy * dt;
  keepInsideWalls(r);
};

/** Distance from the centre to each angled corner wall, measured along its normal. */
const CORNER_LIMIT = (FIELD.halfX + FIELD.halfY - FIELD.corner) / Math.SQRT2;

/** Keeps a (turned) square robot inside the walls, including the angled corner pieces. */
const keepInsideWalls = (r: SimRobot) => {
  const rad = (r.angle * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // how far the square sticks out along a direction (nx, ny)
  const support = (nx: number, ny: number) =>
    ROBOT_HALF * (Math.abs(c * nx + s * ny) + Math.abs(-s * nx + c * ny));
  const rx = support(1, 0);
  const ry = support(0, 1);
  r.x = clamp(r.x, -FIELD.halfX + rx, FIELD.halfX - rx);
  r.y = clamp(r.y, -FIELD.halfY + ry, FIELD.halfY - ry);
  const nx = (Math.sign(r.x) || 1) / Math.SQRT2;
  const ny = (Math.sign(r.y) || 1) / Math.SQRT2;
  const over = r.x * nx + r.y * ny + support(nx, ny) - CORNER_LIMIT;
  if (over > 0) {
    r.x -= nx * over;
    r.y -= ny * over;
  }
};

/**
 * Jam detection. Robots never curve round things, so two robots (or a robot and a wall) can end
 * up pushing straight into each other forever. If a robot's wheels are driving hard but it has
 * barely moved for 0.6 s, it backs off ~15 cm in a straight line away from whatever is blocking
 * it, then goes back to its job.
 */
const unstick = (
  all: SimRobot[],
  before: Map<SimRobot, readonly [number, number]>,
  now: number,
  dt: number
) => {
  all.forEach((r) => {
    const [px, py] = before.get(r)!;
    const wheel = Math.abs(r.wl + r.wr) / 2;
    const moved = hyp(r.x - px, r.y - py);
    if (wheel > 300 && moved < wheel * dt * 0.2) r.stuck += dt;
    else r.stuck = Math.max(0, r.stuck - dt);
    if (r.stuck < 0.6 || r.escape) return;
    r.stuck = 0;
    // away from the nearest robot touching us, else straight back from where we were heading
    let ax = 0;
    let ay = 0;
    let best = ROBOT_HALF * 2 * 1.6;
    all.forEach((o) => {
      if (o === r) return;
      const d = hyp(r.x - o.x, r.y - o.y);
      if (d < best) {
        best = d;
        ax = (r.x - o.x) / (d || 1);
        ay = (r.y - o.y) / (d || 1);
      }
    });
    if (!ax && !ay) {
      const sgn = r.wl + r.wr >= 0 ? -1 : 1; // pushing forwards → back off, and vice versa
      const rad = (r.angle * Math.PI) / 180;
      ax = Math.cos(rad) * sgn;
      ay = Math.sin(rad) * sgn;
    }
    const m = ROBOT_HALF + 20;
    r.escape = {
      tx: clamp(r.x + ax * 150, -FIELD.halfX + m, FIELD.halfX - m),
      ty: clamp(r.y + ay * 150, -FIELD.halfY + m, FIELD.halfY - m),
      until: now + 1.5,
    };
  });
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
  const H = ROBOT_HALF;
  const rad = (r.angle * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // Ball centre in the robot's frame (x = forward)
  const dx = b.x - r.x;
  const dy = b.y - r.y;
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  if (Math.abs(lx) > H + BALL_R || Math.abs(ly) > H + BALL_R) return false;

  // Closest point on the square's outline + outward normal (robot frame)
  let qx = clamp(lx, -H, H);
  let qy = clamp(ly, -H, H);
  let nlx: number;
  let nly: number;
  if (qx === lx && qy === ly) {
    // centre got inside the body (fast hit): push out through the nearest face
    if (H - Math.abs(lx) < H - Math.abs(ly)) {
      nlx = Math.sign(lx) || 1;
      nly = 0;
      qx = nlx * H;
    } else {
      nlx = 0;
      nly = Math.sign(ly) || 1;
      qy = nly * H;
    }
  } else {
    const ex = lx - qx;
    const ey = ly - qy;
    const d = hyp(ex, ey);
    if (d >= BALL_R) return false;
    nlx = ex / d;
    nly = ey / d;
  }
  const nx = nlx * c - nly * s;
  const ny = nlx * s + nly * c;
  const px = qx * c - qy * s; // contact point relative to the robot centre (world)
  const py = qx * s + qy * c;

  // resolve overlap — the robot is ~17× heavier, so the ball does the moving
  b.x = r.x + px + nx * BALL_R;
  b.y = r.y + py + ny * BALL_R;

  // Speed of the robot's surface at the contact point (a spinning square swats the ball)
  const yaw = (r.wr - r.wl) / WHEEL_BASE; // rad/s
  const svx = r.vx - yaw * py;
  const svy = r.vy + yaw * px;
  const vRel = (svx - b.vx) * nx + (svy - b.vy) * ny; // closing speed along the normal
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
  return align >= kick.minAlign && vRel > (kick.minSpeed ?? 150); // a real hit, not a gentle nudge
};

/** Square-vs-square overlap (separating axis test); pushes both apart along the shallowest axis. */
const separateRobots = (all: SimRobot[]) => {
  const H = ROBOT_HALF;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (hyp(dx, dy) > 2 * H * Math.SQRT2) continue; // too far apart to touch
      const ra = (a.angle * Math.PI) / 180;
      const rb = (b.angle * Math.PI) / 180;
      const axes: [number, number][] = [
        [Math.cos(ra), Math.sin(ra)],
        [-Math.sin(ra), Math.cos(ra)],
        [Math.cos(rb), Math.sin(rb)],
        [-Math.sin(rb), Math.cos(rb)],
      ];
      // projected half-width of a square with axes (u, v) onto n
      const extent = (ang: number, n: [number, number]) =>
        H * (Math.abs(Math.cos(ang) * n[0] + Math.sin(ang) * n[1]) +
          Math.abs(-Math.sin(ang) * n[0] + Math.cos(ang) * n[1]));
      let best = Infinity;
      let bn: [number, number] = [1, 0];
      for (const n of axes) {
        const dist = dx * n[0] + dy * n[1];
        const overlap = extent(ra, n) + extent(rb, n) - Math.abs(dist);
        if (overlap <= 0) {
          best = 0;
          break;
        }
        if (overlap < best) {
          best = overlap;
          bn = dist >= 0 ? n : [-n[0], -n[1]];
        }
      }
      if (best > 0 && best < Infinity) {
        const push = best / 2;
        a.x -= bn[0] * push;
        a.y -= bn[1] * push;
        b.x += bn[0] * push;
        b.y += bn[1] * push;
      }
    }
  }
};

const stepBall = (w: SimWorld, dt: number): 'us' | 'them' | null => {
  const b = w.ball;
  if (w.endlessBall) {
    // Preview: no friction, a slow constant roll, lossless bounces off every wall (no goals)
    const sp = hyp(b.vx, b.vy);
    if (sp > 1) {
      b.vx *= w.endlessBall.speed / sp;
      b.vy *= w.endlessBall.speed / sp;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const wx = FIELD.halfX - BALL_R;
    const wy = FIELD.halfY - BALL_R;
    if (Math.abs(b.x) > wx) {
      b.x = Math.sign(b.x) * wx;
      b.vx = -b.vx;
    }
    if (Math.abs(b.y) > wy) {
      b.y = Math.sign(b.y) * wy;
      b.vy = -b.vy;
    }
    const nx = (Math.sign(b.x) || 1) / Math.SQRT2;
    const ny = (Math.sign(b.y) || 1) / Math.SQRT2;
    const over = b.x * nx + b.y * ny + BALL_R - CORNER_LIMIT;
    if (over > 0) {
      b.x -= nx * over;
      b.y -= ny * over;
      const vn = b.vx * nx + b.vy * ny;
      if (vn > 0) {
        b.vx -= 2 * vn * nx;
        b.vy -= 2 * vn * ny;
      }
    }
    return null;
  }
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

  // Goal: the ball is over a goal line inside the goal mouth — however it got there (rolled,
  // or shoved over the line by a robot in one step)
  if (Math.abs(b.x) > FIELD.halfX && Math.abs(b.y) < FIELD.goalHalfW) {
    return b.x > 0 ? 'us' : 'them';
  }
  // Otherwise it bounces off the walls (the goal mouths are open)
  const wx = FIELD.halfX - BALL_R;
  const wy = FIELD.halfY - BALL_R;
  if (Math.abs(b.x) > wx && Math.abs(b.y) >= FIELD.goalHalfW) {
    b.x = Math.sign(b.x) * wx;
    b.vx = -b.vx * PHYSICS.wallRestitution;
  }
  if (Math.abs(b.y) > wy) {
    b.y = Math.sign(b.y) * wy;
    b.vy = -b.vy * PHYSICS.wallRestitution;
  }
  // Angled corner pieces
  const sx = Math.sign(b.x) || 1;
  const sy = Math.sign(b.y) || 1;
  const over = (Math.abs(b.x) + Math.abs(b.y)) / Math.SQRT2 + BALL_R - CORNER_LIMIT;
  if (over > 0) {
    const nx = sx / Math.SQRT2;
    const ny = sy / Math.SQRT2;
    b.x -= nx * over;
    b.y -= ny * over;
    const vn = b.vx * nx + b.vy * ny;
    if (vn > 0) {
      b.vx -= (1 + PHYSICS.wallRestitution) * vn * nx;
      b.vy -= (1 + PHYSICS.wallRestitution) * vn * ny;
    }
  }
  return null;
};

/**
 * Lack of progress (as in RoboCup Junior): if the ball hasn't moved more than 5 cm in 8 s — e.g.
 * jammed against a wall where no robot can get behind it — the "referee" puts it on the nearest
 * free spot mark (or the centre spot).
 */
const STUCK_MOVE = 50; // mm
const STUCK_TIME = 8; // s
const lackOfProgress = (w: SimWorld) => {
  const b = w.ball;
  if (hyp(b.x - w.progress.x, b.y - w.progress.y) > STUCK_MOVE) {
    w.progress = { x: b.x, y: b.y, since: w.time };
    return;
  }
  if (w.time - w.progress.since < STUCK_TIME) return;
  const robots = [...w.friendly, ...(w.opponentsEnabled ? w.opponents : [])].filter((r) => !r.benched);
  // only when robots are actually fighting over it — a ball just sitting there alone is left alone
  if (!robots.some((r) => hyp(r.x - b.x, r.y - b.y) < 250)) return;
  const marks: [number, number][] = [[0, 0]];
  FIELD.spots.forEach(([sx, sy]) =>
    marks.push([sx, sy], [-sx, sy], [sx, -sy], [-sx, -sy])
  );
  const free = marks.filter(([mx, my]) => robots.every((r) => hyp(r.x - mx, r.y - my) > ROBOT_HALF * 2.5));
  const pick = (free.length ? free : marks).reduce((best, m) =>
    hyp(m[0] - b.x, m[1] - b.y) < hyp(best[0] - b.x, best[1] - b.y) ? m : best
  );
  w.ball = { x: pick[0], y: pick[1], vx: 0, vy: 0 };
  w.progress = { x: pick[0], y: pick[1], since: w.time };
  log(w, 'Lack of progress — ball moved to a spot mark');
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
    if (bot.benched) {
      st.status = 'Resting in the rest area';
      st.target = null;
      return;
    }
    const routine: RobotRoutine | null = routineFor(strategy, zoneId, bot.id);
    if ((routine?.id ?? null) !== st.routineId) {
      Object.assign(st, freshExec(), { routineId: routine?.id ?? null, role: st.role });
    }
    if ((!routine || routine.blocks.length === 0) && st.role) {
      const { cmd } = runBlock(w, bot, st.role, st, true);
      st.status = `${st.status} (no stack in this zone — keeping post)`;
      st.t += dt;
      st.target = [cmd.tx, cmd.ty];
      commands.set(bot.id, cmd);
      return;
    }
    if (!routine || routine.blocks.length === 0) {
      st.status = zoneId ? 'No stack in this zone — holding' : 'No active zone — holding';
      st.target = null;
      commands.set(bot.id, hold(bot));
      return;
    }
    if (st.blockIdx >= routine.blocks.length) st.blockIdx = 0;

    // Scratch-style C loops: 'loop' opens, its matching 'loopEnd' closes. Neither takes any time —
    // they only move the program counter. Unclosed / stray markers are skipped.
    const list = routine.blocks;
    let flowed = false;
    for (let guard = 0; guard < list.length * 2 + 2; guard++) {
      if (st.blockIdx >= list.length) {
        st.blockIdx = 0; // end of stack → start again (stacks loop while the zone is active)
        st.loopRuns = {};
      }
      const blk = list[st.blockIdx];
      if (blk.type === 'loop') {
        const end = loopEndOf(list, st.blockIdx);
        st.loopRuns[blk.id] = 0; // entering the loop afresh
        // an empty loop (or one with no end) has nothing to repeat — step over it
        st.blockIdx = end < 0 ? st.blockIdx + 1 : end === st.blockIdx + 1 ? end + 1 : st.blockIdx + 1;
      } else if (blk.type === 'loopEnd') {
        const head = loopStartOf(list, st.blockIdx);
        if (head < 0) {
          st.blockIdx++;
        } else {
          const header = list[head];
          const times = Math.max(1, Math.round(parseNum((header.params as Record<string, unknown>).times, 2)));
          const runs = (st.loopRuns[header.id] ?? 0) + 1;
          if (runs < times) {
            st.loopRuns[header.id] = runs;
            st.blockIdx = head + 1; // round again
            st.status = `Loop: round ${runs + 1} of ${times}`;
          } else {
            delete st.loopRuns[header.id];
            st.blockIdx++; // finished — carry on below the loop
          }
        }
      } else break;
      flowed = true;
    }
    if (flowed) {
      st.phase = 0;
      st.t = 0;
      st.turnTarget = null;
      st.stepGoal = null;
    }
    if (st.blockIdx >= list.length) st.blockIdx = 0;
    const cur = list[st.blockIdx];
    if (cur.type === 'loop' || cur.type === 'loopEnd') {
      // nothing but loops with nothing inside them
      st.status = 'Loop: nothing inside to run';
      st.target = null;
      commands.set(bot.id, hold(bot));
      return;
    }
    const block = routine.blocks[st.blockIdx];
    st.role = block.type === 'defender' || block.type === 'goalkeeper' ? block : null;
    const isLast = st.blockIdx === routine.blocks.length - 1;
    const { cmd, done } = runBlock(w, bot, block, st, isLast);
    st.t += dt;
    st.target = [cmd.tx, cmd.ty];
    commands.set(bot.id, cmd);
    if (done) {
      st.blockIdx = (st.blockIdx + 1) % routine.blocks.length; // stacks loop while the zone is active
      if (st.blockIdx === 0) st.loopRuns = {};
      st.phase = 0;
      st.t = 0;
      st.turnTarget = null;
      st.stepGoal = null;
    }
  });

  // 3. Opponents
  const opps = (w.opponentsEnabled ? w.opponents : []).filter((o) => !o.benched);
  opps.forEach((o) => commands.set(o.id, opponentCommand(w, o)));

  // 4. Physics
  const ours = w.friendly.filter((r) => !r.benched); // robots in the rest area sit out
  const all = [...ours, ...opps];
  const before = new Map(all.map((r) => [r, [r.x, r.y] as const]));
  ours.forEach((r) => drive(r, commands.get(r.id)!, dt, w.time));
  opps.forEach((r) => drive(r, commands.get(r.id)!, dt, w.time));
  separateRobots(all);
  unstick(all, before, w.time, dt);

  ours.forEach((r) => {
    const cmd = commands.get(r.id)!;
    if (ballContact(w, r, cmd.kick)) {
      const st = w.exec[r.id];
      const routine = routineFor(strategy, zoneId, r.id);
      const blk = routine?.blocks.length ? routine.blocks[st.blockIdx] : st.role;
      if (blk && blk.type === 'kickA') {
        st.phase = 1; // finishes the kick block next tick
        log(w, `${r.label} shot (KickA)`);
      } else if (blk && (blk.type === 'defender' || blk.type === 'goalkeeper')) {
        st.phase = 1; // back to the line
        log(w, `${r.label} cleared the ball (${blk.type === 'goalkeeper' ? 'GoalKeeper' : 'Defender'})`);
      }
    }
  });
  opps.forEach((r) => {
    if (ballContact(w, r, commands.get(r.id)!.kick)) w.oppKickCooldown = 1.2;
  });

  const goal = stepBall(w, dt);
  if (!goal && !w.noReferee) lackOfProgress(w);
  if (goal) {
    w.score[goal] += 1;
    log(w, goal === 'us' ? 'GOAL! We scored' : 'Goal conceded');
    resetPositions(w);
  }
};