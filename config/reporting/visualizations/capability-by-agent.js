// Table: each agent's current tool-catalog identity — tool count and a content-hashed digest of
// exactly which tools/descriptions/schemas/order it sends (see CapabilityBundle on the backend).
// Unlike the numeric metrics in metrics-by-agent.js, a digest isn't a value to average — this
// shows the most recent record's snapshot per agent, plus whether the digest was stable or
// changed across every selected record, the visual counterpart to the capability-digest CI check
// documented in CI-CD Tutorial.md. See ../README.md for the function contract.
export const layout = "full";
export default function (container, data, { d3 }) {
  if (data.length === 0) {
    container.textContent = "No runs selected.";
    return;
  }

  const byAgent = new Map();
  for (const r of data) {
    if (!byAgent.has(r.agentId)) byAgent.set(r.agentId, []);
    byAgent.get(r.agentId).push(r);
  }

  const rows = [...byAgent.entries()]
    .map(([agentId, records]) => {
      const sorted = [...records].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const current = sorted[0].summary;
      const distinctDigests = new Set(records.map((r) => r.summary.capabilityDigest).filter(Boolean));
      return {
        agentId,
        toolCount: current.capabilityToolCount,
        digest: current.capabilityDigest,
        stability: distinctDigests.size === 0 ? "-" : distinctDigests.size === 1 ? "stable" : `changed (${distinctDigests.size} distinct)`,
      };
    })
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  function shortDigest(d) {
    if (!d) return "-";
    return d.startsWith("sha256:") ? d.slice(7, 15) : d.slice(0, 8);
  }

  const columns = [
    ["Agent", (r) => r.agentId],
    ["Tools", (r) => (r.toolCount ?? "-")],
    ["Digest", (r) => shortDigest(r.digest)],
    ["Stability", (r) => r.stability],
  ];

  const table = d3.select(container).append("table");

  table
    .append("thead")
    .append("tr")
    .selectAll("th")
    .data(columns)
    .join("th")
    .text(([label]) => label);

  table
    .append("tbody")
    .selectAll("tr")
    .data(rows)
    .join("tr")
    .selectAll("td")
    .data((row) => columns.map(([label, get]) => ({ label, value: get(row), row })))
    .join("td")
    .attr("class", (d) => (d.label === "Digest" ? "mono" : null))
    .attr("title", (d) => (d.label === "Digest" ? d.row.digest ?? "" : null))
    .text((d) => d.value);
}
