// One-shot beeswarm layout via a d3-force simulation ticked to convergence synchronously (no
// animation loop) — the standard technique for a static beeswarm, and needs no library beyond
// what the `d3` package already bundles (d3-force ships inside the full `d3` meta-package).
import * as d3 from "d3";

export function beeswarm(values, xScale, laneCenterY, radius) {
  const nodes = values.map((v) => ({ value: v, x: xScale(v), y: laneCenterY }));
  const sim = d3.forceSimulation(nodes)
    .force("x", d3.forceX((d) => xScale(d.value)).strength(1))
    .force("y", d3.forceY(laneCenterY).strength(0.15))
    .force("collide", d3.forceCollide(radius + 1))
    .stop();
  for (let i = 0; i < 140; i++) sim.tick();
  return nodes;
}
