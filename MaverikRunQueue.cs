using System.Threading.Channels;

namespace McpHost;

// A thin wrapper over a Channel<RunRequest> — the MAVERIK twin of ChatJobQueue. POST
// /api/maverik/runs writes (producer); MaverikRunner reads (consumer), so starting a run
// returns instantly while the slow benchmark work happens on the runner with a clear owner
// and a clean shutdown path. Deliberately a separate queue/worker from chat, so a long test
// run never blocks interactive conversations.
public sealed class MaverikRunQueue
{
    private readonly Channel<RunRequest> _channel = Channel.CreateUnbounded<RunRequest>();

    public ValueTask EnqueueAsync(RunRequest request, CancellationToken ct = default)
        => _channel.Writer.WriteAsync(request, ct);

    public IAsyncEnumerable<RunRequest> ReadAllAsync(CancellationToken ct)
        => _channel.Reader.ReadAllAsync(ct);
}
