using Microsoft.Extensions.AI;

namespace McpHost;

// The host loop, v1: no tools yet. Pulls jobs off the queue one at a time, runs the
// LLM, pushes the answer over the WebSocket. Replaces the Task.Run stub from step 1.
// As a BackgroundService it starts with the app, spans requests, stops on shutdown.
public sealed class ChatWorker(
    ChatJobQueue queue,
    ConversationStore conversations,
    ChatConnectionRegistry registry,
    IChatClient chat,
    ILogger<ChatWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Blocks until a job arrives, then yields it. Ends when the app shuts down.
        await foreach (var job in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                var history = conversations.GetOrCreate(job.SessionId);
                history.Add(new ChatMessage(ChatRole.User, job.Message));

                await registry.SendAsync(job.SessionId, "(thinking...)");   // notify hook

                // Whole history goes in — the model is stateless.
                var response = await chat.GetResponseAsync(history, cancellationToken: stoppingToken);

                history.AddRange(response.Messages);   // persist the assistant turn for next time
                await registry.SendAsync(job.SessionId, response.Text);
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Job failed for session {SessionId}", job.SessionId);
                await registry.SendAsync(job.SessionId, "(error) something went wrong.");
            }
        }
    }
}