using Anthropic.Models.Messages;
using McpHost.LlmModel;
using Microsoft.Extensions.AI;

namespace Maverik.Tests.LlmModel;

public class AnthropicCacheControlTests
{
    // WithCacheControl stores the breakpoint in AdditionalProperties under this well-known key
    // (confirmed by inspecting a real WithCacheControl call's output) — there is no public
    // GetCacheControl accessor on the installed package version, despite it being documented.
    private const string CacheControlKey = "anthropic:cache_control";

    [Fact]
    public void ParseTtl_5m_MapsToTtl5m()
    {
        Assert.Equal(Ttl.Ttl5m, AnthropicCacheControl.ParseTtl("5m"));
    }

    [Fact]
    public void ParseTtl_1h_MapsToTtl1h()
    {
        Assert.Equal(Ttl.Ttl1h, AnthropicCacheControl.ParseTtl("1h"));
    }

    [Fact]
    public void ParseTtl_Null_ReturnsNull()
    {
        Assert.Null(AnthropicCacheControl.ParseTtl(null));
    }

    [Fact]
    public void ParseTtl_UnknownValue_Throws()
    {
        Assert.Throws<ArgumentException>(() => AnthropicCacheControl.ParseTtl("30s"));
    }

    [Fact]
    public void BuildSystemMessage_AttachesCacheControl_WithRequestedTtl()
    {
        var message = AnthropicCacheControl.BuildSystemMessage("you are a helpful agent", Ttl.Ttl1h);

        Assert.Equal(ChatRole.System, message.Role);
        var content = Assert.IsType<TextContent>(Assert.Single(message.Contents));
        Assert.Equal("you are a helpful agent", content.Text);

        var cacheControl = Assert.IsType<CacheControlEphemeral>(content.AdditionalProperties![CacheControlKey]);
        Assert.True(cacheControl.Ttl == Ttl.Ttl1h);
    }

    [Fact]
    public void BuildSystemMessage_NullTtl_StillAttachesCacheControl()
    {
        // Null TTL is deliberate — Anthropic defaults to 5 minutes server-side when the "ttl"
        // field is omitted, so this still caches, just without an explicit TTL.
        var message = AnthropicCacheControl.BuildSystemMessage("prompt", ttl: null);

        var content = Assert.IsType<TextContent>(Assert.Single(message.Contents));
        Assert.True(content.AdditionalProperties!.ContainsKey(CacheControlKey));
    }
}
