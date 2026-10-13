/*
 * Scratch-style C loops in a flat block list.
 *
 * A loop is stored as a 'loop' header block (it holds the repeat count) and a matching 'loopEnd'
 * block; every block between them is inside the loop. Loops can be nested. Keeping the list flat
 * means a stack is still just an ordered array — drag & drop, copy/paste and saving all keep
 * working on plain indexes — while the workspace draws it as a C shape.
 */

type Typed = { type: string };

/** Index of the 'loopEnd' that closes the loop opened at `start`, or -1 if it's unclosed. */
export const loopEndOf = (blocks: Typed[], start: number): number => {
  let depth = 0;
  for (let i = start; i < blocks.length; i++) {
    if (blocks[i].type === 'loop') depth++;
    else if (blocks[i].type === 'loopEnd' && --depth === 0) return i;
  }
  return -1;
};

/** Index of the 'loop' header that `end` (a 'loopEnd') closes, or -1 if it has none. */
export const loopStartOf = (blocks: Typed[], end: number): number => {
  let depth = 0;
  for (let i = end; i >= 0; i--) {
    if (blocks[i].type === 'loopEnd') depth++;
    else if (blocks[i].type === 'loop' && --depth === 0) return i;
  }
  return -1;
};

/**
 * Where the run of blocks starting at `from` stops: just before the 'loopEnd' of the innermost
 * loop that contains `from` (or the end of the stack). Grabbing a block takes it plus everything
 * below it up to there — like Scratch, the blocks below stay inside their loop.
 */
export const runEnd = (blocks: Typed[], from: number): number => {
  let depth = 0;
  for (let i = from; i < blocks.length; i++) {
    if (blocks[i].type === 'loop') depth++;
    else if (blocks[i].type === 'loopEnd') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return blocks.length;
};

/** How many loops each block sits inside (headers and end bars count as their outer level). */
export const loopDepths = (blocks: Typed[]): number[] => {
  let depth = 0;
  return blocks.map((b) => {
    if (b.type === 'loopEnd') depth = Math.max(0, depth - 1);
    const d = depth;
    if (b.type === 'loop') depth++;
    return d;
  });
};

/** A block plus, for a loop header, its whole body and end bar (what copying / deleting acts on). */
export const blockSpan = (blocks: Typed[], index: number): [number, number] => {
  if (blocks[index]?.type === 'loop') {
    const end = loopEndOf(blocks, index);
    if (end >= 0) return [index, end + 1];
  }
  return [index, index + 1];
};
