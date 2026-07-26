using System.Text;
using System.Text.Json;
using McpHost.Agents;

namespace McpHost.Maverik;

// Persists a finished run to results/{runId}/: run.json (the full RunStatus, per-case detail
// included) and summary.csv (one row per case, ready for Excel/pandas). A write failure is
// logged but never fails the run itself — the results still live in the in-memory store.
public sealed class MaverikResultsWriter(string contentRootPath, ILogger<MaverikResultsWriter> log)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    // Rehydrates MaverikRunStore from results/*/run.json at startup — results/ is the single
    // source of truth (no DB), the in-memory store is just a fast index rebuilt from it every
    // time the process starts, so run history survives a container restart. Only completed runs
    // are ever written to disk (see WriteAsync's call site in MaverikRunner), so every folder
    // found here is inherently a finished run — nothing "queued"/"running" to reconcile. A
    // folder with a missing or corrupt run.json is skipped with a warning rather than failing
    // startup; losing one historical run is far better than the host not starting.
    public IReadOnlyList<RunStatus> LoadAll()
    {
        var runs = new List<RunStatus>();
        var resultsDir = Path.Combine(contentRootPath, "results");
        if (!Directory.Exists(resultsDir))
            return runs;

        foreach (var dir in Directory.GetDirectories(resultsDir))
        {
            // suite-runs/ lives alongside the per-run folders but isn't one itself.
            if (Path.GetFileName(dir) == "suite-runs")
                continue;

            var path = Path.Combine(dir, "run.json");
            if (!File.Exists(path))
                continue;

            try
            {
                var run = JsonSerializer.Deserialize<RunStatus>(File.ReadAllText(path), JsonOptions);
                if (run is not null)
                    runs.Add(run);
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Skipping unreadable run.json in '{Dir}'.", dir);
            }
        }

        log.LogInformation("Rehydrated {Count} run(s) from {Dir}.", runs.Count, resultsDir);
        return runs;
    }

    public async Task WriteAsync(RunStatus run, RunSummary summary, CancellationToken ct)
    {
        try
        {
            var dir = Path.Combine(contentRootPath, "results", Sanitize(run.RunId));
            Directory.CreateDirectory(dir);

            await File.WriteAllTextAsync(
                Path.Combine(dir, "run.json"),
                JsonSerializer.Serialize(run, JsonOptions), ct);

            await File.WriteAllTextAsync(
                Path.Combine(dir, "summary.json"),
                JsonSerializer.Serialize(summary, JsonOptions), ct);

            await File.WriteAllTextAsync(
                Path.Combine(dir, "summary.csv"),
                ToCsv(run.Results), ct);

            log.LogInformation("Run '{RunId}' written to {Dir}.", run.RunId, dir);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Failed to write results for run '{RunId}'.", run.RunId);
        }
    }

    private static string ToCsv(IReadOnlyList<QuestionRunResult> results)
    {
        var sb = new StringBuilder();
        sb.AppendLine("agentId,questionId,repetition,durationMs,inputTokens,outputTokens,peakContextTokens,iterations,toolCalls,passed,error");
        foreach (var r in results)
        {
            sb.AppendLine(string.Join(',',
                Escape(r.AgentId),
                Escape(r.QuestionId),
                r.Repetition,
                r.DurationMs,
                r.InputTokens,          // null renders as empty — "unknown", not 0
                r.OutputTokens,
                r.PeakContextTokens,
                r.Iterations,
                r.ToolCallCount,
                r.Passed,
                Escape(r.Error)));
        }
        return sb.ToString();
    }

    // The comparison-ready artifact: one small JSON file per agent in the batch, named so it's
    // individually addressable by (suite, agent, point in time) — see SuiteRunRecord. Written
    // alongside the existing batch output, not instead of it; a write failure here follows the
    // same "log and move on" policy as WriteAsync above.
    public async Task WriteSuiteRunRecordsAsync(RunStatus run, RunSummary summary, AgentRegistry agents, CancellationToken ct)
    {
        try
        {
            var dir = Path.Combine(contentRootPath, "results", "suite-runs");
            Directory.CreateDirectory(dir);

            foreach (var agentSummary in summary.Agents)
            {
                var record = new SuiteRunRecord(
                    run.SuiteId,
                    agentSummary.AgentId,
                    agents.Resolve(agentSummary.AgentId),
                    run.CreatedAt,
                    run.RunId,
                    run.JudgedMetrics,
                    agentSummary,
                    run.Results.Where(r => r.AgentId == agentSummary.AgentId).ToList());

                var fileName = $"{Sanitize(run.SuiteId)}--{Sanitize(agentSummary.AgentId)}--{run.CreatedAt:yyyyMMdd-HHmmss}.json";
                await File.WriteAllTextAsync(Path.Combine(dir, fileName), JsonSerializer.Serialize(record, JsonOptions), ct);
            }

            log.LogInformation("Run '{RunId}' wrote {Count} suite-run record(s) to {Dir}.", run.RunId, summary.Agents.Count, dir);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Failed to write suite-run records for run '{RunId}'.", run.RunId);
        }
    }

    // Minimal CSV quoting: wrap when the value contains a delimiter/quote/newline (error
    // messages often do), doubling embedded quotes.
    private static string Escape(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        return value.IndexOfAny([',', '"', '\n', '\r']) < 0
            ? value
            : "\"" + value.Replace("\"", "\"\"") + "\"";
    }

    private static string Sanitize(string s) =>
        string.Concat(s.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' ? c : '_'));
}
