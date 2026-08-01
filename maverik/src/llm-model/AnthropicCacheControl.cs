using Anthropic.Models.Messages;
using Microsoft.Extensions.AI;

namespace McpHost.LlmModel;

// Wires MAVERIK into the Anthropic NuGet package's non-beta prompt-caching support (confirmed
// via the package's own XML docs and a reflection spike — see AgentConfig.PromptCaching). Only
// meaningful for the Anthropic provider: WithCacheControl is inert/ignored on the OpenAI-
// compatible path, so this needs no provider branching anywhere it's called.
//
// Anthropic's render order is tools -> system -> messages, and a cache breakpoint caches
// everything up to and including the block it's attached to. Putting the ONE breakpoint on the
// system prompt therefore caches the tool catalog AND the system prompt together in a single
// shot — no separate tool-array breakpoint is needed for the default caching path.
public static class AnthropicCacheControl
{
    // The AdditionalCounts key UsageDetails carries cache-creation tokens under. Confirmed by
    // static inspection (the Anthropic SDK's compiled strings match the real Anthropic API's
    // wire-format field name exactly), NOT by a live API call — the docs don't specify the
    // AdditionalCounts key-naming convention directly. Verify on the first real cached run
    // (MCPHOST_LLM_DEBUG, log response.Usage?.AdditionalCounts?.Keys) and fix this constant if
    // it turns out wrong; everything downstream just sees null until then, fail-soft.
    public const string CacheCreationInputTokensKey = "cache_creation_input_tokens";

    public static Ttl? ParseTtl(string? ttl) => ttl switch
    {
        null => null,
        "5m" => Ttl.Ttl5m,
        "1h" => Ttl.Ttl1h,
        _ => throw new ArgumentException($"Unknown promptCachingTtl '{ttl}'; expected \"5m\" or \"1h\"."),
    };

    // Null ttl is valid and deliberate: WithCacheControl(null) still emits a cache breakpoint
    // (just without an explicit "ttl" field), which Anthropic's API defaults to 5 minutes
    // server-side — confirmed by inspecting the serialized AdditionalProperties. So a null
    // PromptCachingTtl needs no client-side default fallback.
    public static ChatMessage BuildSystemMessage(string systemPrompt, Ttl? ttl) =>
        new(ChatRole.System, [new TextContent(systemPrompt).WithCacheControl(ttl)]);
}
