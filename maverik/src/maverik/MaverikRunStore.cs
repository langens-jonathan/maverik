using System.Collections.Concurrent;

namespace McpHost.Maverik;

// In-memory run state, keyed by run id. The runner is the only writer during normal operation
// and publishes whole immutable RunStatus snapshots (dictionary assignment is atomic), so the
// poll endpoints always read a consistent state with no locking. In-memory and single-instance
// like ConversationStore/ChatOutbox, but unlike those, run history DOES survive a restart:
// Program.cs rehydrates this store from results/*/run.json at startup (see
// MaverikResultsWriter.LoadAll) — results/ is the single source of truth, this store is just a
// fast index rebuilt from it, not a second place run data could drift out of sync with.
public sealed class MaverikRunStore
{
    private readonly ConcurrentDictionary<string, RunStatus> _runs = new();

    public void Set(RunStatus status) => _runs[status.RunId] = status;

    public RunStatus? Get(string runId) =>
        _runs.TryGetValue(runId, out var status) ? status : null;

    // Newest first — the natural order for a run list.
    public IReadOnlyList<RunStatus> All() =>
        _runs.Values.OrderByDescending(r => r.CreatedAt).ToList();
}
