if (process.env.SAI_IN_CONTAINER === '1' || process.env.SAI_ALLOW_HOST === '1') {
  process.exit(0);
}

console.error(`StartUpp AI IDE runs inside Docker, not on the host OS.

  npm run pm2:start
  npm run pm2:start -- --dev

Open http://localhost:5173 (dev) or http://localhost:55590 (production).
`);
process.exit(1);
