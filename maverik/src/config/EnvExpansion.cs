using System.Text.RegularExpressions;

namespace McpHost.Config;

// Expands ${VAR_NAME} placeholders against environment variables, so secrets and host-specific
// values stay out of committed JSON config (see .env.example — Docker Compose loads .env into
// the container's environment via env_file, and this is what turns "${ANTHROPIC_API_KEY}" in
// llm-models.json or a mcp-servers.json header into the real value at startup/connect time).
//
// Shared by every config loader that accepts environment-variable references — currently
// McpConnectionFactory (server headers) and LLMModelRegistry (model apiKey).
public static class EnvExpansion
{
    private static readonly Regex Placeholder = new(@"\$\{(\w+)\}", RegexOptions.Compiled);

    // A referenced variable that isn't set fails loudly rather than silently sending an empty
    // credential.
    public static string Expand(string value) =>
        Placeholder.Replace(value, m =>
        {
            var name = m.Groups[1].Value;
            return Environment.GetEnvironmentVariable(name)
                   ?? throw new InvalidOperationException($"Environment variable '{name}' is not set.");
        });

    // For optional fields (e.g. LLMModelConfig.ApiKey) where null means "not configured" and
    // should stay null rather than becoming the literal string "".
    public static string? ExpandNullable(string? value) => value is null ? null : Expand(value);
}
