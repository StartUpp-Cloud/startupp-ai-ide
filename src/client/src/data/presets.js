export const PRESETS = [
  {
    id: "ai-guardrails",
    name: "General AI Guardrails",
    description:
      "Universal rules to include in any AI assistant prompt for consistently better results",
    rules: [
      // Quality Standards
      "Do not stop working until you reach at least 95% confidence that the implementation is high quality, production-ready, and fully addresses the requirements",
      "Do not use mocks, stubs, placeholders, or workarounds — implement the real, complete solution",
      "Everything must be tested — write unit tests, integration tests, or E2E tests as appropriate for the change",
      "Explain your reasoning for all significant decisions, trade-offs, and architectural choices",
      // Implementation Standards
      "Ask for clarification before making assumptions about ambiguous requirements",
      "Show the complete implementation, not just snippets or changed parts",
      "Consider edge cases, error handling, and failure modes in every implementation",
      "Follow the existing code style, patterns, and conventions in the project",
      "Do not remove or modify existing functionality unless explicitly asked",
      // Verification
      "After implementing, verify the solution works by tracing through the code logic",
      "If tests exist, ensure they pass. If no tests exist, write them",
      "Consider performance implications and optimize where necessary",
    ],
  },
  {
    id: "react-typescript",
    name: "React + TypeScript",
    description: "Comprehensive guardrails for React apps using TypeScript",
    rules: [
      // TypeScript Standards
      "Always use TypeScript with strict mode enabled in tsconfig.json",
      "Never use `any` type — use `unknown` with type guards, or define proper types",
      "Define explicit return types for all functions, especially React components",
      "Use Zod for runtime validation of external data (API responses, form inputs, URL params)",
      "Create shared type definitions in a dedicated types/ directory",
      // React Patterns
      "Use functional components with hooks — never class components",
      "Define prop types using TypeScript interfaces (prefix with I) or types",
      "Use React.FC sparingly — prefer explicit prop typing: `function Component(props: Props)`",
      "Memoize expensive computations with useMemo and callbacks with useCallback",
      "Use React Query or TanStack Query for server state — not useState+useEffect for data fetching",
      // Component Design
      "Keep components small and focused — extract logic into custom hooks",
      "Colocate related files: Component.tsx, Component.test.tsx, Component.module.css",
      "Use compound components or render props for flexible, reusable UI patterns",
      "Handle loading, error, and empty states explicitly in every data-driven component",
      // Testing
      "Write tests using React Testing Library — test behavior, not implementation",
      "Test user interactions, not internal state changes",
      "Mock API calls at the network level using MSW (Mock Service Worker)",
    ],
  },
  {
    id: "rest-api",
    name: "REST API Design",
    description: "Best practices for designing and building REST APIs",
    rules: [
      // Design Standards
      "Follow RESTful conventions: plural nouns for collections (e.g., /users, /orders)",
      "Use proper HTTP methods: GET (read), POST (create), PUT (replace), PATCH (update), DELETE (remove)",
      "Version all API endpoints explicitly (e.g., /api/v1/users)",
      "Use consistent response envelope: { success: boolean, data?: T, error?: { code, message }, meta?: { pagination } }",
      // Validation & Security
      "Validate ALL request inputs using a schema validation library (Zod, Joi, Yup)",
      "Reject invalid requests early with 400 Bad Request and descriptive error messages",
      "Never expose internal error details, stack traces, or system info in production",
      "Implement request rate limiting and size limits on all endpoints",
      // HTTP Standards
      "Use correct HTTP status codes: 200 OK, 201 Created, 204 No Content, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict, 422 Unprocessable Entity, 500 Internal Server Error",
      "Return 201 with Location header for resource creation",
      "Support pagination for all list endpoints: { page, limit, total, totalPages }",
      "Use ETag headers for caching and conditional requests",
      // Documentation
      "Document all endpoints with OpenAPI/Swagger specification",
      "Include request/response examples for every endpoint",
      "Document error codes and their meanings",
    ],
  },
  {
    id: "security",
    name: "Security Guardrails",
    description: "OWASP-aligned security rules for any codebase",
    rules: [
      // Secrets Management
      "Never hardcode secrets, API keys, tokens, or credentials in source code",
      "Use environment variables or a secrets manager (Vault, AWS Secrets Manager, Azure Key Vault)",
      "Rotate secrets regularly and support secret rotation without deployments",
      "Add secrets patterns to .gitignore and use git-secrets or similar pre-commit hooks",
      // Input Validation
      "Validate and sanitize ALL user inputs on the server side — never trust client validation alone",
      "Use parameterized queries or prepared statements to prevent SQL injection",
      "Encode output to prevent XSS — use framework auto-escaping, never raw HTML insertion",
      "Validate file uploads: check type, size, and scan for malware",
      // Authentication & Authorization
      "Implement proper authentication before any data access or mutation",
      "Use industry-standard auth: OAuth 2.0, OpenID Connect, or established libraries",
      "Apply principle of least privilege — users get minimum permissions needed",
      "Implement proper session management: secure cookies, token expiration, refresh rotation",
      // Logging & Monitoring
      "Log all authentication attempts, authorization failures, and security events",
      "Never log sensitive data: passwords, tokens, PII, credit card numbers",
      "Implement alerting for suspicious patterns (brute force, unusual access)",
      // Transport & Infrastructure
      "Use HTTPS/TLS for ALL communications — no exceptions",
      "Set security headers: CSP, X-Frame-Options, X-Content-Type-Options, HSTS",
      "Keep dependencies updated and scan for known vulnerabilities regularly",
    ],
  },
  {
    id: "cloudflare-workers",
    name: "Cloudflare Workers",
    description: "Rules for building on the Cloudflare edge platform",
    rules: [
      // Architecture
      "Use Hono.js for routing — it's lightweight, fast, and designed for edge",
      "Keep worker bundle size under 1MB — avoid heavy Node.js dependencies",
      "Use Cloudflare bindings (KV, D1, R2, Queues) instead of external services where possible",
      "Design for statelessness — workers can run in any location",
      // Validation with Zod
      "Use Zod for ALL input validation: request bodies, query params, headers",
      "Create shared Zod schemas for request/response types and reuse across endpoints",
      "Use z.coerce for query parameters that need type conversion (strings to numbers)",
      "Export inferred TypeScript types from Zod schemas: `type User = z.infer<typeof UserSchema>`",
      "Validate environment variables at startup using Zod schemas",
      // Storage Selection
      "Use KV for: configuration, feature flags, session data, cached API responses",
      "Use D1 for: relational data, complex queries, transactions, structured data",
      "Use R2 for: file storage, images, large objects, static assets",
      "Use Durable Objects for: real-time collaboration, WebSocket state, rate limiting with counters",
      "Use Queues for: async processing, webhooks, background jobs",
      // Configuration
      "Define all bindings, routes, and environments in wrangler.toml",
      "Use different environments: dev, staging, production with environment-specific secrets",
      "Store secrets using `wrangler secret put` — never in wrangler.toml or code",
      // Error Handling
      "Always return proper Response objects with appropriate status codes",
      "Implement global error handling middleware that catches and formats errors",
      "Use structured error responses: { error: { code, message, details? } }",
      // Testing
      "Use Miniflare for local development and testing",
      "Write integration tests that test actual worker behavior",
      "Test with wrangler dev before deploying",
    ],
  },
  {
    id: "mobile-expo",
    name: "Expo / React Native",
    description: "Mobile development rules for Expo and React Native projects",
    rules: [
      // Project Setup
      "Use Expo managed workflow unless native modules absolutely require bare workflow",
      "Use Expo Router for file-based navigation — it's the modern standard",
      "Configure app.json/app.config.js properly for both iOS and Android",
      "Use EAS Build for production builds — avoid local native builds",
      // Cross-Platform Development
      "Test on BOTH iOS and Android throughout development — not just at the end",
      "Handle platform differences with Platform.OS or platform-specific file extensions (.ios.tsx, .android.tsx)",
      "Use responsive units (%, flex) not fixed pixels for layouts",
      "Test on multiple screen sizes and orientations",
      // Security
      "Use Expo SecureStore for sensitive data (tokens, credentials)",
      "Never store secrets in AsyncStorage — it's not encrypted",
      "Validate and sanitize all data before storage",
      "Use certificate pinning for sensitive API communications",
      // Performance
      "Use FlashList instead of FlatList for long lists",
      "Optimize images with Expo Image component and proper caching",
      "Use React Native Reanimated for smooth 60fps animations",
      "Profile with React DevTools and Flipper to find performance issues",
      // Permissions & UX
      "Request permissions gracefully with clear explanations of why they're needed",
      "Handle permission denial gracefully — provide alternative flows",
      "Implement proper deep linking with Expo Router",
      "Support dark mode and respect system preferences",
      // Testing
      "Write component tests with React Native Testing Library",
      "Test on real devices, not just simulators — especially for performance",
      "Use Detox for E2E testing of critical flows",
    ],
  },
  {
    id: "dotnet-azure",
    name: "Microsoft .NET + Azure",
    description: "Best practices for .NET applications deployed on Azure",
    rules: [
      // .NET Standards
      "Use the latest LTS version of .NET (currently .NET 8)",
      "Follow Microsoft's naming conventions: PascalCase for public members, _camelCase for private fields",
      "Use nullable reference types (enable in .csproj) and handle nulls explicitly",
      "Prefer record types for DTOs and immutable data structures",
      "Use dependency injection — register services in Program.cs or Startup.cs",
      // Validation
      "Use FluentValidation for complex validation rules",
      "Use Data Annotations for simple model validation",
      "Validate all inputs at API boundaries — never trust client data",
      "Return ProblemDetails (RFC 7807) for all error responses",
      // Azure Integration
      "Use Managed Identity for Azure service authentication — no connection strings in code",
      "Store secrets in Azure Key Vault, not in appsettings.json",
      "Use Azure App Configuration for feature flags and dynamic configuration",
      "Implement proper health checks with IHealthCheck for Azure monitoring",
      // Data Access
      "Use Entity Framework Core with migrations for database changes",
      "Use async/await for all database operations — never block on I/O",
      "Implement Repository pattern or use EF Core directly — be consistent",
      "Use Azure SQL or Cosmos DB based on data model requirements",
      // Logging & Monitoring
      "Use ILogger<T> for structured logging throughout the application",
      "Integrate with Application Insights for telemetry, tracing, and monitoring",
      "Log correlation IDs across service boundaries for distributed tracing",
      "Use Azure Monitor alerts for proactive issue detection",
      // Testing
      "Write unit tests with xUnit and Moq/NSubstitute",
      "Use WebApplicationFactory for integration testing APIs",
      "Test with in-memory database or Testcontainers for data layer tests",
      "Achieve minimum 80% code coverage on business logic",
    ],
  },
  {
    id: "java-spring",
    name: "Java + Spring Boot",
    description: "Enterprise Java development with Spring Boot",
    rules: [
      // Java Standards
      "Use Java 17+ LTS with modern language features (records, sealed classes, pattern matching)",
      "Follow Google Java Style Guide or your organization's established style",
      "Use Lombok judiciously — prefer records for DTOs, avoid @Data on entities",
      "Prefer immutability: final fields, unmodifiable collections, records",
      // Spring Boot Best Practices
      "Use constructor injection — never field injection with @Autowired",
      "Define beans with @Configuration classes, not component scanning for infrastructure",
      "Use Spring profiles for environment-specific configuration (dev, staging, prod)",
      "Externalize ALL configuration using application.yml and environment variables",
      // Validation
      "Use Bean Validation (jakarta.validation) annotations on DTOs",
      "Create custom validators for complex business rules",
      "Validate at controller layer with @Valid and handle ConstraintViolationException",
      "Return consistent error responses using @ControllerAdvice",
      // Data Access
      "Use Spring Data JPA with proper entity design — avoid lazy loading pitfalls",
      "Use @Transactional at service layer, not repository layer",
      "Implement pagination for all list queries using Pageable",
      "Use Flyway or Liquibase for database migrations — never hibernate.ddl-auto in production",
      // Security
      "Use Spring Security for authentication and authorization",
      "Implement method-level security with @PreAuthorize where needed",
      "Never store passwords in plain text — use BCrypt or Argon2",
      "Configure CORS properly — don't use allowAll in production",
      // Testing
      "Write unit tests with JUnit 5 and Mockito",
      "Use @WebMvcTest for controller tests, @DataJpaTest for repository tests",
      "Use Testcontainers for integration tests with real databases",
      "Test security configurations — verify endpoints require proper auth",
      // Observability
      "Use Spring Boot Actuator for health checks and metrics",
      "Integrate with Micrometer for metrics export (Prometheus, CloudWatch, etc.)",
      "Implement distributed tracing with Spring Cloud Sleuth or Micrometer Tracing",
      "Use structured logging with logback and JSON format for production",
    ],
  },
  {
    id: "python-fastapi",
    name: "Python + FastAPI",
    description: "Modern Python API development with FastAPI",
    rules: [
      // Python Standards
      "Use Python 3.11+ with type hints on all functions and classes",
      "Use Pydantic v2 models for ALL request/response validation",
      "Follow PEP 8 style guide — enforce with ruff or black",
      "Use async/await for I/O operations — FastAPI is async-first",
      // Pydantic Validation
      "Define Pydantic models for all API inputs and outputs",
      "Use Field() for additional validation: min/max length, regex patterns, examples",
      "Create custom validators with @field_validator for complex business rules",
      "Use model_config for JSON serialization settings",
      // Project Structure
      "Organize code: routers/, models/, schemas/, services/, repositories/",
      "Use dependency injection with Depends() for shared logic",
      "Create reusable dependencies for auth, database sessions, pagination",
      "Use APIRouter to organize endpoints by domain",
      // Database
      "Use SQLAlchemy 2.0 with async session for database access",
      "Use Alembic for database migrations",
      "Implement repository pattern for data access abstraction",
      "Use connection pooling and handle session lifecycle properly",
      // Error Handling
      "Define custom exception classes for domain errors",
      "Use exception handlers to return consistent error responses",
      "Never expose internal errors — log details, return safe messages",
      "Return appropriate HTTP status codes with structured error bodies",
      // Testing
      "Write tests with pytest and pytest-asyncio",
      "Use TestClient for API integration tests",
      "Use factories (factory_boy) for test data generation",
      "Mock external services, test against real database with Testcontainers",
      // Documentation
      "FastAPI auto-generates OpenAPI — ensure schemas are complete",
      "Add descriptions, examples, and tags to all endpoints",
      "Document all response models including error responses",
    ],
  },
  {
    id: "nextjs-fullstack",
    name: "Next.js Full-Stack",
    description: "Full-stack development with Next.js App Router",
    rules: [
      // App Router Standards
      "Use the App Router (app/ directory) — not the legacy Pages Router",
      "Understand and use Server Components by default — add 'use client' only when needed",
      "Use Server Actions for form submissions and mutations",
      "Implement proper loading.tsx and error.tsx for each route segment",
      // Data Fetching
      "Fetch data in Server Components — not in client components with useEffect",
      "Use React Query/TanStack Query for client-side data that needs caching/revalidation",
      "Implement proper caching strategies with fetch options and revalidate",
      "Use generateStaticParams for static generation of dynamic routes",
      // Validation
      "Use Zod for all form validation — both client and server",
      "Validate Server Action inputs with Zod schemas",
      "Use react-hook-form with @hookform/resolvers/zod for forms",
      "Return typed, validated responses from Server Actions",
      // TypeScript
      "Enable strict mode in tsconfig.json",
      "Type all props, server action inputs/outputs, and API responses",
      "Use Zod inference for type-safe forms: z.infer<typeof schema>",
      "Create shared types for data used across client and server",
      // Performance
      "Use next/image for all images — automatic optimization",
      "Implement proper Suspense boundaries for streaming",
      "Use dynamic imports for code splitting heavy client components",
      "Configure proper caching headers for static assets",
      // Authentication
      "Use NextAuth.js (Auth.js) for authentication",
      "Protect routes with middleware.ts for auth checks",
      "Use server-side session validation in Server Components",
      // Testing
      "Test Server Components with async component testing",
      "Test Server Actions by calling them directly in tests",
      "Use Playwright for E2E testing of full user flows",
    ],
  },
  {
    id: "node-backend",
    name: "Node.js Backend",
    description: "Node.js backend services with Express or Fastify",
    rules: [
      // Runtime Standards
      "Use Node.js 20 LTS or later with ES modules (type: module in package.json)",
      "Use TypeScript with strict mode for all new projects",
      "Prefer Fastify over Express for new projects — better performance and TypeScript support",
      "Use pnpm for package management — faster and more disk efficient",
      // Validation
      "Use Zod for runtime validation of all external inputs",
      "Validate request body, query params, path params, and headers",
      "Create reusable validation schemas in a dedicated schemas/ directory",
      "Return 400 Bad Request with validation error details for invalid inputs",
      // Architecture
      "Separate concerns: routes → controllers → services → repositories",
      "Use dependency injection (tsyringe, awilix) for testability",
      "Keep business logic in services — controllers should be thin",
      "Use environment variables for all configuration — never hardcode",
      // Error Handling
      "Create custom error classes with HTTP status codes",
      "Use centralized error handling middleware",
      "Log errors with context (request ID, user ID, operation)",
      "Never expose stack traces or internal details in production",
      // Database
      "Use Prisma or Drizzle ORM with TypeScript for type-safe database access",
      "Implement database migrations — never modify schema manually",
      "Use connection pooling for production deployments",
      "Implement proper transaction handling for multi-step operations",
      // Testing
      "Write unit tests with Vitest (faster than Jest)",
      "Use supertest for API integration tests",
      "Use Testcontainers for database integration tests",
      "Mock external HTTP calls with MSW or nock",
      // Observability
      "Use pino for structured JSON logging",
      "Implement health check endpoints (/health, /ready)",
      "Add request ID to all logs for tracing",
      "Export metrics in Prometheus format for monitoring",
    ],
  },
  {
    id: "go-backend",
    name: "Go Backend",
    description: "Backend services written in Go",
    rules: [
      // Go Standards
      "Use Go 1.21+ with generics where they improve code clarity",
      "Follow Effective Go and Go Code Review Comments guidelines",
      "Use go fmt, go vet, and golangci-lint on all code",
      "Organize code with standard Go project layout: cmd/, internal/, pkg/",
      // HTTP APIs
      "Use standard library net/http or chi router — avoid heavy frameworks",
      "Implement proper middleware chain: logging → recovery → auth → handler",
      "Use context.Context for request-scoped values and cancellation",
      "Return consistent JSON error responses with proper status codes",
      // Validation
      "Use go-playground/validator for struct validation",
      "Validate all inputs at API boundaries",
      "Create custom validators for domain-specific rules",
      "Return structured validation errors to clients",
      // Error Handling
      "Return errors, don't panic — panic only for truly unrecoverable situations",
      "Wrap errors with context using fmt.Errorf with %w verb",
      "Define sentinel errors for expected error conditions",
      "Use errors.Is and errors.As for error checking",
      // Concurrency
      "Use goroutines and channels appropriately — don't overcomplicate",
      "Always handle goroutine lifecycle — use sync.WaitGroup or errgroup",
      "Use context for cancellation in long-running operations",
      "Avoid shared mutable state — prefer message passing",
      // Database
      "Use sqlx or pgx for database access — not raw database/sql",
      "Use prepared statements to prevent SQL injection",
      "Implement proper connection pool configuration",
      "Use golang-migrate for database migrations",
      // Testing
      "Write table-driven tests for comprehensive coverage",
      "Use testify for assertions and mocking",
      "Use httptest for HTTP handler testing",
      "Use Testcontainers-go for integration tests with real databases",
    ],
  },
  {
    id: "database-design",
    name: "Database Design",
    description: "Relational database design and SQL best practices",
    rules: [
      // Schema Design
      "Use meaningful, consistent naming: snake_case for columns, plural for tables",
      "Every table must have a primary key — prefer UUID or BIGINT over INT",
      "Add created_at and updated_at timestamps to all tables",
      "Use appropriate data types — don't store numbers as strings",
      // Normalization & Performance
      "Normalize to 3NF by default — denormalize intentionally with documentation",
      "Create indexes for all foreign keys and frequently queried columns",
      "Use composite indexes for multi-column WHERE clauses (consider column order)",
      "Add UNIQUE constraints for business-level uniqueness requirements",
      // Referential Integrity
      "Always define foreign key constraints with appropriate ON DELETE behavior",
      "Use ON DELETE CASCADE only when child records should be deleted with parent",
      "Prefer ON DELETE RESTRICT or SET NULL for important references",
      "Document the relationship cardinality (1:1, 1:N, M:N)",
      // Migrations
      "Use migration tools (Flyway, Liquibase, Alembic, Prisma) — never manual DDL",
      "Make migrations idempotent and reversible where possible",
      "Test migrations on production-like data before deploying",
      "Never modify data in schema migrations — separate data migrations",
      // Query Practices
      "Always use parameterized queries — never string concatenation",
      "SELECT only needed columns — avoid SELECT *",
      "Use EXPLAIN ANALYZE to verify query performance",
      "Implement pagination for all list queries — never return unbounded results",
      // Safety
      "Always have a WHERE clause for UPDATE and DELETE statements",
      "Use transactions for multi-statement operations",
      "Implement soft deletes (deleted_at) for important data",
      "Regular backups with tested restore procedures",
    ],
  },
  {
    id: "testing-qa",
    name: "Testing & QA",
    description: "Comprehensive testing practices for any codebase",
    rules: [
      // Testing Philosophy
      "Write tests BEFORE or DURING implementation — not as an afterthought",
      "Test behavior, not implementation details — tests should survive refactoring",
      "Each test should test ONE thing and have a clear, descriptive name",
      "Tests are documentation — they should be readable and explain intent",
      // Test Types
      "Unit tests: fast, isolated, test single functions/classes with mocked dependencies",
      "Integration tests: test component interactions with real dependencies (database, APIs)",
      "E2E tests: test critical user journeys through the entire system",
      "Follow the testing pyramid: many unit tests, fewer integration, fewest E2E",
      // Test Quality
      "Tests must be deterministic — no flaky tests allowed in CI",
      "Tests should be independent — no shared state between tests",
      "Use factories or builders for test data — not shared fixtures",
      "Clean up test data after tests — use transactions or dedicated cleanup",
      // Coverage
      "Aim for 80%+ code coverage on business logic",
      "100% coverage doesn't mean bug-free — focus on meaningful tests",
      "Cover edge cases: null inputs, empty collections, boundary values",
      "Test error paths, not just happy paths",
      // Mocking
      "Mock external services (HTTP APIs, databases) at integration boundaries",
      "Don't mock everything — over-mocking leads to tests that don't catch bugs",
      "Use dependency injection to make code testable",
      "Prefer fakes over mocks when behavior is important",
      // CI/CD Integration
      "All tests must pass before merging to main",
      "Run fast tests (unit, lint) on every commit",
      "Run slower tests (integration, E2E) on pull requests and main",
      "Track test metrics: coverage trends, flaky test rate, test duration",
    ],
  },
];
