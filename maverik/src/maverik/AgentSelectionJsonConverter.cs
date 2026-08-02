using System.Text.Json;
using System.Text.Json.Serialization;

namespace McpHost.Maverik;

// System.Text.Json only supports primitives/strings/enums as dictionary keys out of the box —
// RunStatus.CapabilityBundles (IReadOnlyDictionary<AgentSelection, CapabilityBundle>) needs this
// to serialize/deserialize at all. Encodes as "agentId" (unversioned) or "agentId@version" for
// property-name (dictionary key) mode; falls back to a plain {agentId, version} object for
// ordinary value mode (e.g. RunStatus.AgentSelections, a JSON array of these).
public sealed class AgentSelectionJsonConverter : JsonConverter<AgentSelection>
{
    public override AgentSelection Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var doc = JsonDocument.ParseValue(ref reader);
        var agentId = doc.RootElement.GetProperty("agentId").GetString()!;
        var version = doc.RootElement.TryGetProperty("version", out var v) && v.ValueKind != JsonValueKind.Null
            ? v.GetInt32()
            : (int?)null;
        return new AgentSelection(agentId, version);
    }

    public override void Write(Utf8JsonWriter writer, AgentSelection value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WriteString("agentId", value.AgentId);
        if (value.Version is { } v) writer.WriteNumber("version", v);
        else writer.WriteNull("version");
        writer.WriteEndObject();
    }

    public override AgentSelection ReadAsPropertyName(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var s = reader.GetString()!;
        var at = s.LastIndexOf('@');
        return at < 0 ? new AgentSelection(s, null) : new AgentSelection(s[..at], int.Parse(s[(at + 1)..]));
    }

    public override void WriteAsPropertyName(Utf8JsonWriter writer, AgentSelection value, JsonSerializerOptions options)
    {
        writer.WritePropertyName(value.Version is { } v ? $"{value.AgentId}@{v}" : value.AgentId);
    }
}
