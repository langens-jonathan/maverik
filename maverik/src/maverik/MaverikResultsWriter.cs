using System.Text;
using System.Text.Json;

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

    public async Task WriteAsync(RunStatus run, CancellationToken ct)
    {
        try
        {
            var dir = Path.Combine(contentRootPath, "results", Sanitize(run.RunId));
            Directory.CreateDirectory(dir);

            await File.WriteAllTextAsync(
                Path.Combine(dir, "run.json"),
                JsonSerializer.Serialize(run, JsonOptions), ct);

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
        sb.AppendLine("agentId,questionId,repetition,durationMs,inputTokens,outputTokens,iterations,toolCalls,passed,error");
        foreach (var r in results)
        {
            sb.AppendLine(string.Join(',',
                Escape(r.AgentId),
                Escape(r.QuestionId),
                r.Repetition,
                r.DurationMs,
                r.InputTokens,          // null renders as empty — "unknown", not 0
                r.OutputTokens,
                r.Iterations,
                r.ToolCallCount,
                r.Passed,
                Escape(r.Error)));
        }
        return sb.ToString();
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
