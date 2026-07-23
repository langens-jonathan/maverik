using Microsoft.Extensions.AI;

namespace McpHost.Loop;

// The classic host loop ("manual"): tool calls within a turn run one at a time, in the order
// the model requested them. This is the behavior the host has always had — extracted from
// ChatWorker so the chat path and the MAVERIK benchmark runner share it.
public sealed class ManualLoopStrategy : LoopStrategyBase
{
    public override string Name => "manual";

    protected override async Task<IReadOnlyList<FunctionResultContent>> ExecuteCallsAsync(
        IReadOnlyList<FunctionCallContent> calls, TurnRequest request, CancellationToken ct)
    {
        var results = new List<FunctionResultContent>();
        foreach (var call in calls)
        {
            ReportCall(call, request);
            results.Add(await InvokeToolAsync(call, request, ct));
        }
        return results;
    }
}
