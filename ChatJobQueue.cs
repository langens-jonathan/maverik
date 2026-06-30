using System.Threading.Channels;

namespace McpHost;

// A thin wrapper over a Channel<ChatJob>. /api/chat writes jobs (producer); the ChatWorker
// reads them (consumer), so the POST returns immediately while the slow LLM work happens
// elsewhere with a clear owner, a single error-handling site, and a clean shutdown path.
//
// Unbounded for simplicity; a production host would use Channel.CreateBounded(...) to apply
// backpressure instead of growing memory without limit.
public sealed class ChatJobQueue
{
    private readonly Channel<ChatJob> _channel = Channel.CreateUnbounded<ChatJob>();

    public ValueTask EnqueueAsync(ChatJob job, CancellationToken ct = default)
        => _channel.Writer.WriteAsync(job, ct);

    public IAsyncEnumerable<ChatJob> ReadAllAsync(CancellationToken ct)
        => _channel.Reader.ReadAllAsync(ct);
}
