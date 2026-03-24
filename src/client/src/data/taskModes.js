// Task modes define different contexts for AI interactions
// Each mode has specific rules and a checklist to ensure quality

export const TASK_MODES = [
  {
    id: "bug-fix",
    name: "Bug Fix",
    icon: "Bug",
    description: "Fix a specific bug with minimal changes",
    template:
      "I need help fixing a bug in my {projectName} project. Please analyze the issue and provide a focused solution.",
    additionalRules: [
      "Make minimal changes — fix only the specific bug, do not refactor surrounding code",
      "Identify and explain the root cause before implementing any fix",
      "Add a regression test that would have caught this bug",
      "Do not introduce new dependencies unless absolutely necessary",
      "Preserve existing behavior in all other code paths",
      "If the fix requires changes in multiple files, explain why each change is necessary",
    ],
    checklist: [
      "Root cause clearly identified and explained",
      "Fix addresses only the specific bug",
      "No unrelated changes or refactoring",
      "Regression test added",
      "Existing tests still pass",
    ],
  },
  {
    id: "new-feature",
    name: "New Feature",
    icon: "Sparkles",
    description: "Implement a new feature from scratch",
    template:
      "I want to implement a new feature for my {projectName} project. Please provide a comprehensive implementation.",
    additionalRules: [
      "Start with a clear explanation of the implementation approach before writing code",
      "Consider edge cases and error handling from the beginning",
      "Write tests alongside the implementation, not as an afterthought",
      "Follow existing patterns and conventions in the codebase",
      "Keep the implementation focused — avoid scope creep",
      "Document any new public APIs or interfaces",
    ],
    checklist: [
      "Implementation approach explained",
      "Edge cases handled",
      "Error handling implemented",
      "Tests written and passing",
      "Follows existing code patterns",
      "No unnecessary scope creep",
    ],
  },
  {
    id: "refactor",
    name: "Refactor",
    icon: "RefreshCw",
    description: "Improve code structure without changing behavior",
    template:
      "I need to refactor code in my {projectName} project. Please improve the structure while maintaining all existing behavior.",
    additionalRules: [
      "Do not change any external behavior — all existing tests must pass without modification",
      "Make changes incrementally, ensuring the code works after each step",
      "Explain the benefit of each refactoring change",
      "If you need to modify tests, it means you're changing behavior — stop and clarify",
      "Prefer small, focused refactoring over large sweeping changes",
      "Document any changes to internal APIs that other code depends on",
    ],
    checklist: [
      "All existing tests pass without modification",
      "No behavior changes introduced",
      "Each change has clear benefit explained",
      "Changes are incremental and reversible",
      "Internal API changes documented",
    ],
  },
  {
    id: "code-review",
    name: "Code Review",
    icon: "Eye",
    description: "Analyze code and provide feedback without modifications",
    template:
      "Please review this code from my {projectName} project and provide detailed feedback.",
    additionalRules: [
      "Do not modify any code — only analyze and provide feedback",
      "Categorize issues by severity: critical, major, minor, suggestion",
      "Explain why each issue is a problem, not just what the problem is",
      "Suggest specific improvements with example code snippets",
      "Consider security, performance, maintainability, and correctness",
      "Acknowledge what the code does well, not just problems",
    ],
    checklist: [
      "Security issues identified",
      "Performance concerns noted",
      "Code correctness verified",
      "Maintainability assessed",
      "Specific improvements suggested",
      "No code modifications made",
    ],
  },
  {
    id: "performance",
    name: "Performance Optimization",
    icon: "Zap",
    description: "Improve performance with measured results",
    template:
      "I need to optimize performance in my {projectName} project. Please analyze and suggest specific optimizations.",
    additionalRules: [
      "Profile and identify the actual bottleneck before optimizing",
      "Explain the expected performance improvement for each change",
      "Do not optimize code that isn't a bottleneck — avoid premature optimization",
      "Ensure optimizations don't sacrifice code readability without significant gains",
      "Consider memory usage, not just execution speed",
      "Provide before/after comparisons where possible",
    ],
    checklist: [
      "Bottleneck identified through profiling",
      "Expected improvement quantified",
      "No premature optimizations",
      "Readability maintained where possible",
      "Memory impact considered",
      "All tests still pass",
    ],
  },
  {
    id: "security",
    name: "Security Fix",
    icon: "Shield",
    description: "Address security vulnerabilities",
    template:
      "I need to fix a security issue in my {projectName} project. Please analyze the vulnerability and provide a secure solution.",
    additionalRules: [
      "Explain the vulnerability in detail — what attack vector does it enable?",
      "Fix the root cause, not just the symptom",
      "Check for similar vulnerabilities elsewhere in the codebase",
      "Add tests that verify the vulnerability is fixed",
      "Consider the OWASP Top 10 when reviewing the fix",
      "Do not log or expose sensitive information in error messages",
    ],
    checklist: [
      "Vulnerability clearly explained",
      "Root cause addressed",
      "Similar issues checked elsewhere",
      "Security test added",
      "No sensitive data exposed",
      "OWASP guidelines considered",
    ],
  },
  {
    id: "testing",
    name: "Write Tests",
    icon: "TestTube",
    description: "Add or improve test coverage",
    template:
      "I need to add tests for my {projectName} project. Please help me write comprehensive tests.",
    additionalRules: [
      "Test behavior, not implementation details",
      "Cover happy path, edge cases, and error cases",
      "Each test should test one thing and have a descriptive name",
      "Use arrange-act-assert pattern for clarity",
      "Mock external dependencies, not internal code",
      "Tests should be deterministic — no flaky tests",
    ],
    checklist: [
      "Happy path tested",
      "Edge cases covered",
      "Error cases handled",
      "Tests are focused and descriptive",
      "No flaky tests",
      "External dependencies mocked appropriately",
    ],
  },
  {
    id: "documentation",
    name: "Documentation",
    icon: "FileText",
    description: "Create or improve documentation",
    template:
      "I need help documenting my {projectName} project. Please help create clear and comprehensive documentation.",
    additionalRules: [
      "Write for the intended audience — don't assume prior knowledge",
      "Include practical examples for all documented features",
      "Keep documentation close to the code it documents",
      "Document the 'why', not just the 'what'",
      "Use consistent formatting and terminology",
      "Include common pitfalls and troubleshooting tips",
    ],
    checklist: [
      "Audience-appropriate language used",
      "Examples included",
      "Purpose explained (the 'why')",
      "Consistent formatting",
      "Common pitfalls documented",
    ],
  },
  {
    id: "prototype",
    name: "Prototype / Spike",
    icon: "FlaskConical",
    description: "Quick exploration without production requirements",
    template:
      "I need to prototype a concept for my {projectName} project. Focus on speed over polish.",
    additionalRules: [
      "Prioritize speed of implementation over code quality",
      "Skip comprehensive error handling — focus on the happy path",
      "Tests are optional for prototypes",
      "Use TODOs to mark shortcuts that need addressing for production",
      "Document assumptions and limitations clearly",
      "This code is NOT production-ready — make that explicit",
    ],
    checklist: [
      "Core concept demonstrated",
      "TODOs mark production requirements",
      "Assumptions documented",
      "Limitations noted",
      "Marked as non-production code",
    ],
  },
  {
    id: "custom",
    name: "Custom",
    icon: "Settings",
    description: "No additional task-specific rules",
    template: "",
    additionalRules: [],
    checklist: [],
  },
];

// Get task mode by ID
export const getTaskMode = (id) => TASK_MODES.find((mode) => mode.id === id);

// Get all task modes except custom (for display purposes)
export const getStandardTaskModes = () =>
  TASK_MODES.filter((mode) => mode.id !== "custom");
