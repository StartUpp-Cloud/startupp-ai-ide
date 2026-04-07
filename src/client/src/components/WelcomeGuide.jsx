import { useState } from 'react';
import {
  X,
  MessageSquare,
  Terminal,
  GitBranch,
  Layout,
  Sparkles,
  Shield,
  Cpu,
  Layers,
  Zap,
  BookOpen,
  ChevronRight,
  Bot,
  FolderOpen,
  Settings,
  Workflow,
} from 'lucide-react';

const SECTIONS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: BookOpen,
  },
  {
    id: 'getting-started',
    label: 'Getting Started',
    icon: Zap,
  },
  {
    id: 'features',
    label: 'Features',
    icon: Layers,
  },
  {
    id: 'agents',
    label: 'AI Agents',
    icon: Bot,
  },
  {
    id: 'tips',
    label: 'Tips & Shortcuts',
    icon: Sparkles,
  },
];

function FeatureCard({ icon: Icon, title, children, color = 'text-primary-400' }) {
  return (
    <div className="bg-surface-800/50 border border-surface-700/50 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={14} className={color} />
        <h4 className="text-sm font-medium text-surface-200">{title}</h4>
      </div>
      <p className="text-xs text-surface-400 leading-relaxed">{children}</p>
    </div>
  );
}

function SectionOverview() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-surface-100 mb-2">Welcome to StartUpp AI IDE</h3>
        <p className="text-sm text-surface-400 leading-relaxed">
          An autonomous AI development environment that orchestrates multiple AI coding agents
          (Claude, Copilot, Aider, Gemini) through a unified interface. Manage projects,
          execute multi-step plans, and let AI handle the heavy lifting while you stay in control.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FeatureCard icon={MessageSquare} title="Chat-Driven Development" color="text-orange-400">
          Talk to AI agents in natural language. They read, write, and refactor code in real-time
          inside Docker containers.
        </FeatureCard>
        <FeatureCard icon={Workflow} title="Plan Execution" color="text-blue-400">
          Break complex tasks into multi-step plans. The orchestrator executes each step
          sequentially with auto-commit and rollback support.
        </FeatureCard>
        <FeatureCard icon={Terminal} title="Integrated Terminals" color="text-green-400">
          Each project gets its own PTY session. Run commands, see output, and let the
          auto-responder handle CLI prompts automatically.
        </FeatureCard>
        <FeatureCard icon={Shield} title="Safety & Control" color="text-red-400">
          Risk assessment on every operation. High-risk actions require confirmation.
          Rollback points are created before dangerous changes.
        </FeatureCard>
      </div>
    </div>
  );
}

function SectionGettingStarted() {
  const steps = [
    {
      num: '1',
      title: 'Create a Project',
      desc: 'Go to Dashboard and create a project. Point it at a local folder or clone from Git. A Docker container is provisioned automatically.',
    },
    {
      num: '2',
      title: 'Select an AI Agent',
      desc: 'Use the tool selector in the top bar to choose your AI agent: Claude, Copilot, Aider, Gemini, or plain Shell.',
    },
    {
      num: '3',
      title: 'Start Chatting',
      desc: 'Type in the chat panel. Your message is sent to the AI agent running inside the project\'s container. It can read, write, and execute code.',
    },
    {
      num: '4',
      title: 'Review & Iterate',
      desc: 'Watch the terminal output in real-time. The auto-responder handles routine prompts (file reads, confirmations) so you can focus on reviewing results.',
    },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-surface-100">Getting Started</h3>
      <div className="space-y-3">
        {steps.map((step) => (
          <div key={step.num} className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-500/20 border border-primary-500/40 flex items-center justify-center">
              <span className="text-xs font-bold text-primary-400">{step.num}</span>
            </div>
            <div>
              <h4 className="text-sm font-medium text-surface-200">{step.title}</h4>
              <p className="text-xs text-surface-400 leading-relaxed mt-0.5">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-primary-500/5 border border-primary-500/20 rounded-lg p-3">
        <p className="text-xs text-primary-300 leading-relaxed">
          <strong>First time?</strong> Make sure your local LLM (Ollama) or API keys are configured
          in <Settings size={10} className="inline mb-0.5" /> LLM Settings before chatting.
        </p>
      </div>
    </div>
  );
}

function SectionFeatures() {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-surface-100">Core Features</h3>
      <div className="space-y-2">
        <FeatureCard icon={FolderOpen} title="Project Management" color="text-yellow-400">
          Create, clone, and manage multiple projects. Each gets an isolated Docker container
          with its own terminal sessions. Switch between projects instantly — state is preserved.
        </FeatureCard>
        <FeatureCard icon={Cpu} title="Local LLM Auto-Responder" color="text-green-400">
          A local LLM (via Ollama) watches terminal output and automatically answers routine
          CLI prompts — file read permissions, yes/no confirmations, continue prompts.
          Configurable confidence thresholds and risk levels.
        </FeatureCard>
        <FeatureCard icon={Layout} title="Plans & Orchestration" color="text-blue-400">
          Describe a complex goal and the LLM generates a multi-step plan. The orchestrator
          sends each step to the AI agent, waits for completion, auto-commits, and advances.
          Pause, resume, or skip steps at any time.
        </FeatureCard>
        <FeatureCard icon={GitBranch} title="Branch Review" color="text-purple-400">
          Analyze branches and diffs with AI assistance. Review changes, get summaries,
          and understand the impact of code modifications before merging.
        </FeatureCard>
        <FeatureCard icon={Sparkles} title="Skills System" color="text-cyan-400">
          Attach reusable skills (coding conventions, frameworks, patterns) to projects.
          Skills inject context into every AI interaction so agents follow your team's standards.
        </FeatureCard>
        <FeatureCard icon={Terminal} title="Internal Console" color="text-surface-300">
          A built-in shell at the bottom of the IDE for quick commands. Includes an AI command
          builder — describe what you want in plain English and it generates the shell command.
        </FeatureCard>
      </div>
    </div>
  );
}

function SectionAgents() {
  const agents = [
    { name: 'Claude', color: 'text-orange-400', desc: 'Full codebase understanding with conversation memory via --resume. Best for complex, multi-file tasks.' },
    { name: 'Copilot', color: 'text-blue-400', desc: 'GitHub Copilot CLI integration with conversation memory. Good for GitHub-centric workflows.' },
    { name: 'Aider', color: 'text-green-400', desc: 'Git-aware AI coding assistant. Context from git history and repo map. Great for targeted edits.' },
    { name: 'Gemini', color: 'text-cyan-400', desc: 'Google\'s Gemini model. Per-message context. Good for quick questions and code generation.' },
    { name: 'Shell', color: 'text-surface-400', desc: 'Direct shell access without an AI agent. Run any command in the project\'s container.' },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-surface-100">AI Agents</h3>
      <p className="text-sm text-surface-400">
        Switch agents at any time using the tool selector in the top bar. Each agent runs
        inside your project's Docker container with full filesystem access.
      </p>
      <div className="space-y-2">
        {agents.map((agent) => (
          <div key={agent.name} className="flex items-start gap-3 bg-surface-800/50 border border-surface-700/50 rounded-lg p-3">
            <div className="flex-shrink-0 mt-0.5">
              <Bot size={14} className={agent.color} />
            </div>
            <div>
              <h4 className={`text-sm font-medium ${agent.color}`}>{agent.name}</h4>
              <p className="text-xs text-surface-400 leading-relaxed mt-0.5">{agent.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-surface-800/50 border border-surface-700/50 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Cpu size={14} className="text-green-400" />
          <h4 className="text-sm font-medium text-surface-200">Auto-Responder</h4>
        </div>
        <p className="text-xs text-surface-400 leading-relaxed">
          Regardless of which agent you use, the local LLM watches the terminal and
          handles routine prompts automatically. Configure what gets auto-approved
          in LLM Settings &gt; Security.
        </p>
      </div>
    </div>
  );
}

function SectionTips() {
  const tips = [
    { label: 'Agent vs Ask mode', desc: 'Agent mode lets the AI execute code. Ask mode is read-only — great for questions without side effects.' },
    { label: 'Multi-project tabs', desc: 'Open multiple projects and switch between them. Each project\'s chat and terminal state is preserved independently.' },
    { label: 'Quick Capture', desc: 'Take screenshots of your app and send them directly to the AI for visual feedback and debugging.' },
    { label: 'File attachments', desc: 'Attach files, paste text, or use git diffs as context when chatting. The LLM generates optimized prompts from your attachments.' },
    { label: 'Global Rules', desc: 'Define rules that apply across all projects (coding standards, naming conventions). Each project can also have its own rules.' },
    { label: 'Command Builder', desc: 'In the Internal Console, describe what you want in English and the LLM generates the shell command. Hit Enter to run it.' },
    { label: 'Plan templates', desc: 'Save and reuse plans for common workflows like "set up a new API endpoint" or "add tests for a module".' },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-surface-100">Tips & Shortcuts</h3>
      <div className="space-y-1.5">
        {tips.map((tip) => (
          <div key={tip.label} className="flex items-start gap-2 py-1.5">
            <ChevronRight size={12} className="text-primary-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="text-sm text-surface-200 font-medium">{tip.label}</span>
              <span className="text-sm text-surface-400"> — {tip.desc}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const SECTION_COMPONENTS = {
  'overview': SectionOverview,
  'getting-started': SectionGettingStarted,
  'features': SectionFeatures,
  'agents': SectionAgents,
  'tips': SectionTips,
};

export default function WelcomeGuide({ isOpen, onClose }) {
  const [activeSection, setActiveSection] = useState('overview');

  if (!isOpen) return null;

  const ActiveContent = SECTION_COMPONENTS[activeSection];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-850 border border-surface-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700 bg-surface-800">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary-400" />
            <h2 className="text-lg font-semibold text-surface-100">Welcome Guide</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-surface-700 rounded-lg transition-colors text-surface-400 hover:text-surface-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar nav */}
          <nav className="w-44 flex-shrink-0 border-r border-surface-700 bg-surface-800/50 py-2">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`flex items-center gap-2 w-full px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? 'text-primary-400 bg-primary-500/10 border-r-2 border-primary-400'
                      : 'text-surface-400 hover:text-surface-200 hover:bg-surface-750'
                  }`}
                >
                  <Icon size={14} />
                  {section.label}
                </button>
              );
            })}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            <ActiveContent />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-surface-700 bg-surface-800/50">
          <label className="flex items-center gap-2 text-xs text-surface-500 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-surface-600 bg-surface-800 text-primary-500 focus:ring-primary-500/30"
              onChange={(e) => {
                if (e.target.checked) {
                  localStorage.setItem('hideWelcomeGuide', 'true');
                } else {
                  localStorage.removeItem('hideWelcomeGuide');
                }
              }}
              defaultChecked={localStorage.getItem('hideWelcomeGuide') === 'true'}
            />
            Don't show on startup
          </label>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium text-surface-200 bg-primary-500/20 hover:bg-primary-500/30 border border-primary-500/30 rounded-lg transition-colors"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
