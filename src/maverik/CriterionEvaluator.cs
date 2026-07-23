using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.AI;
using McpHost.LlmModel;

namespace McpHost.Maverik;

// The outcome of judging one answer. Judge token fields are only set by llm-judge and are
// tracked SEPARATELY from the agent's metrics — judging is an operating cost of testing,
// never part of the agent's score.
public sealed record EvaluationResult(
    bool Passed,
    string? Detail,
    long? JudgeInputTokens,
    long? JudgeOutputTokens);

// Decides whether an agent's final answer satisfies a question's criterion. The three
// deterministic types (exact, contains, regex) are pure string checks; llm-judge sends the
// rubric + answer to a judge model on a fresh, tool-less conversation and expects a strict
// JSON verdict back.
//
// Criterion shape is validated at startup by MaverikSuiteRegistry, so this class can assume
// the per-type required fields are present.
public sealed class CriterionEvaluator(LLMModelRegistry models)
{
    public async Task<EvaluationResult> EvaluateAsync(
        MaverikQuestion question, string finalAnswer, string? suiteJudgeModel, CancellationToken ct)
    {
        var criterion = question.Criterion
            ?? throw new InvalidOperationException($"Question '{question.Id}' has no criterion.");

        var comparison = criterion.CaseSensitive
            ? StringComparison.Ordinal
            : StringComparison.OrdinalIgnoreCase;

        switch (criterion.Type.ToLowerInvariant())
        {
            case "exact":
            {
                var passed = string.Equals(finalAnswer.Trim(), criterion.Expected!.Trim(), comparison);
                return new EvaluationResult(passed,
                    passed ? null : $"expected exactly '{criterion.Expected}', got '{Truncate(finalAnswer.Trim())}'",
                    null, null);
            }

            case "contains":
            {
                var passed = finalAnswer.Contains(criterion.Expected!, comparison);
                return new EvaluationResult(passed,
                    passed ? null : $"answer does not contain '{criterion.Expected}'",
                    null, null);
            }

            case "regex":
            {
                var passed = Regex.IsMatch(finalAnswer, criterion.Pattern!);
                return new EvaluationResult(passed,
                    passed ? null : $"answer does not match /{criterion.Pattern}/",
                    null, null);
            }

            case "llm-judge":
                return await JudgeAsync(question, criterion, finalAnswer, suiteJudgeModel, ct);

            default:
                // Unreachable for suites that came through MaverikSuiteRegistry validation.
                throw new InvalidOperationException(
                    $"Question '{question.Id}' has unknown criterion type '{criterion.Type}'.");
        }
    }

    private async Task<EvaluationResult> JudgeAsync(
        MaverikQuestion question, MaverikCriterion criterion, string finalAnswer,
        string? suiteJudgeModel, CancellationToken ct)
    {
        // Criterion-level judgeModel wins over the suite's; validated resolvable at startup.
        var judge = models.Resolve(criterion.JudgeModel ?? suiteJudgeModel);

        // A fresh two-message conversation every time: no tools, no history, temperature 0
        // (where the provider honors it) for repeatable verdicts.
        List<ChatMessage> messages =
        [
            new(ChatRole.System,
                "You are a strict test evaluator. Judge the answer ONLY against the rubric. " +
                "Reply with ONLY this JSON and nothing else: " +
                "{\"verdict\": \"PASS\" or \"FAIL\", \"reasoning\": \"one short sentence\"}"),
            new(ChatRole.User,
                $"## Question asked to the agent\n{question.Text}\n\n" +
                $"## Rubric\n{criterion.Rubric}\n\n" +
                $"## Answer to evaluate\n{finalAnswer}"),
        ];

        var response = await judge.GetResponseAsync(messages, new ChatOptions { Temperature = 0 }, ct);

        var (passed, detail) = ParseVerdict(response.Text);
        return new EvaluationResult(passed, detail,
            response.Usage?.InputTokenCount, response.Usage?.OutputTokenCount);
    }

    // Pull the verdict out of the judge's reply. Models sometimes wrap JSON in ```json fences
    // or add prose around it, so parse the outermost {...} span rather than the raw text. An
    // unparseable reply FAILS the case (with the raw output preserved for debugging) rather
    // than throwing — one flaky judge reply must not kill a run.
    private static (bool Passed, string? Detail) ParseVerdict(string text)
    {
        var start = text.IndexOf('{');
        var end = text.LastIndexOf('}');
        if (start < 0 || end <= start)
            return (false, $"judge output unparseable: {Truncate(text)}");

        try
        {
            using var doc = JsonDocument.Parse(text[start..(end + 1)]);

            if (!doc.RootElement.TryGetProperty("verdict", out var verdict) ||
                verdict.ValueKind != JsonValueKind.String)
                return (false, $"judge output has no verdict: {Truncate(text)}");

            var passed = string.Equals(verdict.GetString(), "PASS", StringComparison.OrdinalIgnoreCase);

            var reasoning = doc.RootElement.TryGetProperty("reasoning", out var r) &&
                            r.ValueKind == JsonValueKind.String
                ? r.GetString()
                : null;

            return (passed, reasoning);
        }
        catch (JsonException)
        {
            return (false, $"judge output unparseable: {Truncate(text)}");
        }
    }

    private static string Truncate(string s) =>
        s.Length <= 300 ? s : s[..300] + "...";
}
