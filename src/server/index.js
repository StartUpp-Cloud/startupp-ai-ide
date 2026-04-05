import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import "express-async-errors";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { createServer } from "http";

// Import database
import { initDB } from "./db.js";

// Import terminal server
import { terminalServer } from "./terminalServer.js";
import { ptyManager } from "./ptyManager.js";
// Initialize agent shell pool (attaches ptyManager data listener in constructor)
import "./agentShellPool.js";

// Import routes
import projectRoutes from "./routes/projects.js";
import promptRoutes from "./routes/prompts.js";
import globalRuleRoutes from "./routes/globalRules.js";
import cliRoutes from "./routes/cli.js";
import historyRoutes from "./routes/history.js";
import planRoutes from "./routes/plans.js";
import fileRoutes from "./routes/files.js";
import autoResponderRoutes from "./routes/autoResponder.js";
import smartEngineRoutes from "./routes/smartEngine.js";
import llmRoutes from "./routes/llm.js";
import bigProjectRoutes from "./routes/bigProjects.js";
import orchestratorRoutes from "./routes/orchestrator.js";
import activityRoutes from "./routes/activity.js";
import memoryRoutes from "./routes/memory.js";
import safetyRoutes from "./routes/safety.js";
import contextRoutes from "./routes/context.js";
import schedulerRoutes from "./routes/scheduler.js";
import promptFromFileRoutes from "./routes/promptFromFile.js";
import branchReviewRoutes from "./routes/branchReview.js";
import skillRoutes from "./routes/skills.js";
import debugElementRoutes from "./routes/debugElement.js";
import containerRoutes from "./routes/containers.js";
import sessionHistoryRoutes from "./routes/sessionHistory.js";
import chatRoutes from "./routes/chat.js";
import profileRoutes from "./routes/profile.js";
import { authMiddleware, getToken } from "./authToken.js";
import { autoResponder } from "./autoResponder.js";
import { bigProjectPlanner } from "./bigProjectPlanner.js";
import { scheduler } from "./scheduler.js";
import { skillManager } from "./skillManager.js";
import { jobManager } from "./jobManager.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 55590;
const NODE_ENV = process.env.NODE_ENV || "development";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Security middleware
app.use(helmet());

// Rate limiting — relaxed for local/LAN IDE usage
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 min — IDE makes frequent LLM + polling calls
  message: "Too many requests from this IP, please try again later.",
});
app.use("/api/", limiter);

// CORS configuration
const corsOptions = {
  origin:
    NODE_ENV === "production"
      ? [process.env.FRONTEND_URL || "http://localhost:55590"]
      : true,
  credentials: true,
};
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// API authentication — disabled for now (localhost-only tool, CORS handles same-origin)
// Security is handled by: encrypted tokens at rest, file permissions (700), gitignore
// To re-enable: uncomment the middleware below
// app.get("/api/auth/token", (req, res) => { res.json({ token: getToken() }); });
// app.use(authMiddleware);

// Initialize database and start server
async function startServer() {
  try {
    // Initialize LowDB
    await initDB();
    console.log("Database ready");

    // Initialize auto-responder
    await autoResponder.init();
    console.log("Auto-responder ready");

    // Initialize big project planner
    await bigProjectPlanner.init();
    console.log("Big project planner ready");

    // Initialize scheduler
    await scheduler.init();
    console.log("Scheduler ready");

    // Initialize skill manager
    await skillManager.init();
    console.log("Skill manager ready");

    // Initialize job manager (recovers interrupted jobs from previous session)
    await jobManager.init();
    console.log("Job manager ready");

    // API routes
    app.use("/api/projects", projectRoutes);
    app.use("/api/projects", promptRoutes); // This will handle /api/projects/:id/prompts
    app.use("/api/global-rules", globalRuleRoutes);
    app.use("/api/cli", cliRoutes);
    app.use("/api/history", historyRoutes);
    app.use("/api/plans", planRoutes);
    app.use("/api/files", fileRoutes);
    app.use("/api/auto-responder", autoResponderRoutes);
    app.use("/api/smart-engine", smartEngineRoutes);
    app.use("/api/llm", llmRoutes);
    app.use("/api/big-projects", bigProjectRoutes);
    app.use("/api/orchestrator", orchestratorRoutes);
    app.use("/api/activity", activityRoutes);
    app.use("/api/memory", memoryRoutes);
    app.use("/api/safety", safetyRoutes);
    app.use("/api/context", contextRoutes);
    app.use("/api/schedules", schedulerRoutes);
    app.use("/api/prompt-from-file", promptFromFileRoutes);
    app.use("/api/branch-review", branchReviewRoutes);
    app.use("/api/projects/:projectId/quick-commands", (await import("./routes/quickCommands.js")).default);
    app.use("/api/skills", skillRoutes);
    app.use("/api/debug", debugElementRoutes);
    app.use("/api/containers", containerRoutes);
    app.use("/api/session-history", sessionHistoryRoutes);
    app.use("/api/projects", chatRoutes);
    app.use("/api/profile", profileRoutes);
    app.use("/api/jobs", (await import("./routes/jobs.js")).default);

    // Health check endpoint
    app.get("/api/health", (req, res) => {
      res.json({
        status: "OK",
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        uptime: process.uptime(),
      });
    });

    // Global unread counts (for all projects)
    app.get("/api/unread-counts", async (req, res) => {
      try {
        const { chatStore } = await import("./chatStore.js");
        const counts = chatStore.getAllUnreadCounts();
        res.json({ unread: counts });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // System health — lightweight, uses only Node built-in os module
    app.get("/api/system-health", (req, res) => {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const loadAvg = os.loadavg(); // [1min, 5min, 15min]
      const cpuCount = os.cpus().length;
      const nodeMemory = process.memoryUsage();

      res.json({
        memory: {
          totalGB: +(totalMem / 1073741824).toFixed(1),
          usedGB: +(usedMem / 1073741824).toFixed(1),
          freeGB: +(freeMem / 1073741824).toFixed(1),
          percent: Math.round((usedMem / totalMem) * 100),
        },
        cpu: {
          cores: cpuCount,
          load1m: +loadAvg[0].toFixed(2),
          load5m: +loadAvg[1].toFixed(2),
          // Normalize load as percentage of total cores
          percent: Math.min(100, Math.round((loadAvg[0] / cpuCount) * 100)),
        },
        node: {
          heapMB: Math.round(nodeMemory.heapUsed / 1048576),
          rssMB: Math.round(nodeMemory.rss / 1048576),
        },
        uptime: Math.round(process.uptime()),
      });
    });

    // Setup status - used by onboarding gate
    app.get("/api/setup-status", async (req, res) => {
      try {
        const { llmProvider } = await import("./llmProvider.js");
        const ProjectModel = (await import("./models/Project.js")).default;
        const settings = llmProvider.getSettings();
        const projects = ProjectModel.getAll();
        const health = await llmProvider.checkHealth().catch(() => ({ available: false }));
        const osModule = await import("os");
        res.json({
          llmEnabled: settings.enabled === true,
          llmAvailable: health.available === true,
          llmProvider: settings.provider,
          hasProjects: projects.length > 0,
          setupComplete: settings.enabled === true && projects.length > 0,
          serverOS: osModule.platform(),
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Serve static files in production
    if (NODE_ENV === "production") {
      // Serve the built React app
      app.use(express.static(path.join(__dirname, "../client/dist")));

      // Handle React routing, return all requests to React app
      app.get("*", (req, res) => {
        res.sendFile(path.join(__dirname, "../client/dist/index.html"));
      });
    }

    // Error handling middleware
    app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(500).json({
        error: "Something went wrong!",
        message:
          NODE_ENV === "development" ? err.message : "Internal server error",
      });
    });

    // 404 handler (only for API routes in production)
    if (NODE_ENV !== "production") {
      app.use("*", (req, res) => {
        res.status(404).json({ error: "Route not found" });
      });
    }

    // Create HTTP server
    const server = createServer(app);

    // Initialize WebSocket terminal server
    terminalServer.init(server);

    // Start server
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`WebSocket terminal available at ws://localhost:${PORT}/ws/terminal`);
      console.log(`Environment: ${NODE_ENV}`);
      console.log(`PM2 Process: ${process.env.pm_id || "Not managed by PM2"}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, saving sessions and shutting down...");
  try {
    await ptyManager.cleanup(); // Saves all sessions to history, then kills PTYs
  } catch (e) { console.warn("Cleanup error:", e.message); }
  terminalServer.cleanup();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, saving sessions and shutting down...");
  try {
    await ptyManager.cleanup();
  } catch (e) { console.warn("Cleanup error:", e.message); }
  terminalServer.cleanup();
  process.exit(0);
});

// Start the server
startServer();
