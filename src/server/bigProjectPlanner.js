/**
 * Big Project Planner
 * Breaks down large projects into focused iterations with automated workflows
 *
 * Flow: Describe Project → LLM splits into iterations → Execute one by one
 * Each iteration: Plan → Code → Test → Commit → Next
 */

import { getDB } from './db.js';
import { v4 as uuidv4 } from 'uuid';
import { llmProvider } from './llmProvider.js';
import { sessionContext } from './sessionContext.js';
import { EventEmitter } from 'events';

// Iteration workflow states
export const WORKFLOW_STATES = {
  PENDING: 'pending',
  PLANNING: 'planning',
  CODING: 'coding',
  TESTING: 'testing',
  COMMITTING: 'committing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  PAUSED: 'paused',
};

// Default workflow steps
export const WORKFLOW_STEPS = [
  { id: 'plan', name: 'Plan', state: WORKFLOW_STATES.PLANNING },
  { id: 'code', name: 'Code', state: WORKFLOW_STATES.CODING },
  { id: 'test', name: 'Test', state: WORKFLOW_STATES.TESTING },
  { id: 'commit', name: 'Commit', state: WORKFLOW_STATES.COMMITTING },
];

// System prompt for breaking down projects
const BREAKDOWN_SYSTEM_PROMPT = `You are a senior software architect helping to break down a large project into manageable iterations.

Your task is to analyze the project description and create a structured plan with multiple iterations.

## Guidelines for Breaking Down Projects:

1. **Iteration Size**: Each iteration should be completable in 1-2 focused coding sessions
2. **Independence**: Try to make iterations as independent as possible
3. **Dependencies**: If iterations depend on each other, note the dependencies
4. **Testability**: Each iteration should have clear acceptance criteria that can be tested
5. **Incremental Value**: Each iteration should add working functionality

## Output Format (JSON):
{
  "projectTitle": "Short project title",
  "projectSummary": "1-2 sentence summary",
  "totalIterations": number,
  "estimatedComplexity": "low" | "medium" | "high",
  "iterations": [
    {
      "order": 1,
      "title": "Iteration title",
      "description": "What this iteration accomplishes",
      "tasks": ["Task 1", "Task 2"],
      "acceptanceCriteria": ["Criteria 1", "Criteria 2"],
      "dependencies": [], // iteration orders this depends on
      "estimatedScope": "small" | "medium" | "large",
      "cliPrompt": "The exact prompt to send to the AI CLI to implement this iteration"
    }
  ],
  "technicalNotes": "Any important technical considerations",
  "suggestedCommitPrefix": "feat|fix|refactor|etc"
}

Respond with ONLY the JSON, no markdown code blocks or explanation.`;

// Prompts for each workflow stage
const STAGE_PROMPTS = {
  plan: (iteration, projectContext) => `
## Planning Phase: ${iteration.title}

Please analyze and plan the implementation for this iteration:

**Description:** ${iteration.description}

**Tasks:**
${iteration.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}

**Acceptance Criteria:**
${iteration.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${projectContext ? `**Project Context:**\n${projectContext}` : ''}

Please:
1. Analyze the existing codebase structure
2. Identify files that need to be created or modified
3. Outline your implementation approach
4. Note any potential challenges

Start by exploring the codebase, then provide your plan.
`.trim(),

  code: (iteration, planSummary) => `
## Implementation Phase: ${iteration.title}

Now implement the planned changes:

${planSummary ? `**Plan Summary:**\n${planSummary}\n` : ''}

**Tasks to Complete:**
${iteration.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Please implement these changes. Focus on clean, working code that meets the acceptance criteria.
`.trim(),

  test: (iteration) => `
## Testing Phase: ${iteration.title}

Please verify the implementation meets the acceptance criteria:

**Acceptance Criteria:**
${iteration.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Please:
1. Run any relevant tests
2. Verify each acceptance criterion
3. Fix any issues found
4. Confirm everything is working
`.trim(),

  commit: (iteration, projectTitle) => `
## Commit Phase: ${iteration.title}

Please create a commit for the completed work.

Use this commit message format:
${iteration.suggestedCommitPrefix || 'feat'}(${projectTitle.toLowerCase().replace(/\s+/g, '-')}): ${iteration.title}

- ${iteration.tasks.join('\n- ')}

Please stage the relevant files and create the commit.
`.trim(),
};

class BigProjectPlanner extends EventEmitter {
  constructor() {
    super();
    this.activePlans = new Map(); // planId -> plan execution state
  }

  /**
   * Initialize from database
   */
  async init() {
    const db = getDB();
    if (!db.data.bigProjects) {
      db.data.bigProjects = [];
      await db.write();
    }
    console.log('Big Project Planner initialized');
  }

  /**
   * Create a new big project from description
   */
  async createProject(description, options = {}) {
    const { projectId, projectPath, cliTool = 'claude' } = options;

    // Use LLM to break down the project
    const breakdown = await this.breakdownProject(description, options);

    if (!breakdown) {
      throw new Error('Failed to break down project');
    }

    // Create the project record
    const bigProject = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'pending',

      // Project info
      title: breakdown.projectTitle,
      summary: breakdown.projectSummary,
      originalDescription: description,

      // Linked project
      projectId,
      projectPath,
      cliTool,

      // Iterations
      totalIterations: breakdown.totalIterations,
      currentIteration: 0,
      iterations: breakdown.iterations.map((iter, idx) => ({
        ...iter,
        id: uuidv4(),
        status: idx === 0 ? WORKFLOW_STATES.PENDING : WORKFLOW_STATES.PENDING,
        workflowStep: null,
        startedAt: null,
        completedAt: null,
        sessionId: null,
        notes: '',
        planSummary: null,
      })),

      // Metadata
      estimatedComplexity: breakdown.estimatedComplexity,
      technicalNotes: breakdown.technicalNotes,
      suggestedCommitPrefix: breakdown.suggestedCommitPrefix,

      // Execution state
      isRunning: false,
      isPaused: false,
      lastError: null,
    };

    // Save to database
    const db = getDB();
    db.data.bigProjects.push(bigProject);
    await db.write();

    this.emit('project-created', bigProject);

    return bigProject;
  }

  /**
   * Use LLM to break down a project description into iterations
   */
  async breakdownProject(description, options = {}) {
    const { projectPath, additionalContext } = options;

    // Build context
    let context = '';
    if (projectPath) {
      const sessionCtx = sessionContext.buildLLMContext('temp-breakdown');
      if (sessionCtx.fileTree) {
        context += `\n\nProject File Structure:\n${sessionCtx.fileTree.slice(0, 3000)}`;
      }
      if (sessionCtx.claudeMd) {
        context += `\n\nProject Guidelines (CLAUDE.md):\n${sessionCtx.claudeMd.slice(0, 1000)}`;
      }
    }
    if (additionalContext) {
      context += `\n\nAdditional Context:\n${additionalContext}`;
    }

    const userPrompt = `Break down this project into iterations:

## Project Description:
${description}
${context}

Respond with the JSON breakdown.`;

    try {
      const result = await llmProvider.generateResponse(userPrompt, {
        systemPrompt: BREAKDOWN_SYSTEM_PROMPT,
      });

      // Parse the JSON response
      const jsonStr = result.response.trim();
      const breakdown = JSON.parse(jsonStr);

      return breakdown;
    } catch (error) {
      console.error('Failed to breakdown project:', error);
      throw new Error(`Failed to breakdown project: ${error.message}`);
    }
  }

  /**
   * Get all big projects
   */
  async getProjects(projectId = null) {
    const db = getDB();
    let projects = db.data.bigProjects || [];

    if (projectId) {
      projects = projects.filter(p => p.projectId === projectId);
    }

    return projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Get a specific project
   */
  async getProject(id) {
    const db = getDB();
    return db.data.bigProjects?.find(p => p.id === id);
  }

  /**
   * Start or resume a project
   */
  async startProject(id) {
    const project = await this.getProject(id);
    if (!project) {
      throw new Error('Project not found');
    }

    if (project.isRunning) {
      throw new Error('Project is already running');
    }

    // Find the next pending iteration
    const nextIteration = project.iterations.find(
      iter => iter.status === WORKFLOW_STATES.PENDING || iter.status === WORKFLOW_STATES.PAUSED
    );

    if (!nextIteration) {
      throw new Error('No pending iterations');
    }

    // Update project state
    project.isRunning = true;
    project.isPaused = false;
    project.status = 'running';
    project.updatedAt = new Date().toISOString();

    await this.saveProject(project);

    // Start the iteration workflow
    this.emit('project-started', project);

    return {
      project,
      nextIteration,
      prompt: this.generateIterationStartPrompt(project, nextIteration),
    };
  }

  /**
   * Pause a running project
   */
  async pauseProject(id) {
    const project = await this.getProject(id);
    if (!project) {
      throw new Error('Project not found');
    }

    project.isRunning = false;
    project.isPaused = true;
    project.status = 'paused';
    project.updatedAt = new Date().toISOString();

    // Pause current iteration
    const currentIter = project.iterations.find(
      iter => iter.status !== WORKFLOW_STATES.COMPLETED && iter.status !== WORKFLOW_STATES.PENDING
    );
    if (currentIter) {
      currentIter.status = WORKFLOW_STATES.PAUSED;
    }

    await this.saveProject(project);
    this.emit('project-paused', project);

    return project;
  }

  /**
   * Start a specific iteration
   */
  async startIteration(projectId, iterationId) {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const iteration = project.iterations.find(i => i.id === iterationId);
    if (!iteration) {
      throw new Error('Iteration not found');
    }

    // Check dependencies
    for (const depOrder of iteration.dependencies || []) {
      const depIter = project.iterations.find(i => i.order === depOrder);
      if (depIter && depIter.status !== WORKFLOW_STATES.COMPLETED) {
        throw new Error(`Depends on iteration ${depOrder} which is not completed`);
      }
    }

    // Update iteration state
    iteration.status = WORKFLOW_STATES.PLANNING;
    iteration.workflowStep = 'plan';
    iteration.startedAt = new Date().toISOString();
    project.currentIteration = iteration.order;
    project.isRunning = true;
    project.status = 'running';

    await this.saveProject(project);

    // Generate the planning prompt
    const prompt = STAGE_PROMPTS.plan(iteration, project.technicalNotes);

    this.emit('iteration-started', { project, iteration });

    return {
      project,
      iteration,
      prompt,
      workflowStep: 'plan',
    };
  }

  /**
   * Advance to the next workflow step
   */
  async advanceWorkflow(projectId, iterationId, notes = '') {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const iteration = project.iterations.find(i => i.id === iterationId);
    if (!iteration) {
      throw new Error('Iteration not found');
    }

    const currentStepIdx = WORKFLOW_STEPS.findIndex(s => s.id === iteration.workflowStep);
    const nextStep = WORKFLOW_STEPS[currentStepIdx + 1];

    if (!nextStep) {
      // Workflow complete
      return this.completeIteration(projectId, iterationId, notes);
    }

    // Save notes from current step
    if (notes && iteration.workflowStep === 'plan') {
      iteration.planSummary = notes;
    }

    // Advance to next step
    iteration.workflowStep = nextStep.id;
    iteration.status = nextStep.state;

    await this.saveProject(project);

    // Generate prompt for next step
    let prompt;
    switch (nextStep.id) {
      case 'code':
        prompt = STAGE_PROMPTS.code(iteration, iteration.planSummary);
        break;
      case 'test':
        prompt = STAGE_PROMPTS.test(iteration);
        break;
      case 'commit':
        prompt = STAGE_PROMPTS.commit(iteration, project.title);
        break;
      default:
        prompt = iteration.cliPrompt;
    }

    this.emit('workflow-advanced', { project, iteration, step: nextStep });

    return {
      project,
      iteration,
      prompt,
      workflowStep: nextStep.id,
    };
  }

  /**
   * Complete an iteration
   */
  async completeIteration(projectId, iterationId, notes = '') {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const iteration = project.iterations.find(i => i.id === iterationId);
    if (!iteration) {
      throw new Error('Iteration not found');
    }

    // Mark iteration complete
    iteration.status = WORKFLOW_STATES.COMPLETED;
    iteration.completedAt = new Date().toISOString();
    iteration.notes = notes;
    iteration.workflowStep = null;

    // Check if all iterations are complete
    const allComplete = project.iterations.every(
      i => i.status === WORKFLOW_STATES.COMPLETED
    );

    if (allComplete) {
      project.status = 'completed';
      project.isRunning = false;
    }

    await this.saveProject(project);

    this.emit('iteration-completed', { project, iteration });

    // Find next iteration if any
    const nextIteration = project.iterations.find(
      i => i.status === WORKFLOW_STATES.PENDING
    );

    return {
      project,
      iteration,
      isProjectComplete: allComplete,
      nextIteration,
    };
  }

  /**
   * Mark iteration as failed
   */
  async failIteration(projectId, iterationId, error) {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const iteration = project.iterations.find(i => i.id === iterationId);
    if (!iteration) {
      throw new Error('Iteration not found');
    }

    iteration.status = WORKFLOW_STATES.FAILED;
    iteration.notes = `Failed: ${error}`;
    project.lastError = error;
    project.isRunning = false;
    project.status = 'failed';

    await this.saveProject(project);

    this.emit('iteration-failed', { project, iteration, error });

    return { project, iteration };
  }

  /**
   * Retry a failed iteration
   */
  async retryIteration(projectId, iterationId) {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const iteration = project.iterations.find(i => i.id === iterationId);
    if (!iteration) {
      throw new Error('Iteration not found');
    }

    // Reset iteration state
    iteration.status = WORKFLOW_STATES.PENDING;
    iteration.workflowStep = null;
    iteration.notes = '';
    project.lastError = null;

    await this.saveProject(project);

    return this.startIteration(projectId, iterationId);
  }

  /**
   * Generate the prompt to start an iteration
   */
  generateIterationStartPrompt(project, iteration) {
    return `
# Starting Iteration ${iteration.order}/${project.totalIterations}: ${iteration.title}

${iteration.description}

## Tasks:
${iteration.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}

## Acceptance Criteria:
${iteration.acceptanceCriteria.map((c, i) => `- ${c}`).join('\n')}

${iteration.dependencies?.length > 0 ? `\n## Dependencies:\nThis iteration depends on iterations: ${iteration.dependencies.join(', ')}\n` : ''}

Let's start with the **Planning Phase**. Please analyze the codebase and outline your implementation approach.
`.trim();
  }

  /**
   * Delete a project
   */
  async deleteProject(id) {
    const db = getDB();
    const idx = db.data.bigProjects?.findIndex(p => p.id === id);
    if (idx === -1) {
      throw new Error('Project not found');
    }

    db.data.bigProjects.splice(idx, 1);
    await db.write();

    this.emit('project-deleted', { id });
    return true;
  }

  /**
   * Update project notes
   */
  async updateProjectNotes(id, notes) {
    const project = await this.getProject(id);
    if (!project) {
      throw new Error('Project not found');
    }

    project.technicalNotes = notes;
    project.updatedAt = new Date().toISOString();
    await this.saveProject(project);

    return project;
  }

  /**
   * Save project to database
   */
  async saveProject(project) {
    const db = getDB();
    const idx = db.data.bigProjects?.findIndex(p => p.id === project.id);
    if (idx !== -1) {
      db.data.bigProjects[idx] = project;
      await db.write();
    }
  }

  /**
   * Get progress summary
   */
  getProgressSummary(project) {
    const completed = project.iterations.filter(
      i => i.status === WORKFLOW_STATES.COMPLETED
    ).length;
    const failed = project.iterations.filter(
      i => i.status === WORKFLOW_STATES.FAILED
    ).length;
    const inProgress = project.iterations.filter(
      i => ![WORKFLOW_STATES.PENDING, WORKFLOW_STATES.COMPLETED, WORKFLOW_STATES.FAILED].includes(i.status)
    ).length;

    return {
      total: project.totalIterations,
      completed,
      failed,
      inProgress,
      pending: project.totalIterations - completed - failed - inProgress,
      percentComplete: Math.round((completed / project.totalIterations) * 100),
    };
  }
}

// Singleton instance
export const bigProjectPlanner = new BigProjectPlanner();

export default bigProjectPlanner;
