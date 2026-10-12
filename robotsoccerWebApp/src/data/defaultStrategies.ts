import { StrategyConfig } from '../types/strategy';

/** A fresh, empty strategy: one undrawn situation and no block routines. */
export const createBlankStrategy = (): StrategyConfig => ({
  id: 'strat_blank',
  filename: 'strategy.json',
  name: 'New Strategy',
  resolution: 'Medium (12x9)',
  activeSituationId: 'sit_1',
  situations: [
    {
      id: 'sit_1',
      name: 'Situation 1',
      priority: 'Medium Priority',
      minCol: 0,
      maxCol: 0,
      minRow: 0,
      maxRow: 0,
      selectedDots: [],
    },
  ],
  routines: [],
});
