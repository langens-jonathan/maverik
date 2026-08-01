using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.AI;

namespace McpHost.Maverik;

// One tool as it actually gets sent to the model for a given agent — after any
// CapabilityOverride is applied (see CapabilityOverrideApplier), which is deliberate: the digest
// is computed from the EFFECTIVE, post-override catalog, so an override correctly shows up as
// "the catalog changed."
public sealed record CapabilityBundleEntry(string McpServer, string Tool, string Description, string InputSchemaJson);

// A frozen, content-hashed snapshot of exactly which tools/descriptions/schemas/order one agent
// sends — the audit artifact for both cost (schema-token overhead, see the case study) and
// authority (did this agent's effective tool set change unexpectedly). See CI-CD Tutorial.md for
// how Digest gets compared across runs.
public sealed record CapabilityBundle(string AgentId, IReadOnlyList<CapabilityBundleEntry> Entries, string Digest, int ToolCount);

// Pure, no live dependencies — the caller resolves the ordered tool list (McpServerRegistry) and
// any overrides (CapabilityOverrideRegistry) and hands them in already resolved.
public static class CapabilityBundleBuilder
{
    // Unicode control characters (unlikely to appear in real tool metadata) separate
    // fields/entries in the digest hash input, so e.g. ("a","bc") can't collide with ("ab","c").
    private const char FieldSeparator = '';
    private const char EntrySeparator = '';

    public static CapabilityBundle Build(
        string agentId,
        IReadOnlyList<(string Server, AIFunction Tool)> orderedTools,
        IReadOnlyDictionary<(string Server, string Tool), string> descriptionOverrides)
    {
        var entries = orderedTools
            .Select(t =>
            {
                var description = descriptionOverrides.TryGetValue((t.Server, t.Tool.Name), out var ov)
                    ? ov
                    : t.Tool.Description ?? "";
                return new CapabilityBundleEntry(t.Server, t.Tool.Name, description, CanonicalSchemaJson(t.Tool.JsonSchema));
            })
            .ToList();

        return new CapabilityBundle(agentId, entries, ComputeDigest(entries), entries.Count);
    }

    // Hashes server+tool+description+schema IN SEND ORDER — order is part of the hash input, not
    // just set membership, so a pure reorder changes the digest (matching Anthropic's real
    // prefix-sensitivity to catalog order).
    internal static string ComputeDigest(IReadOnlyList<CapabilityBundleEntry> entries)
    {
        var sb = new StringBuilder();
        foreach (var e in entries)
        {
            sb.Append(e.McpServer).Append(FieldSeparator)
              .Append(e.Tool).Append(FieldSeparator)
              .Append(e.Description).Append(FieldSeparator)
              .Append(e.InputSchemaJson).Append(EntrySeparator);
        }

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString()));
        return "sha256:" + Convert.ToHexStringLower(hash);
    }

    // Re-serializes with object keys sorted (recursively) so purely-cosmetic differences in how
    // an MCP server happens to order its own JSON Schema output don't spuriously bust the digest
    // — only real content changes should.
    internal static string CanonicalSchemaJson(JsonElement schema)
    {
        var node = JsonNode.Parse(schema.GetRawText());
        return Canonicalize(node)?.ToJsonString() ?? "null";
    }

    private static JsonNode? Canonicalize(JsonNode? node) => node switch
    {
        JsonObject obj => new JsonObject(
            obj.Select(kv => KeyValuePair.Create(kv.Key, Canonicalize(kv.Value)))
               .OrderBy(kv => kv.Key, StringComparer.Ordinal)),
        JsonArray arr => new JsonArray(arr.Select(Canonicalize).ToArray()),
        _ => node?.DeepClone(),
    };
}
