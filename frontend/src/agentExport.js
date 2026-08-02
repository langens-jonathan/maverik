// Client-side "download this agent config as JSON" — reuses the same Blob + synthetic-<a>
// download mechanism as reportExport.js's CSV/PDF export.
import { triggerDownload } from "./reportExport.js";

// `agent` must already be self-contained (systemPrompt inlined, not left null for a file-based
// prompt) — callers are responsible for that, the same way duplicateAgent() already resolves it
// before copying. Passing `version`/`cutAt` marks this as one specific cut version rather than
// the live/current config, both in the filename and in the payload itself.
export function exportAgentJson(agent, { version, cutAt } = {}) {
  const payload = version != null ? { version, cutAt, ...agent } : agent;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const slug = (agent.name || agent.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const filename = version != null ? `${slug}.v${version}.json` : `${slug}.json`;
  triggerDownload(blob, filename);
}
