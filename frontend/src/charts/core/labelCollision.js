// Greedy direct-label placement for a scatter/point chart: try 8 compass directions at increasing
// distance from each point until a spot clear of every point-circle and every already-placed
// label is found. Deterministic, no new dependency (no d3-labeler or similar), and workable at
// small point counts (single-digit to low tens) — the "few points" branch of the dataviz
// direct-labeling guidance, not a general-purpose force-directed label layout. Points need only a
// `.label` string; `cx`/`cy`/`radius` are accessor functions so this stays chart-agnostic.
const COMPASS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

function boxesOverlap(a, b) {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

export function placeLabels(points, cx, cy, radius) {
  const obstacles = points.map((p) => {
    const r = radius(p);
    return { x1: cx(p) - r, y1: cy(p) - r, x2: cx(p) + r, y2: cy(p) + r };
  });
  return points.map((p) => {
    const r = radius(p);
    const w = p.label.length * 6.4 + 8;
    const h = 14;
    let box = null;
    for (const dist of [r + 8, r + 20, r + 34, r + 50, r + 68]) {
      for (const [dx, dy] of COMPASS) {
        const bx = cx(p) + dx * dist - (dx === 0 ? w / 2 : dx > 0 ? -2 : w + 2);
        const by = cy(p) + dy * dist - (dy === 0 ? h / 2 : dy > 0 ? -2 : h + 2);
        const candidate = { x1: bx, y1: by, x2: bx + w, y2: by + h };
        if (!obstacles.some((o) => boxesOverlap(o, candidate))) {
          box = candidate;
          break;
        }
      }
      if (box) break;
    }
    if (!box) box = { x1: cx(p) - w / 2, y1: cy(p) - r - h - 4, x2: cx(p) + w / 2, y2: cy(p) - r - 4 };
    obstacles.push(box);
    return { ...p, labelX: (box.x1 + box.x2) / 2, labelY: box.y1 + h - 3 };
  });
}
