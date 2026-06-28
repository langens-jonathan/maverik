using System.Threading.Channels;

namespace McpHost;

// A thin wrapper over a Channel<ChatJob>. The /api/chat endpoint writes jobs (producer);
// the ChatWorker reads them (consumer). This is what lets the POST return instantly
// while the slow LLM work happens elsewhere — and unlike a fire-and-forget Task.Run,
// the work has a clear owner, a single error-handling site, and a clean shutdown path.
//
// Unbounded for simplicity. In production you'd use Channel.CreateBounded(...) so a
// flood of requests applies backpressure instead of growing memory without limit.
public sealed class ChatJobQueue
{
    private readonly Channel<ChatJob> _channel = Channel.CreateUnbounded<ChatJob>();

    public ValueTask EnqueueAsync(ChatJob job, CancellationToken ct = default)
        => _channel.Writer.WriteAsync(job, ct);

    public IAsyncEnumerable<ChatJob> ReadAllAsync(CancellationToken ct)
        => _channel.Reader.ReadAllAsync(ct);
}
