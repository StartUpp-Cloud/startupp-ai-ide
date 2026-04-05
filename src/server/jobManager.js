/**
 * Job Manager - Reliable long-running CLI operation handler
 *
 * Features:
 * - Persistent job storage (survives server restarts)
 * - Real-time output capture to disk
 * - Activity-based timeout detection (not idle-based)
 * - stream-json event parsing for progress updates
 * - LLM integration for progress summarization
 * - Job recovery on server restart
 *
 * @module jobManager
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_DIR = path.join(__dirname, '../../data/jobs');

// Ensure jobs directory exists
if (!fs.existsSync(JOBS_DIR)) {
  fs.mkdirSync(JOBS_DIR, { recursive: true, mode: 0o700 });
}

/**
 * @typedef {Object} Job
 * @property {string} id - UUID
 * @property {string} projectId
 * @property {string} sessionId - Chat session ID
 * @property {string} messageId - Streaming message ID
 * @property {string} tool - 'claude', 'copilot', 'aider', etc.
 * @property {string} prompt - User's prompt
 * @property {'pending'|'running'|'completed'|'failed'|'timeout'|'cancelled'} status
 * @property {string} createdAt - ISO timestamp
 * @property {string|null} startedAt - ISO timestamp
 * @property {string|null} completedAt - ISO timestamp
 * @property {string|null} lastActivityAt - ISO timestamp (last output received)
 * @property {string|null} cliSessionId - Claude/Copilot session ID for --resume
 * @property {string|null} shellSessionId - PTY session ID
 * @property {number} outputBytes - Total output bytes received
 * @property {string|null} result - Parsed result text
 * @property {string|null} error - Error message if failed
 * @property {Object|null} progress - Current progress state
 */

/**
 * @typedef {Object} JobProgress
 * @property {string} status - Current action: 'thinking', 'reading', 'writing', 'running', 'done'
 * @property {string|null} detail - Detail about current action (file path, command, etc.)
 * @property {string|null} summary - LLM-generated summary of what's happening
 * @property {number} eventCount - Number of stream-json events processed
 * @property {string} updatedAt - ISO timestamp
 */

class JobManager extends EventEmitter {
  constructor() {
    super();
    this.activeJobs = new Map(); // jobId -> { job, outputStream, timeoutTimer }
    this.llmProvider = null; // Lazy loaded

    // Configuration
    this.config = {
      // Activity timeout: how long without output before considering stalled
      activityTimeoutMs: 10 * 60 * 1000, // 10 minutes
      // Hard timeout: maximum job duration
      hardTimeoutMs: 60 * 60 * 1000, // 60 minutes
      // Progress summary interval
      progressSummaryIntervalMs: 30 * 1000, // 30 seconds
      // Output file rotation size
      maxOutputFileBytes: 10 * 1024 * 1024, // 10MB
    };
  }

  /**
   * Initialize and recover any interrupted jobs from previous session
   */
  async init() {
    console.log('[JobManager] Initializing...');

    // Find jobs that were running when server stopped
    const interruptedJobs = this._findInterruptedJobs();
    console.log(`[JobManager] Found ${interruptedJobs.length} interrupted job(s)`);

    for (const job of interruptedJobs) {
      // Mark as failed/interrupted - can't resume process after restart
      job.status = 'failed';
      job.error = 'Server restarted while job was running. The operation may have completed - check the project for changes.';
      job.completedAt = new Date().toISOString();
      this._saveJob(job);

      this.emit('job-interrupted', { job });
    }

    console.log('[JobManager] Initialization complete');
  }

  /**
   * Create a new job
   */
  createJob({ projectId, sessionId, messageId, tool, prompt }) {
    const job = {
      id: uuidv4(),
      projectId,
      sessionId,
      messageId,
      tool,
      prompt: prompt.slice(0, 10000), // Limit stored prompt size
      status: 'pending',
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      lastActivityAt: null,
      cliSessionId: null,
      shellSessionId: null,
      outputBytes: 0,
      result: null,
      error: null,
      progress: null,
    };

    this._saveJob(job);
    console.log(`[JobManager] Created job ${job.id} for ${tool}`);

    return job;
  }

  /**
   * Start a job - called when shell command is executed
   */
  startJob(jobId, shellSessionId) {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.lastActivityAt = job.startedAt;
    job.shellSessionId = shellSessionId;
    job.progress = {
      status: 'starting',
      detail: null,
      summary: null,
      eventCount: 0,
      updatedAt: job.startedAt,
    };

    this._saveJob(job);

    // Create output file
    const outputPath = this._getOutputPath(jobId);
    const outputStream = fs.createWriteStream(outputPath, { flags: 'a' });

    // Set up activity timeout
    const timeoutTimer = this._setupActivityTimeout(jobId);

    this.activeJobs.set(jobId, {
      job,
      outputStream,
      timeoutTimer,
      lastProgressSummary: Date.now(),
    });

    this.emit('job-started', { job });
    console.log(`[JobManager] Started job ${jobId}`);

    return job;
  }

  /**
   * Record output from a running job
   */
  async recordOutput(jobId, data) {
    const active = this.activeJobs.get(jobId);
    if (!active) return;

    const { job, outputStream, timeoutTimer } = active;

    // Update activity timestamp
    job.lastActivityAt = new Date().toISOString();
    job.outputBytes += Buffer.byteLength(data);

    // Write to output file
    outputStream.write(data);

    // Reset activity timeout
    clearTimeout(timeoutTimer);
    active.timeoutTimer = this._setupActivityTimeout(jobId);

    // Parse stream-json events for progress
    const progressUpdate = this._parseStreamEvents(data, job);
    if (progressUpdate) {
      job.progress = { ...job.progress, ...progressUpdate, updatedAt: job.lastActivityAt };
      this.emit('job-progress', { job, progress: job.progress });

      // Periodic LLM summary
      if (Date.now() - active.lastProgressSummary > this.config.progressSummaryIntervalMs) {
        active.lastProgressSummary = Date.now();
        this._generateProgressSummary(jobId).catch(() => {});
      }
    }

    // Check for result event
    if (data.includes('"type":"result"') || data.includes('"type": "result"')) {
      // Extract result from the event
      const result = this._extractResultFromOutput(data);
      if (result) {
        job.result = result.text;
        if (result.sessionId) {
          job.cliSessionId = result.sessionId;
        }
      }
    }

    // Save periodically (not on every chunk to avoid disk thrashing)
    if (job.outputBytes % 10000 < 500) {
      this._saveJob(job);
    }
  }

  /**
   * Complete a job successfully
   */
  completeJob(jobId, result = null) {
    const active = this.activeJobs.get(jobId);
    if (!active) return null;

    const { job, outputStream, timeoutTimer } = active;

    clearTimeout(timeoutTimer);
    outputStream.end();

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    if (result) job.result = result;
    if (job.progress) {
      job.progress.status = 'done';
      job.progress.updatedAt = job.completedAt;
    }

    this._saveJob(job);
    this.activeJobs.delete(jobId);

    this.emit('job-completed', { job });
    console.log(`[JobManager] Completed job ${jobId}`);

    return job;
  }

  /**
   * Fail a job
   */
  failJob(jobId, error) {
    const active = this.activeJobs.get(jobId);
    if (!active) return null;

    const { job, outputStream, timeoutTimer } = active;

    clearTimeout(timeoutTimer);
    outputStream.end();

    job.status = 'failed';
    job.completedAt = new Date().toISOString();
    job.error = error;
    if (job.progress) {
      job.progress.status = 'error';
      job.progress.detail = error;
      job.progress.updatedAt = job.completedAt;
    }

    this._saveJob(job);
    this.activeJobs.delete(jobId);

    this.emit('job-failed', { job, error });
    console.log(`[JobManager] Failed job ${jobId}: ${error}`);

    return job;
  }

  /**
   * Cancel a job
   */
  cancelJob(jobId) {
    const active = this.activeJobs.get(jobId);
    if (!active) return null;

    const { job, outputStream, timeoutTimer } = active;

    clearTimeout(timeoutTimer);
    outputStream.end();

    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();

    this._saveJob(job);
    this.activeJobs.delete(jobId);

    this.emit('job-cancelled', { job });
    console.log(`[JobManager] Cancelled job ${jobId}`);

    return job;
  }

  /**
   * Get a job by ID
   */
  getJob(jobId) {
    // Check active jobs first
    const active = this.activeJobs.get(jobId);
    if (active) return active.job;

    // Load from disk
    const jobPath = this._getJobPath(jobId);
    if (fs.existsSync(jobPath)) {
      try {
        return JSON.parse(fs.readFileSync(jobPath, 'utf-8'));
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Get all jobs for a session
   */
  getSessionJobs(projectId, sessionId, limit = 20) {
    const jobs = [];
    const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, file), 'utf-8'));
        if (job.projectId === projectId && job.sessionId === sessionId) {
          jobs.push(job);
        }
      } catch {}
    }

    return jobs
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  /**
   * Get active jobs
   */
  getActiveJobs() {
    return Array.from(this.activeJobs.values()).map(a => a.job);
  }

  /**
   * Get job output
   */
  getJobOutput(jobId, tail = 50000) {
    const outputPath = this._getOutputPath(jobId);
    if (!fs.existsSync(outputPath)) return '';

    const stats = fs.statSync(outputPath);
    if (stats.size <= tail) {
      return fs.readFileSync(outputPath, 'utf-8');
    }

    // Read last N bytes
    const buffer = Buffer.alloc(tail);
    const fd = fs.openSync(outputPath, 'r');
    fs.readSync(fd, buffer, 0, tail, stats.size - tail);
    fs.closeSync(fd);
    return buffer.toString('utf-8');
  }

  /**
   * Update job's CLI session ID (for --resume support)
   */
  updateCliSessionId(jobId, cliSessionId) {
    const job = this.getJob(jobId);
    if (job) {
      job.cliSessionId = cliSessionId;
      this._saveJob(job);
    }
  }

  // ── Private methods ──

  _getJobPath(jobId) {
    return path.join(JOBS_DIR, `${jobId}.json`);
  }

  _getOutputPath(jobId) {
    return path.join(JOBS_DIR, `${jobId}.output`);
  }

  _saveJob(job) {
    fs.writeFileSync(this._getJobPath(job.id), JSON.stringify(job, null, 2), 'utf-8');
  }

  _findInterruptedJobs() {
    const interrupted = [];
    const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, file), 'utf-8'));
        if (job.status === 'running' || job.status === 'pending') {
          interrupted.push(job);
        }
      } catch {}
    }

    return interrupted;
  }

  _setupActivityTimeout(jobId) {
    return setTimeout(() => {
      this._handleActivityTimeout(jobId);
    }, this.config.activityTimeoutMs);
  }

  _handleActivityTimeout(jobId) {
    const active = this.activeJobs.get(jobId);
    if (!active) return;

    const { job } = active;
    const now = Date.now();
    const lastActivity = new Date(job.lastActivityAt).getTime();
    const silenceMs = now - lastActivity;

    // Check if we hit hard timeout
    const startTime = new Date(job.startedAt).getTime();
    const totalMs = now - startTime;

    if (totalMs > this.config.hardTimeoutMs) {
      this.failJob(jobId, `Hard timeout: job ran for ${Math.round(totalMs / 60000)} minutes`);
      return;
    }

    if (silenceMs > this.config.activityTimeoutMs) {
      // Check if the job might still be working (has a result)
      if (job.result) {
        // Has result, probably completed
        this.completeJob(jobId, job.result);
      } else {
        // No result after long silence - likely stalled
        this.failJob(jobId, `Activity timeout: no output for ${Math.round(silenceMs / 60000)} minutes`);
      }
    } else {
      // Reset timer
      active.timeoutTimer = this._setupActivityTimeout(jobId);
    }
  }

  /**
   * Parse stream-json events from output chunk
   */
  _parseStreamEvents(data, job) {
    const lines = data.split('\n');
    let update = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;

      try {
        const event = JSON.parse(trimmed);

        if (event.type === 'tool_use' || event.tool) {
          const toolName = (event.tool || event.name || '').toLowerCase();
          const input = typeof event.input === 'string' ? event.input : JSON.stringify(event.input || '');

          if (toolName.includes('bash') || toolName.includes('shell')) {
            update = { status: 'running', detail: input.slice(0, 100) };
          } else if (toolName.includes('read') || toolName.includes('file')) {
            const filePath = input.match(/["']?([^\s"']+\.\w+)["']?/)?.[1] || input.slice(0, 80);
            update = { status: 'reading', detail: filePath };
          } else if (toolName.includes('write') || toolName.includes('edit')) {
            const filePath = input.match(/["']?([^\s"']+\.\w+)["']?/)?.[1] || input.slice(0, 80);
            update = { status: 'writing', detail: filePath };
          } else if (toolName.includes('glob') || toolName.includes('grep') || toolName.includes('search')) {
            update = { status: 'searching', detail: input.slice(0, 80) };
          } else {
            update = { status: 'working', detail: `${toolName}: ${input.slice(0, 60)}` };
          }
          if (job.progress) job.progress.eventCount++;
        }

        if (event.type === 'assistant' && event.message?.content) {
          const content = event.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'thinking') {
                update = { status: 'thinking', detail: block.thinking?.slice(0, 100) };
              } else if (block.type === 'text') {
                update = { status: 'responding', detail: null };
              }
            }
          }
        }

        if (event.type === 'content_block_delta' || event.type === 'content') {
          update = { status: 'responding', detail: null };
        }

      } catch {}
    }

    return update;
  }

  /**
   * Extract result from output containing result event
   */
  _extractResultFromOutput(data) {
    for (const line of data.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;

      try {
        const json = JSON.parse(trimmed);
        if (json.type === 'result') {
          return {
            text: json.result || '',
            sessionId: json.session_id || null,
            isError: json.is_error || false,
          };
        }
      } catch {}
    }
    return null;
  }

  /**
   * Generate LLM progress summary
   */
  async _generateProgressSummary(jobId) {
    const active = this.activeJobs.get(jobId);
    if (!active) return;

    const { job } = active;

    // Lazy load LLM provider
    if (!this.llmProvider) {
      try {
        const { llmProvider } = await import('./llmProvider.js');
        this.llmProvider = llmProvider;
      } catch {
        return;
      }
    }

    const settings = this.llmProvider.getSettings();
    if (!settings.enabled || settings.provider === 'ollama') return;

    try {
      // Get recent output for context
      const recentOutput = this.getJobOutput(jobId, 2000);
      const cleanOutput = recentOutput
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\{"type"[^}]+\}/g, '')
        .slice(-1000);

      const result = await this.llmProvider.generateResponse(
        `Summarize what this AI coding assistant is currently doing in 1 short sentence (max 15 words). Current status: ${job.progress?.status || 'working'}. Recent activity:\n${cleanOutput}`,
        { maxTokens: 30, temperature: 0.1 }
      );

      const summary = result.response?.trim().slice(0, 100);
      if (summary && job.progress) {
        job.progress.summary = summary;
        this.emit('job-progress', { job, progress: job.progress });
      }
    } catch {}
  }

  /**
   * Clean up old completed jobs (keep last N days)
   */
  async cleanup(daysToKeep = 7) {
    const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));
    let cleaned = 0;

    for (const file of files) {
      try {
        const jobPath = path.join(JOBS_DIR, file);
        const job = JSON.parse(fs.readFileSync(jobPath, 'utf-8'));

        if (job.status !== 'running' && job.status !== 'pending') {
          const completedAt = new Date(job.completedAt || job.createdAt).getTime();
          if (completedAt < cutoff) {
            fs.unlinkSync(jobPath);
            const outputPath = this._getOutputPath(job.id);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            cleaned++;
          }
        }
      } catch {}
    }

    console.log(`[JobManager] Cleaned up ${cleaned} old job(s)`);
    return cleaned;
  }
}

export const jobManager = new JobManager();
export default jobManager;
