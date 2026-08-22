module.exports = {
  apps: [
    {
      name: "ai-ide-api",
      script: "src/server/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      // In-container PM2. A mid-run restart wipes in-memory orchestrator state.
      max_memory_restart: "4G",
      node_args: "--max-old-space-size=3072 --require ./scripts/silence-child-process.cjs",
      kill_timeout: 10000,
      env: {
        NODE_ENV: "development",
        PORT: 55590,
        SAI_IN_CONTAINER: "1",
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 55590,
        SAI_IN_CONTAINER: "1",
      },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_file: "./logs/combined.log",
      time: true,
    },
  ],
};
