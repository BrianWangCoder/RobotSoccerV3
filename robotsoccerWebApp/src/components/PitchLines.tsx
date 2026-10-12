import React from 'react';
import { FIELD } from '../sim/engine';

/** Team colours used on every pitch view (deliberately not red / blue). */
export const TEAM_COLORS = {
  us: '#fabc4d', // amber — our robots, our goal, our score
  them: '#f4f4f5', // white — opponents, their goal, their score
};

/** Background behind the pitch (the floor around the field). */
export const PITCH_SURROUND = '#1a1c1f';

/** Drawing extent of a pitch (field + goal recesses + margin), in mm — use as the SVG viewBox. */
export const PITCH_VIEWBOX = `${-FIELD.outerX} ${-FIELD.outerY} ${2 * FIELD.outerX} ${2 * FIELD.outerY}`;

/**
 * The real field, drawn in mm inside a PITCH_VIEWBOX svg: black playing surface enclosed by white
 * walls with angled corners, goals recessed behind the end walls, and the painted markings.
 */
export const PitchLines: React.FC = () => {
  const {
    halfX: X,
    halfY: Y,
    corner: k,
    goalHalfW,
    goalDepth,
    penaltyDepth,
    penaltyHalfW,
    goalAreaDepth,
    goalAreaHalfW,
    penaltyArcX,
    penaltyArcR,
    centerR,
    spots,
  } = FIELD;

  // Wall outline: rectangle with the four corners cut off
  const walls = [
    [-X + k, -Y],
    [X - k, -Y],
    [X, -Y + k],
    [X, Y - k],
    [X - k, Y],
    [-X + k, Y],
    [-X, Y - k],
    [-X, -Y + k],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(' ');

  const paint = {
    stroke: '#e5e7eb',
    strokeOpacity: 0.4,
    strokeWidth: 1.2,
    fill: 'none',
    vectorEffect: 'non-scaling-stroke' as const,
  };

  // The arc on the front of each penalty area (only the part outside the box is painted)
  const edge = penaltyDepth - penaltyArcX; // box edge, measured from the arc's centre
  const chord = Math.sqrt(Math.max(0, penaltyArcR ** 2 - edge ** 2));

  const end = (side: 1 | -1, goalColor: string) => {
    const g = side * X; // goal line
    const inward = -side; // direction into the field
    const box = (depth: number, halfW: number) =>
      `M ${g} ${-halfW} L ${g + inward * depth} ${-halfW} L ${g + inward * depth} ${halfW} L ${g} ${halfW}`;
    const ex = g + inward * penaltyDepth;
    return (
      <g>
        {/* goal recess behind the wall */}
        <rect
          x={side > 0 ? X : -X - goalDepth}
          y={-goalHalfW}
          width={goalDepth}
          height={2 * goalHalfW}
          fill="#050505"
          stroke={goalColor}
          strokeOpacity={0.85}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <path d={box(penaltyDepth, penaltyHalfW)} {...paint} />
        <path d={box(goalAreaDepth, goalAreaHalfW)} {...paint} />
        <path
          d={`M ${ex} ${-chord} A ${penaltyArcR} ${penaltyArcR} 0 0 ${side < 0 ? 1 : 0} ${ex} ${chord}`}
          {...paint}
        />
      </g>
    );
  };

  return (
    <g>
      {/* playing surface + walls */}
      <polygon points={walls} fill="#0b0c0d" />
      {end(-1, TEAM_COLORS.us)}
      {end(1, TEAM_COLORS.them)}
      <line x1={0} y1={-Y} x2={0} y2={Y} {...paint} />
      <circle cx={0} cy={0} r={centerR} {...paint} />
      <circle cx={0} cy={0} r={8} fill="#e5e7eb" fillOpacity={0.4} />
      {spots.flatMap(([sx, sy]) =>
        [
          [sx, sy],
          [-sx, sy],
          [sx, -sy],
          [-sx, -sy],
        ].map(([x, y]) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r={8} fill="#e5e7eb" fillOpacity={0.5} />
        ))
      )}
      <polygon
        points={walls}
        fill="none"
        stroke="#d4d4d8"
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
      />
      {/* keep the goal mouths open in the wall */}
      {[-1, 1].map((side) => (
        <line
          key={side}
          x1={side * X}
          y1={-goalHalfW}
          x2={side * X}
          y2={goalHalfW}
          stroke="#0b0c0d"
          strokeWidth={4}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
};
