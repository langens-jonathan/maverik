using McpHost.Config;

namespace McpHost.Agents;

// The one seam "get me this agent's config" goes through when a caller needs to be
// version-aware — live registry when Version is null (today's behavior, unchanged), a frozen
// historical snapshot (see AgentVersionSnapshot) otherwise. MaverikRunner, MaverikSummaryBuilder,
// and MaverikResultsWriter all call this instead of AgentRegistry.Resolve directly, so live-vs-
// versioned resolution is never reimplemented per call site.
public static class AgentVersionResolver
{
    public static AgentConfig Resolve(string agentId, int? version, AgentRegistry agents, ConfigFileService configFiles) =>
        version is null
            ? agents.Resolve(agentId)
            : (configFiles.LoadAgentVersion(agentId, version.Value)?.Config
                ?? throw new InvalidOperationException($"No version {version} for agent '{agentId}'."));
}
