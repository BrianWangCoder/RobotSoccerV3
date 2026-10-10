import { StrategyConfig } from '../types/strategy';

export const defaultDefensiveStrategy: StrategyConfig = {
  id: 'strat_def_01',
  filename: 'strategy_defensive_01.json',
  name: 'Defensive Strategy 01',
  resolution: 'Medium (12x9)',
  activeSituationId: 'sit_1',
  situations: [
    {
      id: 'sit_1',
      name: 'Situation 1',
      priority: 'Low Priority',
      minCol: 1,
      maxCol: 4,
      minRow: 1,
      maxRow: 7,
      selectedDots: [
        '1,1', '1,2', '1,3', '1,4', '1,5', '1,6', '1,7',
        '2,1', '2,2', '2,3', '2,4', '2,5', '2,6', '2,7',
        '3,1', '3,2', '3,3', '3,4', '3,5', '3,6', '3,7',
        '4,1', '4,2', '4,3', '4,4', '4,5', '4,6', '4,7',
      ],
    },
    {
      id: 'sit_2',
      name: 'Situation 2 (Midfield Duel)',
      priority: 'Medium Priority',
      minCol: 5,
      maxCol: 8,
      minRow: 2,
      maxRow: 6,
      selectedDots: [
        '5,2', '5,3', '5,4', '5,5', '5,6',
        '6,2', '6,3', '6,4', '6,5', '6,6',
        '7,2', '7,3', '7,4', '7,5', '7,6',
        '8,2', '8,3', '8,4', '8,5', '8,6',
      ],
    },
    {
      id: 'sit_3',
      name: 'Situation 3 (Penalty Box Threat)',
      priority: 'High Priority',
      minCol: 0,
      maxCol: 2,
      minRow: 3,
      maxRow: 5,
      selectedDots: [
        '0,3', '0,4', '0,5',
        '1,3', '1,4', '1,5',
        '2,3', '2,4', '2,5',
      ],
    },
  ],
  routines: [
    {
      id: 'routine_r1',
      robotId: 1,
      situationId: 'sit_1',
      blocks: [
        {
          id: 'blk_1_1',
          type: 'move',
          category: 'motion',
          params: { start: '[0, 0]', stop: '[120, -50]', speed: '80%' },
        },
        {
          id: 'blk_1_2',
          type: 'kickA',
          category: 'kick',
          params: { threshold: '0.85', speed: '95%' },
        },
      ],
    },
    {
      id: 'routine_r2',
      robotId: 2,
      situationId: 'sit_1',
      blocks: [
        {
          id: 'blk_2_1',
          type: 'defender',
          category: 'tactical',
          params: { start: '[Left Flank]', stop: '[Penalty Arc]' },
        },
        {
          id: 'blk_2_2',
          type: 'turn',
          category: 'motion',
          params: { speed: '60°/s', angle: '180°' },
        },
      ],
    },
    {
      id: 'routine_r3',
      robotId: 3,
      situationId: 'sit_1',
      blocks: [
        {
          id: 'blk_3_1',
          type: 'goalkeeper',
          category: 'tactical',
          params: { start: '[Post L]', stop: '[Post R]' },
        },
      ],
    },
  ],
};

export const defaultOffensiveStrategy: StrategyConfig = {
  id: 'strat_off_02',
  filename: 'strategy_offensive_02.json',
  name: 'Counter-Attack High Press',
  resolution: 'Medium (12x9)',
  activeSituationId: 'sit_1',
  situations: [
    {
      id: 'sit_1',
      name: 'Situation 1 (Attack Third)',
      priority: 'High Priority',
      minCol: 6,
      maxCol: 11,
      minRow: 1,
      maxRow: 7,
      selectedDots: [
        '7,2', '7,3', '7,4', '7,5', '7,6',
        '8,2', '8,3', '8,4', '8,5', '8,6',
        '9,2', '9,3', '9,4', '9,5', '9,6',
      ],
    },
  ],
  routines: [
    {
      id: 'routine_off_r1',
      robotId: 1,
      situationId: 'sit_1',
      blocks: [
        {
          id: 'blk_off_1',
          type: 'move',
          category: 'motion',
          params: { start: '[Midfield]', stop: '[Goal Box]', speed: '95%' },
        },
        {
          id: 'blk_off_2',
          type: 'kickA',
          category: 'kick',
          params: { threshold: '0.92', speed: '100%' },
        },
      ],
    },
    {
      id: 'routine_off_r2',
      robotId: 2,
      situationId: 'sit_1',
      blocks: [
        {
          id: 'blk_off_3',
          type: 'defender',
          category: 'tactical',
          params: { start: '[Center Circle]', stop: '[Support Pocket]' },
        },
      ],
    },
    {
      id: 'routine_off_r4',
      robotId: 4,
      situationId: 'sit_1',
      blocks: [
        {
          id: 'blk_off_4',
          type: 'turn',
          category: 'motion',
          params: { speed: '90°/s', angle: '45°' },
        },
        {
          id: 'blk_off_5',
          type: 'kickB',
          category: 'kick',
          params: { threshold: '0.70', speed: '85%' },
        },
      ],
    },
  ],
};

export const sampleStrategies: StrategyConfig[] = [
  defaultDefensiveStrategy,
  defaultOffensiveStrategy,
];
