using McpHost.Loop;
using Microsoft.Extensions.AI;

namespace Maverik.Tests.Loop;

public class ContextCutoffTests
{
    private static ChatMessage User(string text) => new(ChatRole.User, text);
    private static ChatMessage Assistant(string text) => new(ChatRole.Assistant, text);

    private static List<ChatMessage> HistoryWithTurns(params ChatMessage[] afterSystem) =>
        [new(ChatRole.System, "sys"), .. afterSystem];

    [Fact]
    public void TrimIfNeeded_BelowThreshold_DoesNothing()
    {
        var history = HistoryWithTurns(User("u1"), Assistant("a1"), User("u2"));

        var trimmed = ContextCutoff.TrimIfNeeded(history, currentEstimateTokens: 100, effectiveMaxContextTokens: 1000);

        Assert.False(trimmed);
        Assert.Equal(4, history.Count);
    }

    [Fact]
    public void TrimIfNeeded_UnknownCeiling_DoesNothing()
    {
        var history = HistoryWithTurns(User("u1"), Assistant("a1"), User("u2"));

        var trimmed = ContextCutoff.TrimIfNeeded(history, currentEstimateTokens: 950, effectiveMaxContextTokens: null);

        Assert.False(trimmed);
        Assert.Equal(4, history.Count);
    }

    [Fact]
    public void TrimIfNeeded_UnknownEstimate_DoesNothing()
    {
        var history = HistoryWithTurns(User("u1"), Assistant("a1"), User("u2"));

        var trimmed = ContextCutoff.TrimIfNeeded(history, currentEstimateTokens: null, effectiveMaxContextTokens: 1000);

        Assert.False(trimmed);
        Assert.Equal(4, history.Count);
    }

    [Fact]
    public void TrimIfNeeded_OnlyTheLiveExchangeExists_NeverDropsIt()
    {
        // System message + one in-flight exchange, nothing else -- there is nothing droppable
        // without corrupting the turn currently in progress.
        var history = HistoryWithTurns(User("the only question so far"));

        var trimmed = ContextCutoff.TrimIfNeeded(history, currentEstimateTokens: 950, effectiveMaxContextTokens: 1000);

        Assert.False(trimmed);
        Assert.Equal(2, history.Count);
    }

    [Fact]
    public void TrimIfNeeded_GroupsToolCallsIntoTheirUsersExchange_NeverSplitsAPair()
    {
        // unit 1: User -> Assistant(tool call) -> Tool(result) -> Assistant(final text)
        // unit 2 (most recent, kept): User
        var history = HistoryWithTurns(
            User("call a tool please"),
            Assistant("calling..."),
            new ChatMessage(ChatRole.Tool, "tool result"),
            Assistant("done"),
            User("second question"));

        var trimmed = ContextCutoff.TrimIfNeeded(history, currentEstimateTokens: 950, effectiveMaxContextTokens: 1000);

        Assert.True(trimmed);
        // The whole first unit (4 messages) is gone as one block; the tool-call/tool-result pair
        // was never split apart mid-removal. Only system + the live second question remain.
        Assert.Equal(2, history.Count);
        Assert.Equal(ChatRole.System, history[0].Role);
        Assert.Equal("second question", history[1].Text);
    }

    [Fact]
    public void TrimIfNeeded_DropsOldestUnitsUntilBackUnderThreshold_StopsAsSoonAsUnder()
    {
        // 10 single-message units, each exactly 5 chars ("msg-0".."msg-9") so every unit carries
        // an equal proportional share of the real 1000-token estimate: 100 tokens each.
        var messages = Enumerable.Range(0, 10).Select(k => User($"msg-{k}")).ToArray();
        var history = HistoryWithTurns(messages);

        var trimmed = ContextCutoff.TrimIfNeeded(history, currentEstimateTokens: 1000, effectiveMaxContextTokens: 1000);

        Assert.True(trimmed);
        // threshold = 900. remaining starts at 1000: drop msg-0 (-> 900, not yet under 900, so
        // keep going), drop msg-1 (-> 800, now under 900, stop). Exactly 2 units dropped.
        Assert.Equal(ChatRole.System, history[0].Role);
        Assert.Equal(9, history.Count); // system + 8 surviving units
        Assert.Equal("msg-2", history[1].Text);
        Assert.Equal("msg-9", history[^1].Text);
    }
}
