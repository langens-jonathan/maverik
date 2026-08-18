using McpHost.Maverik;

namespace Maverik.Tests.Maverik;

// ParseTurn is UserSimulator's counterpart to CriterionEvaluator.ParseVerdict — same tolerant
// outermost-{...}-span parsing, mirrored test coverage style.
public class UserSimulatorTests
{
    [Fact]
    public void ParseTurn_ParsesPlainJson_Continue()
    {
        var (shouldContinue, message) = UserSimulator.ParseTurn("""{"continue": true, "message": "and the repo name?"}""");

        Assert.True(shouldContinue);
        Assert.Equal("and the repo name?", message);
    }

    [Fact]
    public void ParseTurn_ParsesPlainJson_Done()
    {
        var (shouldContinue, message) = UserSimulator.ParseTurn("""{"continue": false}""");

        Assert.False(shouldContinue);
        Assert.Null(message);
    }

    [Fact]
    public void ParseTurn_ParsesFencedJson()
    {
        var text = "```json\n{\"continue\": true, \"message\": \"thanks, octocat/Hello-World\"}\n```";

        var (shouldContinue, message) = UserSimulator.ParseTurn(text);

        Assert.True(shouldContinue);
        Assert.Equal("thanks, octocat/Hello-World", message);
    }

    [Fact]
    public void ParseTurn_ParsesJsonWrappedInProse()
    {
        var text = "Sure thing: {\"continue\": true, \"message\": \"what repo?\"} there you go!";

        var (shouldContinue, message) = UserSimulator.ParseTurn(text);

        Assert.True(shouldContinue);
        Assert.Equal("what repo?", message);
    }

    [Fact]
    public void ParseTurn_MissingContinueField_EndsConversation()
    {
        var (shouldContinue, message) = UserSimulator.ParseTurn("""{"message": "no continue key"}""");

        Assert.False(shouldContinue);
        Assert.Null(message);
    }

    [Fact]
    public void ParseTurn_ContinueTrueWithNoMessage_EndsConversation()
    {
        // "continue: true" with nothing to actually send can't continue — treated the same as
        // an unparseable reply rather than looping with a blank message.
        var (shouldContinue, message) = UserSimulator.ParseTurn("""{"continue": true}""");

        Assert.False(shouldContinue);
        Assert.Null(message);
    }

    [Fact]
    public void ParseTurn_UnparseableText_EndsConversation()
    {
        var (shouldContinue, message) = UserSimulator.ParseTurn("not json at all");

        Assert.False(shouldContinue);
        Assert.Null(message);
    }
}
