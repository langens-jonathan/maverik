namespace McpHost.Reporting;

// A saved report: a suite/time-range filter over persisted SuiteRunRecords, plus which dashboard
// to feed the (user-narrowed) selection into. Bound from config/reporting/reports/*.json — one
// file per report, same pattern as dashboards/suites. Saving a report does NOT freeze which runs
// matched at save time — the filter is re-resolved against results/suite-runs/ every time the
// report is opened, since new runs may have appeared since; only the filter criteria and the
// chosen dashboard persist.
public sealed class ReportConfig
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public ReportFilter Filter { get; set; } = new();
    public string DashboardId { get; set; } = "";
}

public sealed class ReportFilter
{
    // Empty/null means "any suite".
    public List<string> SuiteIds { get; set; } = new();
    public DateTimeOffset? From { get; set; }
    public DateTimeOffset? To { get; set; }
}
