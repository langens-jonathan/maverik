# Build stage — produces static assets only, nothing Node ships in the final image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json .
RUN npm ci
COPY . .

# Vite bakes VITE_* vars into the bundle at build time, so the API URL must be fixed here rather
# than read at container start. Override via `docker compose build --build-arg` or the compose
# file's `args:` if your published backend port differs from the default.
ARG VITE_API_BASE_URL=http://localhost:5088
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# Runtime stage — just nginx serving the built static files.
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# SPA fallback (try_files -> index.html) so direct navigation/refresh on a client route like
# /runs/xyz doesn't hit nginx's own 404 before React Router gets a chance to render.
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
