import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import "express-async-errors";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";

// Import database
import { initDB } from "./db.js";

// Import terminal server
import { terminalServer } from "./terminalServer.js";
import { ptyManager } from "./ptyManager.js";

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
import { autoResponder } from "./autoResponder.js";
import { bigProjectPlanner } from "./bigProjectPlanner.js";

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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
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

    // Health check endpoint
    app.get("/api/health", (req, res) => {
      res.json({
        status: "OK",
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        uptime: process.uptime(),
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
        res.json({
          llmEnabled: settings.enabled === true,
          llmAvailable: health.available === true,
          llmProvider: settings.provider,
          hasProjects: projects.length > 0,
          setupComplete: settings.enabled === true && health.available === true && projects.length > 0,
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
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  terminalServer.cleanup();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  terminalServer.cleanup();
  process.exit(0);
});

// Start the server
startServer();
