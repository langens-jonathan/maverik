namespace McpHost.Agents;

// One explicitly-cut, immutable historical copy of an agent's config — the artifact
// "Cut new version" (POST /api/config/agents/{id}/versions) produces. Distinct from a MAVERIK
// SuiteRunRecord.AgentSnapshot (see McpHost.Maverik.MaverikModels), which freezes a config only
// because it happened to be run through a benchmark suite; this freezes a config because the
// user deliberately said "remember this one" — covers chat-only agents too, and doesn't require
// ever running anything.
public sealed record AgentVersionSnapshot(string AgentId, int Version, DateTimeOffset CutAt, AgentConfig Config);
