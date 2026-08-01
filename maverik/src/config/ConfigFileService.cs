using System.Text.Json;
using McpHost.Agents;
using McpHost.LlmModel;
using McpHost.Maverik;
using McpHost.Mcp;
using McpHost.Reporting;

namespace McpHost.Config;

// Reads and writes the three editable JSON config files (agents.json, llm-models.json,
// mcp-servers.json) plus per-agent prompt files (prompts/agent/<id>.md), all rooted at
// configDir. A missing JSON config is bootstrapped from its committed *.example.json sibling on
// first read — Program.cs's startup load and the /api/config/* endpoints both go through this,
// so the same self-heal behavior applies whether the file is needed at boot or from the UI.
public sealed class ConfigFileService
{
    private static readonly JsonSerializerOptions ReadOptions = new() { PropertyNameCaseInsensitive = true };
    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly string _configDir;

    public ConfigFileService(string configDir)
    {
        _configDir = configDir;
        Directory.CreateDirectory(_configDir);
    }

    public (AgentsFile Data, bool Bootstrapped) LoadAgents() => Load<AgentsFile>("agents.json");
    public void SaveAgents(AgentsFile data) => Save("agents.json", data);

    public (LLMModelsConfig Data, bool Bootstrapped) LoadLlmModels() => Load<LLMModelsConfig>("llm-models.json");
    public void SaveLlmModels(LLMModelsConfig data) => Save("llm-models.json", data);

    public (McpServersFile Data, bool Bootstrapped) LoadMcpServers() => Load<McpServersFile>("mcp-servers.json");
    public void SaveMcpServers(McpServersFile data) => Save("mcp-servers.json", data);

    public (ToolCostsFile Data, bool Bootstrapped) LoadToolCosts() => Load<ToolCostsFile>("tool-costs.json");
    public void SaveToolCosts(ToolCostsFile data) => Save("tool-costs.json", data);

    public (CapabilityOverridesFile Data, bool Bootstrapped) LoadCapabilityOverrides() => Load<CapabilityOverridesFile>("capability-overrides.json");
    public void SaveCapabilityOverrides(CapabilityOverridesFile data) => Save("capability-overrides.json", data);

    // One file per suite under maverik-suites/, unlike the single-file configs above — no
    // bootstrap-from-example (suites are real authored content, not secrets/user-specific
    // values; see MaverikSuiteRegistry for the loader that reads all of them at once).
    public bool SuiteExists(string suiteId) => File.Exists(SuitePath(suiteId));

    public void SaveSuite(string suiteId, MaverikSuite data)
    {
        var path = SuitePath(suiteId);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(data, WriteOptions));
    }

    public void DeleteSuite(string suiteId) => File.Delete(SuitePath(suiteId));

    private string SuitePath(string suiteId) => Path.Combine(_configDir, "maverik-suites", suiteId + ".json");

    // No example template exists per-prompt (prompts are real committed content, not
    // secrets/user-specific values) — "bootstrapped" here just means the file doesn't exist yet,
    // so the UI can start the editor from an empty draft instead of a copied template.
    public (string Content, bool Bootstrapped) LoadPrompt(string agentId)
    {
        var path = PromptPath(agentId);
        return File.Exists(path) ? (File.ReadAllText(path), false) : ("", true);
    }

    public void SavePrompt(string agentId, string content)
    {
        var path = PromptPath(agentId);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    private string PromptPath(string agentId) => Path.Combine(_configDir, "prompts", "agent", agentId + ".md");

    // Visualization functions (config/reporting/visualizations/<id>.js) are authored and edited
    // directly on disk — config/ is already bind-mounted read-write, and there's no PUT for
    // these, only listing/reading so the dashboard can show what exists and preview it against
    // real run data. See config/reporting/README.md for the function contract these files follow.
    // No separate "graph" vs "table" concept — the signature is identical either way, it's just a
    // matter of what a given function draws into its container.
    public IReadOnlyList<(string Id, DateTimeOffset ModifiedAt)> ListVisualizations()
    {
        var dir = Path.Combine(_configDir, "reporting", "visualizations");
        if (!Directory.Exists(dir))
            return Array.Empty<(string, DateTimeOffset)>();

        return Directory.GetFiles(dir, "*.js")
            .Select(path => (Path.GetFileNameWithoutExtension(path), (DateTimeOffset)File.GetLastWriteTimeUtc(path)))
            .OrderBy(f => f.Item1, StringComparer.Ordinal)
            .ToList();
    }

    public string? ReadVisualization(string id)
    {
        var path = Path.Combine(_configDir, "reporting", "visualizations", id + ".js");
        return File.Exists(path) ? File.ReadAllText(path) : null;
    }

    // One file per dashboard under reporting/dashboards/, same one-file-per-id pattern as suites
    // — no bootstrap-from-example (dashboards are real authored content, not secrets), and no
    // registry: dashboards aren't read on any hot path, so callers just read fresh each request.
    public IReadOnlyList<DashboardConfig> ListDashboards()
    {
        var dir = Path.Combine(_configDir, "reporting", "dashboards");
        if (!Directory.Exists(dir))
            return Array.Empty<DashboardConfig>();

        return Directory.GetFiles(dir, "*.json")
            .Select(path => JsonSerializer.Deserialize<DashboardConfig>(File.ReadAllText(path), ReadOptions))
            .Where(d => d is not null)
            .Select(d => d!)
            .OrderBy(d => d.Id, StringComparer.Ordinal)
            .ToList();
    }

    public DashboardConfig? LoadDashboard(string id)
    {
        var path = DashboardPath(id);
        return File.Exists(path)
            ? JsonSerializer.Deserialize<DashboardConfig>(File.ReadAllText(path), ReadOptions)
            : null;
    }

    public bool DashboardExists(string id) => File.Exists(DashboardPath(id));

    public void SaveDashboard(string id, DashboardConfig data)
    {
        var path = DashboardPath(id);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(data, WriteOptions));
    }

    public void DeleteDashboard(string id) => File.Delete(DashboardPath(id));

    private string DashboardPath(string id) => Path.Combine(_configDir, "reporting", "dashboards", id + ".json");

    // One file per report under reporting/reports/ — same pattern as dashboards, no registry
    // (reports aren't read on any hot path either).
    public IReadOnlyList<ReportConfig> ListReports()
    {
        var dir = Path.Combine(_configDir, "reporting", "reports");
        if (!Directory.Exists(dir))
            return Array.Empty<ReportConfig>();

        return Directory.GetFiles(dir, "*.json")
            .Select(path => JsonSerializer.Deserialize<ReportConfig>(File.ReadAllText(path), ReadOptions))
            .Where(r => r is not null)
            .Select(r => r!)
            .OrderBy(r => r.Id, StringComparer.Ordinal)
            .ToList();
    }

    public ReportConfig? LoadReport(string id)
    {
        var path = ReportPath(id);
        return File.Exists(path)
            ? JsonSerializer.Deserialize<ReportConfig>(File.ReadAllText(path), ReadOptions)
            : null;
    }

    public bool ReportExists(string id) => File.Exists(ReportPath(id));

    public void SaveReport(string id, ReportConfig data)
    {
        var path = ReportPath(id);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(data, WriteOptions));
    }

    public void DeleteReport(string id) => File.Delete(ReportPath(id));

    private string ReportPath(string id) => Path.Combine(_configDir, "reporting", "reports", id + ".json");

    private (T, bool) Load<T>(string fileName)
    {
        var real = Path.Combine(_configDir, fileName);
        var bootstrapped = false;

        if (!File.Exists(real))
        {
            var example = Path.Combine(_configDir,
                Path.GetFileNameWithoutExtension(fileName) + ".example" + Path.GetExtension(fileName));
            if (!File.Exists(example))
                throw new InvalidOperationException(
                    $"Neither '{fileName}' nor its example template exist in '{_configDir}'.");
            File.Copy(example, real);
            bootstrapped = true;
        }

        var data = JsonSerializer.Deserialize<T>(File.ReadAllText(real), ReadOptions)
            ?? throw new InvalidOperationException($"'{fileName}' deserialized to null — check its contents.");
        return (data, bootstrapped);
    }

    private void Save<T>(string fileName, T data)
    {
        var real = Path.Combine(_configDir, fileName);
        File.WriteAllText(real, JsonSerializer.Serialize(data, WriteOptions));
    }
}
