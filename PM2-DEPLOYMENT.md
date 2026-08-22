# PM2 / IDE lifecycle

The IDE process runs **inside** the Ubuntu container `sai-ide`. Production uses `pm2-runtime` from `ecosystem.config.cjs`. On the host, use the `npm run pm2:*` commands — they manage the container job, not a host Node process.

Do not run `docker compose` on Windows. Do not run `npm run dev` / `npm start` on the host.

## Commands

| Command | Behavior |
| --- | --- |
| `npm run pm2:start` | `git pull --ff-only`, build/install the image if needed, create or replace the `sai-ide` container, start it detached |
| `npm run pm2:restart` | `git pull --ff-only`, rebuild, restart the container |
| `npm run pm2:stop` | `docker stop sai-ide` only. The job definition, images, and volumes stay |
| `npm run pm2:uninstall` | Remove the `sai-ide` container (the job). **Images and volumes are not deleted** |
| `npm run pm2:status` | Show container name, status, image, and ports |
| `npm run pm2:logs` | Follow `sai-ide` logs |

Development (Vite on port 5173):

```bash
npm run pm2:start -- --dev
npm run pm2:restart -- --dev
```

Production (Express serves `src/client/dist` on port 55590):

```bash
npm run pm2:start
```

`start` and `restart` both pull the latest git history before building. `start` is also the first-time install.

## What these commands never do

They never run `docker image rm`, `docker rmi`, `docker volume rm`, or `compose down -v`.

Images must be removed by a person on purpose:

```bash
docker image rm startupp-ai-ide:latest
docker image rm startupp-ai-ide:dev
```

Volumes that hold your data (never deleted by `pm2:*`):

- `sai-ide-data` — SQLite, projects, session history
- `sai-ide-home` — global CLIs and login state
- `sai-ide-logs` — server logs

## Check that it is running

```bash
npm run pm2:status
curl http://localhost:55590/api/health
```

Dev UI: http://localhost:5173  
Production UI: http://localhost:55590

## Inside the container

`ecosystem.config.cjs` defines `ai-ide-api`. The production image starts it with:

```text
pm2-runtime ecosystem.config.cjs --only ai-ide-api --env production
```

Host-side `pm2 start ecosystem.config.cjs` is not supported. If an old host job named `ai-ide-api` is still registered, `npm run pm2:uninstall` deletes that job as well — still without touching images.

## Troubleshooting

### Docker is not running

Start Docker Desktop (Windows/macOS) or the engine, then `npm run pm2:start`.

### Port already in use

```bash
npm run pm2:stop
```

### Want a clean container but keep data

```bash
npm run pm2:uninstall
npm run pm2:start
```

That recreates `sai-ide` from the existing image/build. Named volumes stay.

### Want to delete images

Do it manually after uninstall. The lifecycle scripts will not do it.
