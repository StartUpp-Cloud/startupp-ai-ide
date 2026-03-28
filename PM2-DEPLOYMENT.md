# PM2 Deployment Guide for StartUpp AI IDE

This guide covers PM2-based deployment for StartUpp AI IDE.

The recommended production mode runs only the backend process. In production, the Express server serves the built frontend from `src/client/dist`.

## Quick Start

### 1. Install PM2 Globally

```bash
npm install -g pm2
```

### 2. Run the Startup Script

```bash
./start-pm2.sh
```

This script will:

- Check if PM2 is installed
- Install dependencies
- Build the frontend
- Start the application with PM2

## Manual PM2 Commands

### Start the Application

```bash
# Development mode: PM2 manages both backend and Vite dev server
npm run pm2:start

# Production mode: PM2 manages only the backend server
npm run pm2:start:prod
```

### Manage the Application

```bash
# View status
npm run pm2:status

# View logs
npm run pm2:logs

# Monitor processes
npm run pm2:monit

# Restart application
npm run pm2:restart

# Reload application
npm run pm2:reload

# Stop application
npm run pm2:stop

# Remove from PM2
npm run pm2:delete
```

## PM2 Configuration

The application uses `ecosystem.config.cjs` for PM2 configuration.

## Environment Configuration

### Development

- Uses `.env` file
- CORS allows all origins for LAN access
- Detailed error messages

### Production

- Uses `.env` file
- Serves the built frontend from `src/client/dist`
- Hides detailed internal errors
- Does not require a separate frontend process

## File Structure

```text
startupp-ai-ide/
├── ecosystem.config.cjs        # PM2 configuration
├── start-pm2.sh                # Startup script
├── .env.example                # Environment template
├── logs/                       # PM2 log files
├── data/                       # Local database (gitignored)
├── src/
│   ├── client/
│   │   └── dist/               # Built frontend after build
│   └── server/
│       └── index.js            # Server entry point
└── package.json                # NPM scripts
```

## Production Deployment Steps

### 1. Prepare the Environment

```bash
cp .env.example .env
npm run install:all
npm run build
```

### 2. Start with PM2

```bash
npm run pm2:start:prod
```

### 3. Verify Deployment

```bash
pm2 status
pm2 logs
curl http://localhost:55590/api/health
```

## Monitoring and Logs

### View Logs

```bash
pm2 logs
pm2 logs ai-ide-api
pm2 logs --follow
```

### Monitor Processes

```bash
pm2 monit
pm2 show ai-ide-api
```

### Log Files

- Error logs: `./logs/err.log`
- Output logs: `./logs/out.log`
- Combined logs: `./logs/combined.log`

## Zero-Downtime Updates

### Reload Application

```bash
npm run pm2:reload
pm2 reload ecosystem.config.cjs
```

### Update and Deploy

```bash
git pull origin main
npm install
npm run build
npm run pm2:reload:prod
```

## Troubleshooting

### Common Issues

#### 1. PM2 Not Found

```bash
npm install -g pm2
```

#### 2. Port Already in Use

```bash
lsof -i :55590
```

#### 3. Frontend Build Failed

```bash
cd src/client && npm run build
```

### Debug Commands

```bash
pm2 status
pm2 show ai-ide-api
pm2 logs --err
pm2 restart ai-ide-api
```

## Security Considerations

- Environment variables for local configuration
- Rate limiting enabled
- Helmet security headers enabled
- CORS configured by environment
- Reduced error detail in production
- AI auto-responder has risk-based guardrails (blocks critical operations without confirmation)
- Intended for local/private self-hosting unless you add auth in front of it

### Environment Variables

```bash
NODE_ENV=production
PORT=55590
FRONTEND_URL=https://yourdomain.com
RATE_LIMIT_MAX_REQUESTS=100
```

## Network Access

In development mode, the Vite dev server binds to all interfaces (`host: true`), making the IDE accessible from other machines on your LAN at `http://<server-ip>:5173`. The terminal sessions run on the server machine.

---

**Happy Deploying!**
