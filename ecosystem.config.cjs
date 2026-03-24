module.exports = {
  apps: [
    {
      name: "ai-prompt-maker-api",
      script: "src/server/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
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
      name: "ai-prompt-maker-frontend",
      script: "npm",
      args: "run dev",
      cwd: "./src/client",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
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
      repo: "git@github.com:StartUpp-Cloud/startupp-ai-prompt-maker.git",
      path: "/var/www/ai-prompt-maker",
      "pre-deploy-local": "",
      "post-deploy":
        "npm install && npm run build && pm2 reload ecosystem.config.cjs --env production",
      "pre-setup": "",
    },
  },
};
