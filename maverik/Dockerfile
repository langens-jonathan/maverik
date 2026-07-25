# Build stage
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY Maverik.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app/publish

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app
COPY --from=build /app/publish .

# Writable dirs for the wire logs (MCPHOST_LLM_DEBUG) and MAVERIK results — also volume-mounted
# in docker-compose so they survive container restarts.
RUN mkdir -p /app/logs /app/results

# Deliberately root, not the image's non-root "app" user: docker-compose bind-mounts host
# ./logs and ./results over these paths, and on Docker Desktop (Windows/macOS) a bind-mounted
# directory shows up owned by root:root 0755 regardless of any chown baked into the image —
# "app" can read it but not create files/subdirs in it, so MaverikResultsWriter/wire logging
# fail with UnauthorizedAccessException. Root is an accepted tradeoff for this local-only
# benchmarking tool (Docker-only, localhost ports, not internet-exposed); revisit with a
# chown-then-drop-privileges entrypoint if that changes.

# The aspnet:9.0 image listens on 8080 by default; launchSettings.json's port 5088 only applies
# to `dotnet run`, not this image — the port mapping to 5088 happens in docker-compose.
EXPOSE 8080

# ContentRootPath here is /app (this WORKDIR), so every startup File.ReadAllText(...) config
# load (llm-models.json, mcp-servers.json, agents.json, prompts/, maverik-suites/) resolves to
# /app/<name> — exactly where docker-compose mounts them. A missing mount fails startup loudly,
# which is the existing fail-fast behavior working as intended.
ENTRYPOINT ["dotnet", "Maverik.dll"]
