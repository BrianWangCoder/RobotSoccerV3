export type BlockType =
  | 'hat'
  | 'move'
  | 'turn'
  | 'spin'
  | 'defender'
  | 'goalkeeper'
  | 'kickA'
  | 'kickB';

export type BlockCategory = 'robot' | 'motion' | 'tactical' | 'kick';

export interface ScriptBlock {
  id: string;
  type: BlockType;
  category: BlockCategory;
  params: {
    start?: string;
    stop?: string;
    speed?: number | string;
    angle?: number | string;
    threshold?: number | string;
    rpm?: number | string;
    situationId?: string;
  };
}

export interface RobotRoutine {
  id: string;
  robotId: number;
  situationId: string;
  blocks: ScriptBlock[];
}

export interface SituationZone {
  id: string;
  name: string;
  priority: 'Low Priority' | 'Medium Priority' | 'High Priority' | 'Critical';
  // Normalized field coordinates (0 to 1) or grid coordinates
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
  selectedDots: string[]; // Set of "col,row" strings
  /** Exact zone polygon(s) in normalised field units — see ZoneShape in utils/zones. */
  selectedShape?: [number, number][][][];
  /** Legacy shape format (quarter-cells); only read when selectedShape is missing. */
  selectedQuarters?: string[];
}

export interface StrategyConfig {
  id: string;
  filename: string;
  name: string;
  resolution:
    | 'Very Coarse (4x3)'
    | 'Coarse (8x6)'
    | 'Medium (12x9)'
    | 'Fine (16x12)'
    | 'Extra Fine (20x15)'
    | 'Ultra Fine (24x18)';
  activeSituationId: string;
  situations: SituationZone[];
  routines: RobotRoutine[];
}

export interface RobotStatus {
  id: number;
  label: string;
  team: 'RED' | 'BLUE';
  x: number; // field metres [-1.325, 1.325] (265 cm field)
  y: number; // field metres [-0.925, 0.925] (185 cm field)
  angle: number; // radians or degrees
  status: 'ACTIVE' | 'OCCLUDED' | 'OFFLINE';
  battery: number; // percentage
  wirelessSignal: number; // dBm
  currentAction?: string;
  motorRpm?: [number, number, number, number];
}

export interface BallStatus {
  x: number;
  y: number;
  vx: number;
  vy: number;
  confidence: number;
}
