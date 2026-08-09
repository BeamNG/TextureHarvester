
import { TX } from "../tx.js";

const nextPowerOfTwo = n => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

function shelfPack(items, options) {
  const opts = options || {};
  const padding = Math.max(0, opts.padding || 0);
  const sorted = items.slice().sort((a, b) => b.height - a.height || b.width - a.width);

  let maxWidth = opts.maxWidth;
  if (!maxWidth || maxWidth <= 0) {
    const area = items.reduce((n, i) => n + (i.width + padding) * (i.height + padding), 0);
    const widest = items.reduce((n, i) => Math.max(n, i.width + padding), 1);
    maxWidth = Math.max(widest, Math.ceil(Math.sqrt(area) * 1.05));
    if (opts.powerOfTwo) maxWidth = nextPowerOfTwo(maxWidth);
  }

  const placements = [];
  let x = padding;
  let y = padding;
  let rowHeight = 0;
  let usedWidth = 0;

  for (const item of sorted) {
    if (x > padding && x + item.width + padding > maxWidth) {
      y += rowHeight + padding;
      x = padding;
      rowHeight = 0;
    }
    placements.push({ id: item.id, x, y });
    x += item.width + padding;
    rowHeight = Math.max(rowHeight, item.height);
    usedWidth = Math.max(usedWidth, x);
  }

  let width = Math.max(1, Math.ceil(usedWidth));
  let height = Math.max(1, Math.ceil(y + rowHeight + padding));
  if (opts.powerOfTwo) {
    width = nextPowerOfTwo(width);
    height = nextPowerOfTwo(height);
  }

  return { placements, width, height };
}

TX.pack = { shelfPack, nextPowerOfTwo };

