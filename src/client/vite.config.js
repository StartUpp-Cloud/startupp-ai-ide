import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
