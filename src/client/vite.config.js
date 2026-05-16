import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function gitValue(command, fallback) {
  try {
    return execSync(command, { cwd: repoRoot, encoding: "utf8" }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function packageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const commitCount = gitValue("git rev-list --count HEAD", "0");
const gitSha = gitValue("git rev-parse --short=7 HEAD", "local");
const releaseVersion = process.env.VITE_APP_RELEASE || `${packageVersion()}.${commitCount}`;
const buildTime = new Date().toISOString();

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_RELEASE": JSON.stringify(releaseVersion),
    "import.meta.env.VITE_GIT_SHA": JSON.stringify(gitSha),
    "import.meta.env.VITE_BUILD_TIME": JSON.stringify(buildTime),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("src/components/ChatPanel.jsx") ||
              id.includes("src/components/ChatInput.jsx") ||
              id.includes("src/components/ChatMessage.jsx") ||
              id.includes("src/components/BranchBar.jsx")) {
            return "chat";
          }
          if (id.includes("src/components/InternalConsole.jsx") ||
              id.includes("src/utils/terminalControlFilter.js")) {
            return "console";
          }
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react-router") || id.includes("@remix-run/router")) return "router";
          if (id.includes("react") || id.includes("scheduler")) return "react";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("@xterm") || id.includes("/xterm/")) return "terminal";
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:55590",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:55590",
        ws: true,
      },
    },
  },
});
