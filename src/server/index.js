import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import "express-async-errors";
import path from "path";
import { fileURLToPath } from "url";

// Import database
import { initDB } from "./db.js";

// Import routes
import projectRoutes from "./routes/projects.js";
import promptRoutes from "./routes/prompts.js";

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
      : [
          "http://localhost:3000",
          "http://localhost:5173",
          "http://localhost:55590",
        ],
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

    // API routes
    app.use("/api/projects", projectRoutes);
    app.use("/api/projects", promptRoutes); // This will handle /api/projects/:id/prompts

    // Health check endpoint
    app.get("/api/health", (req, res) => {
      res.json({
        status: "OK",
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        uptime: process.uptime(),
      });
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
        message: NODE_ENV === "development" ? err.message : "Internal server error",
      });
    });

    // 404 handler (only for API routes in production)
    if (NODE_ENV !== "production") {
      app.use("*", (req, res) => {
        res.status(404).json({ error: "Route not found" });
      });
    }

    // Start server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
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
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  process.exit(0);
});

// Start the server
startServer();
