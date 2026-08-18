using System.Text.Json;
using Microsoft.Extensions.AI;
using McpHost.LlmModel;

namespace McpHost.Maverik;

// One decision from the simulated user: either the conversation is done (Continue = false,
// Message = null — the agent's last response satisfied the goal) or here's the next thing the
// user would plausibly say. InputTokens/OutputTokens are this call's own usage, tracked
// completely separately from the agent's — same "operating cost of testing, never part of the
// agent's score" convention CriterionEvaluator's judge tokens already follow.
public sealed record SimulatedTurn(bool Continue, string? Message, long? InputTokens, long? OutputTokens);

// Drives the "simulated" half of MaverikQuestion.UserTurnMode. Modeled directly on
// CriterionEvaluator's llm-judge path: resolve a model independent of the agent under test, send
// a fresh isolated prompt (no tools, temperature 0 for reproducibility — a benchmark suite should
// give the same result run to run, so variety comes from writing multiple questions, not from
// letting one question's simulated user wander), and parse a tolerant JSON verdict out of
// whatever comes back. Suite shape is validated at startup by MaverikSuiteRegistry, so this class
// can assume UserTurnMode/UserSimulatorModel resolve.
public sealed class UserSimulator(LLMModelRegistry models)
{
    public async Task<SimulatedTurn> GetNextTurnAsync(
        MaverikQuestion question, string simulatorModel, IReadOnlyList<ChatMessage> conversationSoFar, CancellationToken ct)
    {
        var simulator = models.Resolve(simulatorModel);

        List<ChatMessage> messages =
        [
            new(ChatRole.System,
                "You are role-playing the user in a conversation with an AI assistant, pursuing this goal: " +
                $"{question.Text}" +
                (question.UserContext is { Length: > 0 } ctx ? $"\n\nAdditional context only you (the user) know: {ctx}" : "") +
                "\n\nGiven the conversation so far, decide what the user does next. If the assistant's last " +
                "message already fully answers or completes the request, reply with ONLY this JSON: " +
                "{\"continue\": false}. Otherwise reply with ONLY this JSON: {\"continue\": true, " +
                "\"message\": \"the next thing the user would plausibly say\"}."),
            // The agent's own system prompt isn't part of what the simulated user "sees" — only
            // the actual back-and-forth (user asks, assistant replies) is relevant to reacting.
            .. conversationSoFar.Where(m => m.Role != ChatRole.System),
        ];

        var response = await simulator.GetResponseAsync(messages, new ChatOptions { Temperature = 0 }, ct);

        var (shouldContinue, message) = ParseTurn(response.Text);
        return new SimulatedTurn(shouldContinue, message, response.Usage?.InputTokenCount, response.Usage?.OutputTokenCount);
    }

    // Same tolerant approach as CriterionEvaluator.ParseVerdict: pull the outermost {...} span
    // rather than trusting the whole reply is bare JSON, since models sometimes wrap it in
    // markdown fences or add prose. An unparseable reply ends the conversation (Continue = false)
    // rather than throwing — one flaky simulator reply must not crash the whole case; the turn
    // just gets evaluated as final a little early.
    internal static (bool Continue, string? Message) ParseTurn(string text)
    {
        var start = text.IndexOf('{');
        var end = text.LastIndexOf('}');
        if (start < 0 || end <= start)
            return (false, null);

        try
        {
            using var doc = JsonDocument.Parse(text[start..(end + 1)]);

            if (!doc.RootElement.TryGetProperty("continue", out var cont) || cont.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                return (false, null);

            if (!cont.GetBoolean())
                return (false, null);

            var message = doc.RootElement.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String
                ? m.GetString()
                : null;

            // "continue: true" with no usable message can't actually continue.
            return string.IsNullOrWhiteSpace(message) ? (false, null) : (true, message);
        }
        catch (JsonException)
        {
            return (false, null);
        }
    }
}
