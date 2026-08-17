using System.Text.Json;
using Microsoft.Extensions.AI;

namespace McpHost.Loop;

// The "cutoff" context-management strategy's mechanism: drop the oldest messages once usage
// crosses a threshold fraction of the effective max context window. Also the fallback mechanism
// the "compaction" strategy uses today (see LoopStrategy.cs) since no provider's native
// compaction is wired up yet.
//
// No tokenizer exists anywhere in this codebase, and adding one just to fake per-message token
// counts would be exactly the kind of fabricated instrumentation this project avoids elsewhere.
// So this works only off what's actually real: the caller's last known aggregate token total
// (a real, provider-reported number from response.Usage). That total is distributed across
// messages proportionally by character length purely to decide *how many whole exchanges to
// drop* — never surfaced anywhere as a claimed per-message token count.
public static class ContextCutoff
{
    // Matches the behavior described for this feature: trigger at 90% of the effective max, and
    // trim back down to just under that same 90% line (not some lower safety buffer).
    public const double TriggerFraction = 0.9;

    // Returns true if history was actually trimmed. No-ops (returns false) whenever there isn't
    // enough information to act safely: no known ceiling, no known current usage, or nothing
    // droppable without touching the system message or the live in-flight exchange.
    public static bool TrimIfNeeded(List<ChatMessage> history, long? currentEstimateTokens, int? effectiveMaxContextTokens)
    {
        if (effectiveMaxContextTokens is not { } max || max <= 0)
            return false;
        if (currentEstimateTokens is not { } estimate)
            return false;

        var threshold = max * TriggerFraction;
        if (estimate < threshold)
            return false;

        // Every exchange unit starts at a ChatRole.User message and runs through every
        // following Assistant/Tool message up to (not including) the next User message. Both
        // OpenAI- and Anthropic-style wire formats require a tool-call and its tool-result to
        // stay paired, so units — never individual messages — are the smallest thing safe to
        // drop. history[0] (the system message) is never part of a unit and never dropped.
        var units = GroupIntoExchangeUnits(history);
        if (units.Count <= 1)
            return false; // only the live exchange exists — dropping it would corrupt the turn in progress

        var unitChars = units.Select(u => CharCount(history, u.Start, u.End)).ToList();
        var totalChars = unitChars.Sum();
        if (totalChars == 0)
            return false;

        var remaining = (double)estimate;
        var dropCount = 0;
        for (var i = 0; i < units.Count - 1; i++) // never consider the last (most recent/live) unit
        {
            if (remaining < threshold)
                break;
            remaining -= estimate * (unitChars[i] / (double)totalChars);
            dropCount++;
        }

        if (dropCount == 0)
            return false;

        var cutThroughIndex = units[dropCount - 1].End; // last message index being removed, inclusive
        history.RemoveRange(1, cutThroughIndex); // keep index 0 (system message); drop [1, cutThroughIndex]
        return true;
    }

    private static List<(int Start, int End)> GroupIntoExchangeUnits(List<ChatMessage> history)
    {
        var units = new List<(int Start, int End)>();
        for (var i = 1; i < history.Count; i++) // index 0 is always the system message
        {
            if (units.Count == 0 || history[i].Role == ChatRole.User)
                units.Add((i, i));
            else
                units[^1] = (units[^1].Start, i);
        }
        return units;
    }

    private static int CharCount(List<ChatMessage> history, int start, int end)
    {
        var total = 0;
        for (var i = start; i <= end; i++)
            total += MessageCharCount(history[i]);
        return total;
    }

    // Text content covers plain conversation turns; function calls/results (the bulk of a
    // tool-heavy exchange) carry their real weight too via their serialized arguments/result
    // rather than being invisible to the estimate — undercounting those is exactly the kind of
    // skew that would make the drop-count heuristic worthless for tool-call-heavy history.
    private static int MessageCharCount(ChatMessage message)
    {
        var total = 0;
        foreach (var content in message.Contents)
        {
            total += content switch
            {
                TextContent t => t.Text?.Length ?? 0,
                FunctionCallContent c => c.Name.Length + (c.Arguments is null ? 0 : JsonSerializer.Serialize(c.Arguments).Length),
                FunctionResultContent r => r.Result?.ToString()?.Length ?? 0,
                _ => content.ToString()?.Length ?? 0,
            };
        }
        return total;
    }
}
