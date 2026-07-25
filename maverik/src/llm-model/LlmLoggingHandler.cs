using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace McpHost.LlmModel;

// Wire-level logging for LLM traffic. Installed (only when MCPHOST_LLM_DEBUG is on) as the
// HttpClient handler for both provider clients, so it sees the raw HTTP request/response —
// method, endpoint, and POST body — below the IChatClient/SDK layer.
//
// Each exchange is written twice: a "to LLM" line when the request is sent and a "from LLM"
// line (plus a footer with elapsed time and token usage) once the response is fully read.
// Output goes to the injected ILogger and, mirrored, to logs/{sessionId}.log.
public sealed class LlmLoggingHandler(ILogger log, string logDirectory) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken ct)
    {
        var sessionId = LlmLogContext.SessionId ?? "unknown";
        var sw = Stopwatch.StartNew();

        var requestBody = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
        Emit(sessionId,
            $"{DateTimeOffset.UtcNow:O} [session {sessionId}] to LLM   {request.Method} {request.RequestUri}\n{requestBody}");

        var response = await base.SendAsync(request, ct);

        // Reading the network stream consumes it. Buffer the body and swap in a re-readable
        // copy (preserving content headers) so the SDK can still parse the response.
        var bytes = await response.Content.ReadAsByteArrayAsync(ct);
        var replacement = new ByteArrayContent(bytes);
        foreach (var header in response.Content.Headers)
            replacement.Headers.TryAddWithoutValidation(header.Key, header.Value);
        response.Content = replacement;

        sw.Stop();

        var responseBody = Encoding.UTF8.GetString(bytes);
        var (inputTokens, outputTokens) = ReadUsage(responseBody);

        Emit(sessionId,
            $"{DateTimeOffset.UtcNow:O} [session {sessionId}] from LLM {(int)response.StatusCode} {request.RequestUri}\n{responseBody}\n" +
            $"--- exchange: {sw.ElapsedMilliseconds} ms | input tokens: {inputTokens?.ToString() ?? "n/a"} | output tokens: {outputTokens?.ToString() ?? "n/a"} ---");

        return response;
    }

    private void Emit(string sessionId, string block)
    {
        log.LogInformation("{Wire}", block);
        try
        {
            var path = Path.Combine(logDirectory, Sanitize(sessionId) + ".log");
            File.AppendAllText(path, block + Environment.NewLine);
        }
        catch (Exception ex)
        {
            // Never let a logging failure break the actual LLM call.
            log.LogWarning(ex, "Failed to write LLM wire log for session {SessionId}", sessionId);
        }
    }

    // Pull token usage out of the response JSON. The two providers name the fields differently
    // (Anthropic: input_tokens/output_tokens; OpenAI: prompt_tokens/completion_tokens), so try
    // both. Returns nulls for error responses or anything without a usage object.
    private static (long? input, long? output) ReadUsage(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("usage", out var usage) ||
                usage.ValueKind != JsonValueKind.Object)
                return (null, null);

            long? Get(string anthropic, string openai) =>
                  usage.TryGetProperty(anthropic, out var a) && a.ValueKind == JsonValueKind.Number ? a.GetInt64()
                : usage.TryGetProperty(openai, out var o) && o.ValueKind == JsonValueKind.Number ? o.GetInt64()
                : null;

            return (Get("input_tokens", "prompt_tokens"), Get("output_tokens", "completion_tokens"));
        }
        catch
        {
            return (null, null);
        }
    }

    private static string Sanitize(string s) =>
        string.Concat(s.Select(c => char.IsLetterOrDigit(c) ? c : '_'));
}
