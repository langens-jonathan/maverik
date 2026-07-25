namespace McpHost.Reporting;

// One dashboard, bound from a config/reporting/dashboards/*.json file (one file per dashboard,
// same one-file-per-id pattern as MaverikSuite). No registry/hot-reload machinery like
// agents/models/mcp-servers/suites have — dashboards aren't read on any hot path (a chat turn or
// benchmark case), so GET/PUT just read/write the file directly each time.
public sealed class DashboardConfig
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public List<DashboardSection> Sections { get; set; } = new();
}

public sealed class DashboardSection
{
    public string Title { get; set; } = "";
    public List<VisualizationRef> Visualizations { get; set; } = new();
}

// Ref is a config/reporting/visualizations/<id>.js id. Title is an optional per-instance
// override — the same visualization file can be dropped into multiple sections/dashboards with
// a different caption each time without needing to duplicate the file.
public sealed class VisualizationRef
{
    public string Ref { get; set; } = "";
    public string? Title { get; set; }
}
