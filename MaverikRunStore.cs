using System.Collections.Concurrent;

namespace McpHost;

// In-memory run state, keyed by run id. The runner is the only writer and publishes whole
// immutable RunStatus snapshots (dictionary assignment is atomic), so the poll endpoints
// always read a consistent state with no locking. In-memory and single-instance like
// ConversationStore/ChatOutbox — run history does not survive a restart (the files under
// results/ do; rehydrating them at startup is a roadmap item).
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
