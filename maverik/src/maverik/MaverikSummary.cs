using McpHost.Agents;
using McpHost.Config;
using McpHost.LlmModel;
using McpHost.Mcp;

namespace McpHost.Maverik;

// Per-agent aggregate over one run's cases — the "JMeter results pane" row. Computed on demand
// (never persisted as mutable state) so it always reflects the run's current progress, whether
// the run is still going or finished.
public sealed record AgentSummary(
    string AgentId,
    // null = ran against the live/current config — see AgentSelection. Lets the frontend label
    // "github-agent (v2)" vs "github-agent (v3)" as distinct rows when a batch ran several
    // versions of the same agent.
    int? Version,
    double PassRate,
    double AvgDurationMs,
    double? AvgInputTokens,
    double? AvgOutputTokens,
    double AvgIterations,
    double AvgToolCalls,
    double? AvgPeakContextTokens,
    long? MaxPeakContextTokens,
    double? AvgCacheReadInputTokens,
    double? AvgCacheCreationInputTokens,
    decimal? EstCostPerQuestion,
    decimal? EstCostTotal,
    decimal? EstToolCostPerQuestion,
    decimal? EstToolCostTotal,
    decimal? EstOverallCostTotal,
    int Errors,
    int CasesWithoutUsage,
    // From RunStatus.CapabilityBundles — null only if the run predates this field (old persisted
    // run.json) or the agent errored before its bundle was captured. See CapabilityBundle.
    string? CapabilityDigest,
    int? CapabilityToolCount);

// Judge-model token/cost overhead across the whole run — tracked separately so it never pollutes
// an agent's own metrics.
public sealed record JudgeOverheadSummary(
    long InputTokens,
    long OutputTokens,
    decimal? EstCost);

public sealed record RunSummary(
    string RunId,
    IReadOnlyList<AgentSummary> Agents,
    JudgeOverheadSummary JudgeOverhead);

// Builds a RunSummary from a RunStatus snapshot. Stateless, like CriterionEvaluator — reused by
// both the live GET .../summary endpoint and MaverikResultsWriter (which persists it to
// results/{runId}/summary.json once the run finishes).
public static class MaverikSummaryBuilder
{
    public static RunSummary Build(
        RunStatus run, MaverikSuiteRegistry suites, AgentRegistry agents, LLMModelRegistry models,
        McpServerRegistry mcp, ToolCostRegistry toolCosts, ConfigFileService configFiles)
    {
        var agentSummaries = run.AgentSelections
            .Select(sel => BuildAgentSummary(
                sel.AgentId, sel.Version,
                run.Results.Where(r => r.AgentId == sel.AgentId && r.Version == sel.Version).ToList(),
                agents, models, mcp, toolCosts, configFiles,
                run.CapabilityBundles.GetValueOrDefault(sel)))
            .ToList();

        return new RunSummary(run.RunId, agentSummaries, BuildJudgeOverhead(run, suites, models));
    }

    private static AgentSummary BuildAgentSummary(
        string agentId, int? version, IReadOnlyList<QuestionRunResult> cases, AgentRegistry agents, LLMModelRegistry models,
        McpServerRegistry mcp, ToolCostRegistry toolCosts, ConfigFileService configFiles, CapabilityBundle? bundle)
    {
        var agent = AgentVersionResolver.Resolve(agentId, version, agents, configFiles);

        var errors = cases.Count(c => c.Error != null);
        // An errored case never reached evaluation — excluded from every average below so one
        // blown-up case doesn't skew the numbers for the rest.
        var evaluated = cases.Where(c => c.Error == null).ToList();

        var passRate = evaluated.Count == 0 ? 0.0 : evaluated.Count(c => c.Passed) / (double)evaluated.Count;
        var avgDurationMs = evaluated.Count == 0 ? 0.0 : evaluated.Average(c => c.DurationMs);
        var avgIterations = evaluated.Count == 0 ? 0.0 : evaluated.Average(c => c.Iterations);
        var avgToolCalls = evaluated.Count == 0 ? 0.0 : evaluated.Average(c => c.ToolCallCount);

        // Token usage is null (not 0) when a provider reports none — average only over cases
        // that actually have it, and surface how many didn't separately.
        var withUsage = evaluated.Where(c => c.InputTokens is not null && c.OutputTokens is not null).ToList();
        var casesWithoutUsage = evaluated.Count - withUsage.Count;
        double? avgInputTokens = withUsage.Count == 0 ? null : withUsage.Average(c => c.InputTokens!.Value);
        double? avgOutputTokens = withUsage.Count == 0 ? null : withUsage.Average(c => c.OutputTokens!.Value);

        var withPeakContext = evaluated.Where(c => c.PeakContextTokens is not null).ToList();
        double? avgPeakContextTokens = withPeakContext.Count == 0 ? null : withPeakContext.Average(c => c.PeakContextTokens!.Value);
        long? maxPeakContextTokens = withPeakContext.Count == 0 ? null : withPeakContext.Max(c => c.PeakContextTokens!.Value);

        // Cache tokens are null for every case unless the agent opted in (AgentConfig.PromptCaching)
        // — same "average only over cases that have it" convention as the token averages above.
        var withCacheRead = evaluated.Where(c => c.CacheReadInputTokens is not null).ToList();
        double? avgCacheReadInputTokens = withCacheRead.Count == 0 ? null : withCacheRead.Average(c => c.CacheReadInputTokens!.Value);
        var withCacheCreation = evaluated.Where(c => c.CacheCreationInputTokens is not null).ToList();
        double? avgCacheCreationInputTokens = withCacheCreation.Count == 0 ? null : withCacheCreation.Average(c => c.CacheCreationInputTokens!.Value);

        decimal? estCostPerQuestion = null;
        decimal? estCostTotal = null;
        var pricing = models.ResolveConfig(agent.Model);
        if (pricing is { InputPricePerMTok: not null, OutputPricePerMTok: not null } && withUsage.Count > 0)
        {
            // Always prices cache writes at the 5m multiplier, regardless of which TTL the agent
            // actually configured (QuestionRunResult doesn't record per-case TTL) — a known,
            // documented simplification; a 1h-cached agent's write cost will read slightly low.
            var cacheMultipliers = pricing is
            {
                CacheReadMultiplier: { } readMul,
                CacheWriteMultiplier: { } writeMul
            }
                ? (ReadMultiplier: readMul, CreationMultiplier: writeMul)
                : ((decimal ReadMultiplier, decimal CreationMultiplier)?)null;

            var costs = withUsage
                .Select(c => cacheMultipliers is not null
                    ? CacheAwareTokenCost(
                        c.InputTokens!.Value, c.OutputTokens!.Value,
                        c.CacheReadInputTokens ?? 0, c.CacheCreationInputTokens ?? 0,
                        pricing.InputPricePerMTok!.Value, pricing.OutputPricePerMTok!.Value,
                        cacheMultipliers.Value.ReadMultiplier, cacheMultipliers.Value.CreationMultiplier)
                    : TokenCost(c.InputTokens!.Value, c.OutputTokens!.Value,
                        pricing.InputPricePerMTok!.Value, pricing.OutputPricePerMTok!.Value))
                .ToList();
            estCostPerQuestion = costs.Average();
            estCostTotal = costs.Sum();
        }

        // Resolve each case's tool calls to their owning server SCOPED to this agent's allowed
        // servers (agent.McpServers) — the same scoping McpServerRegistry.ToolsForServers uses —
        // so a same-named tool on a server this agent doesn't use can't be mis-attributed.
        var toolServerByName = agent.McpServers
            .SelectMany(server => mcp.ToolsByServer.TryGetValue(server, out var tools)
                ? tools.Select(t => (Server: server, t.Name))
                : [])
            .GroupBy(t => t.Name)
            .ToDictionary(g => g.Key, g => g.First().Server);

        decimal? estToolCostPerQuestion = null;
        decimal? estToolCostTotal = null;
        if (evaluated.Count > 0)
        {
            var toolCostsPerCase = evaluated
                .Select(c => c.ToolNames.Sum(name =>
                    toolServerByName.TryGetValue(name, out var server) ? toolCosts.CostOf(server, name) : 0m))
                .ToList();
            estToolCostPerQuestion = toolCostsPerCase.Average();
            estToolCostTotal = toolCostsPerCase.Sum();
        }

        decimal? estOverallCostTotal = estCostTotal is null && estToolCostTotal is null
            ? null
            : (estCostTotal ?? 0m) + (estToolCostTotal ?? 0m);

        return new AgentSummary(
            agentId, version, passRate, avgDurationMs, avgInputTokens, avgOutputTokens, avgIterations, avgToolCalls,
            avgPeakContextTokens, maxPeakContextTokens, avgCacheReadInputTokens, avgCacheCreationInputTokens,
            estCostPerQuestion, estCostTotal, estToolCostPerQuestion, estToolCostTotal, estOverallCostTotal,
            errors, casesWithoutUsage, bundle?.Digest, bundle?.ToolCount);
    }

    // Per-criterion judgeModel overrides aren't recorded per-case, only tokens — so the suite's
    // top-level JudgeModel is used for pricing. A run whose questions mix judge models will get
    // an approximate cost here; tokens themselves are always exact.
    private static JudgeOverheadSummary BuildJudgeOverhead(RunStatus run, MaverikSuiteRegistry suites, LLMModelRegistry models)
    {
        var inputTokens = run.Results.Sum(c => c.JudgeInputTokens ?? 0);
        var outputTokens = run.Results.Sum(c => c.JudgeOutputTokens ?? 0);

        decimal? estCost = null;
        var pricing = models.ResolveConfig(suites.Resolve(run.SuiteId).JudgeModel);
        if (pricing is { InputPricePerMTok: not null, OutputPricePerMTok: not null } && (inputTokens > 0 || outputTokens > 0))
        {
            estCost = TokenCost(inputTokens, outputTokens, pricing.InputPricePerMTok!.Value, pricing.OutputPricePerMTok!.Value);
        }

        return new JudgeOverheadSummary(inputTokens, outputTokens, estCost);
    }

    internal static decimal TokenCost(long inputTokens, long outputTokens, decimal inputPricePerMTok, decimal outputPricePerMTok) =>
        inputTokens / 1_000_000m * inputPricePerMTok + outputTokens / 1_000_000m * outputPricePerMTok;

    // InputTokenCount already INCLUDES cache-read tokens (see QuestionRunResult.CacheReadInputTokens)
    // — subtract before pricing the non-cached remainder, or cache reads get double-billed at the
    // full input rate. Cache-creation tokens are reported separately (NOT part of InputTokenCount)
    // and priced at the write premium on top.
    internal static decimal CacheAwareTokenCost(
        long inputTokens, long outputTokens, long cacheReadTokens, long cacheCreationTokens,
        decimal inputPricePerMTok, decimal outputPricePerMTok,
        decimal cacheReadMultiplier, decimal cacheCreationMultiplier)
    {
        var nonCachedInput = Math.Max(0, inputTokens - cacheReadTokens);
        return nonCachedInput / 1_000_000m * inputPricePerMTok
             + outputTokens / 1_000_000m * outputPricePerMTok
             + cacheReadTokens / 1_000_000m * inputPricePerMTok * cacheReadMultiplier
             + cacheCreationTokens / 1_000_000m * inputPricePerMTok * cacheCreationMultiplier;
    }
}
