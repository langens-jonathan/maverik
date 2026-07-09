using Microsoft.Extensions.AI;

namespace McpHost;

// "parallel-tools": the same loop as manual, but when the model requests several tools in one
// turn they run concurrently — often a latency win on I/O-bound MCP servers. Results are fed
// back in the original call order; providers match results to calls by CallId, but keeping
// order avoids provider quirks.
public sealed class ParallelToolsLoopStrategy : LoopStrategyBase
{
    public override string Name => "parallel-tools";

    protected override async Task<IReadOnlyList<FunctionResultContent>> ExecuteCallsAsync(
        IReadOnlyList<FunctionCallContent> calls, TurnRequest request, CancellationToken ct)
    {
        // Announce every call before any of them start — under concurrent execution there is
        // no meaningful "just before this one" moment.
        foreach (var call in calls)
            ReportCall(call, request);

        // InvokeToolAsync never throws (failures come back as error results the model can
        // react to), so WhenAll only faults on cancellation.
        var tasks = calls.Select(call => InvokeToolAsync(call, request, ct)).ToList();
        await Task.WhenAll(tasks);
        return tasks.Select(t => t.Result).ToList();
    }
}
