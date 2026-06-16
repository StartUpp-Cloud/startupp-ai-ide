module.exports = {
  apps: [
    {
      name: "ai-ide-api",
      script: "src/server/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      // IMPORTANT: a mid-run restart wipes the orchestrator's in-memory
      // activeRuns, which makes live agent runs get reconciled as "interrupted"
      // even though the CLI agent is still working in its dtach'd container.
      // 1G was easily hit by this PTY/buffer-heavy process under load, so keep
      // plenty of headroom. node_args raises V8's heap so it doesn't OOM first.
      // Heap below the RSS restart ceiling so native/PTY buffers have headroom
      // and V8 GCs before PM2 kills the process mid-run.
      max_memory_restart: "4G",
      node_args: "--max-old-space-size=3072",
      // Give in-flight work a moment to settle on shutdown/reload.
      kill_timeout: 10000,
      env: {
        NODE_ENV: "development",
        PORT: 55590,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 55590,
      },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_file: "./logs/combined.log",
      time: true,
    },
    {
      name: "ai-ide-frontend",
      script: "npm",
      args: "run dev",
      cwd: "./src/client",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "development",
      },
      error_file: "./logs/frontend-err.log",
      out_file: "./logs/frontend-out.log",
      log_file: "./logs/frontend-combined.log",
      time: true,
    },
  ],

  deploy: {
    production: {
      user: "node",
      host: "localhost",
      ref: "origin/main",
      repo: "git@github.com:StartUpp-Cloud/startupp-ai-ide.git",
      path: "/var/www/ai-ide",
      "pre-deploy-local": "",
      "post-deploy":
        "npm install && npm run build && pm2 reload ecosystem.config.cjs --env production",
      "pre-setup": "",
    },
  },
};
