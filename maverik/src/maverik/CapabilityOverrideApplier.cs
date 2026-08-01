using Microsoft.Extensions.AI;
using Anthropic.Models.Messages;

namespace McpHost.Maverik;

// Turns an (agent's ordered tools + description overrides) into the AITool list actually sent to
// the model — TurnRequest.PresentationTools. An overridden tool becomes a raw
// Anthropic.Models.Messages.Tool (the only way to carry a different Description than the live MCP
// server reports) wrapped via AsAITool(); this wrapper has no InvokeAsync, so it must never be
// used for dispatch — see TurnRequest.PresentationTools/InvokeToolAsync in LoopStrategy.cs, which
// always dispatches against the unmodified Tools list instead.
public static class CapabilityOverrideApplier
{
    public static IReadOnlyList<AITool> Apply(
        IReadOnlyList<(string Server, AIFunction Tool)> orderedTools,
        IReadOnlyDictionary<(string Server, string Tool), string> descriptionOverrides) =>
        orderedTools
            .Select(t => descriptionOverrides.TryGetValue((t.Server, t.Tool.Name), out var overriddenDescription)
                ? ToOverriddenTool(t.Tool, overriddenDescription)
                : (AITool)t.Tool)
            .ToList();

    private static AITool ToOverriddenTool(AIFunction source, string overriddenDescription)
    {
        var schemaDict = new Dictionary<string, System.Text.Json.JsonElement>();
        foreach (var prop in source.JsonSchema.EnumerateObject())
            schemaDict[prop.Name] = prop.Value;

        var tool = new Tool
        {
            Name = source.Name,
            Description = overriddenDescription,
            InputSchema = InputSchema.FromRawUnchecked(schemaDict),
        };

        ToolUnion union = tool;
        return union.AsAITool();
    }
}
