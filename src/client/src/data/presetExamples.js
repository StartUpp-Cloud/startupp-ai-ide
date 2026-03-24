// Code examples for preset rules
// Keyed by preset ID, then by rule index
// Only key rules that benefit from concrete examples are included

export const PRESET_EXAMPLES = {
  "react-typescript": {
    // "Never use `any` type — use `unknown` with type guards, or define proper types"
    1: {
      good: `// Using unknown with type guard
function processData(data: unknown) {
  if (typeof data === 'object' && data !== null && 'id' in data) {
    return (data as { id: string }).id;
  }
  throw new Error('Invalid data');
}`,
      bad: `// Using any - loses all type safety
function processData(data: any) {
  return data.id; // No type checking, will fail silently
}`,
    },
    // "Use Zod for runtime validation of external data"
    3: {
      good: `import { z } from 'zod';

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  age: z.number().min(0).max(150),
});

type User = z.infer<typeof UserSchema>;

// Validate API response
const user = UserSchema.parse(apiResponse);`,
      bad: `// No runtime validation - trusting external data
interface User {
  id: string;
  email: string;
  age: number;
}

// Dangerous: assumes API returns correct shape
const user = apiResponse as User;`,
    },
    // "Use React Query or TanStack Query for server state"
    9: {
      good: `import { useQuery } from '@tanstack/react-query';

function UserProfile({ userId }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => fetchUser(userId),
  });

  if (isLoading) return <Spinner />;
  if (error) return <Error message={error.message} />;
  return <Profile user={data} />;
}`,
      bad: `function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchUser(userId)
      .then(setUser)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [userId]); // Missing cleanup, no caching, no refetch

  // ... render logic
}`,
    },
    // "Handle loading, error, and empty states explicitly"
    13: {
      good: `function UserList() {
  const { data, isLoading, error } = useUsers();

  if (isLoading) return <TableSkeleton rows={5} />;
  if (error) return <ErrorCard message="Failed to load users" retry={refetch} />;
  if (data.length === 0) return <EmptyState icon={Users} message="No users yet" />;

  return <UserTable users={data} />;
}`,
      bad: `function UserList() {
  const { data } = useUsers();

  return (
    <ul>
      {data.map(user => <li key={user.id}>{user.name}</li>)}
    </ul>
  ); // Crashes if data is undefined, no feedback during loading
}`,
    },
  },

  "cloudflare-workers": {
    // "Use Zod for ALL input validation"
    4: {
      good: `import { z } from 'zod';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
});

const app = new Hono();

app.post('/users', zValidator('json', CreateUserSchema), async (c) => {
  const { email, name } = c.req.valid('json');
  // Safe to use - already validated
  return c.json({ email, name });
});`,
      bad: `app.post('/users', async (c) => {
  const body = await c.req.json();
  // No validation - trusting user input
  await db.insert(users).values({
    email: body.email, // Could be anything
    name: body.name,   // Could be SQL injection
  });
});`,
    },
    // "Use KV for: configuration, feature flags, session data"
    9: {
      good: `// KV is great for frequently read, rarely written data
export default {
  async fetch(request, env) {
    // Feature flag check - fast KV read
    const betaEnabled = await env.FLAGS.get('beta_feature');

    // Session lookup
    const sessionId = getCookie(request, 'session');
    const session = await env.SESSIONS.get(sessionId, 'json');

    // Cached config
    const config = await env.CONFIG.get('app_settings', 'json');
  }
}`,
      bad: `// Don't use KV for frequently changing data
export default {
  async fetch(request, env) {
    // Bad: KV has eventual consistency, not good for counters
    const count = parseInt(await env.COUNTERS.get('visits')) || 0;
    await env.COUNTERS.put('visits', String(count + 1));
    // Race condition! Use Durable Objects for counters
  }
}`,
    },
  },

  "rest-api": {
    // "Validate ALL request inputs using a schema validation library"
    4: {
      good: `import { z } from 'zod';

const CreateOrderSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(100),
  })).min(1),
  shippingAddress: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    zip: z.string().regex(/^\\d{5}(-\\d{4})?$/),
  }),
});

app.post('/orders', async (req, res) => {
  const result = CreateOrderSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues });
  }
  // result.data is fully typed and validated
});`,
      bad: `app.post('/orders', async (req, res) => {
  const { items, shippingAddress } = req.body;
  // No validation - vulnerable to:
  // - Missing fields causing crashes
  // - Wrong types causing bugs
  // - Malicious input causing security issues
  await createOrder(items, shippingAddress);
});`,
    },
    // "Use consistent response envelope"
    3: {
      good: `// Consistent response shape
// Success
res.json({
  success: true,
  data: { id: '123', name: 'John' },
  meta: { requestId: 'abc-123' }
});

// Error
res.status(400).json({
  success: false,
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Email is required',
    details: [{ field: 'email', issue: 'required' }]
  }
});`,
      bad: `// Inconsistent responses - hard for clients to handle
res.json({ user: { id: '123' } });           // Different shape
res.json({ data: [{ id: '123' }] });         // Array vs object
res.status(400).json({ msg: 'Bad request' }); // Different error format
res.status(500).send('Server error');         // Plain text`,
    },
  },

  "java-spring": {
    // "Use constructor injection — never field injection"
    4: {
      good: `@Service
public class OrderService {
    private final OrderRepository orderRepository;
    private final PaymentService paymentService;
    private final NotificationService notificationService;

    // Constructor injection - dependencies are explicit and immutable
    public OrderService(
            OrderRepository orderRepository,
            PaymentService paymentService,
            NotificationService notificationService) {
        this.orderRepository = orderRepository;
        this.paymentService = paymentService;
        this.notificationService = notificationService;
    }
}`,
      bad: `@Service
public class OrderService {
    @Autowired
    private OrderRepository orderRepository;  // Hidden dependency

    @Autowired
    private PaymentService paymentService;    // Can't be final

    @Autowired
    private NotificationService notificationService; // Hard to test

    // No constructor - dependencies are invisible
}`,
    },
    // "Use Flyway or Liquibase for database migrations"
    15: {
      good: `-- V1__create_users_table.sql (Flyway migration)
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);

-- V2__add_user_roles.sql
ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'USER';`,
      bad: `# application.properties - NEVER do this in production
spring.jpa.hibernate.ddl-auto=update

# Problems:
# - No version control of schema changes
# - Can't rollback
# - Different schemas in different environments
# - Data loss risk with certain changes`,
    },
  },

  "python-fastapi": {
    // "Use Pydantic v2 models for ALL request/response validation"
    1: {
      good: `from pydantic import BaseModel, Field, EmailStr
from datetime import datetime

class CreateUserRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    age: int = Field(ge=0, le=150)

class UserResponse(BaseModel):
    id: str
    email: EmailStr
    name: str
    created_at: datetime

@app.post("/users", response_model=UserResponse)
async def create_user(user: CreateUserRequest):
    # user is already validated
    return await user_service.create(user)`,
      bad: `@app.post("/users")
async def create_user(request: Request):
    data = await request.json()  # No validation
    # data could be anything - missing fields, wrong types
    return await user_service.create(
        email=data["email"],  # KeyError if missing
        name=data["name"],    # No length validation
    )`,
    },
    // "Use dependency injection with Depends()"
    6: {
      good: `from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    return await verify_token(token, db)

@app.get("/profile")
async def get_profile(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    return await get_user_profile(user.id, db)`,
      bad: `# Global database connection - not async safe
db = create_connection()

@app.get("/profile")
async def get_profile(request: Request):
    token = request.headers.get("Authorization")
    user = verify_token(token, db)  # Using global db
    return get_user_profile(user.id, db)
    # No cleanup, no request isolation`,
    },
  },

  "security": {
    // "Use parameterized queries or prepared statements"
    5: {
      good: `// Node.js with parameterized query
const user = await db.query(
  'SELECT * FROM users WHERE email = $1 AND status = $2',
  [email, 'active']
);

// Python with SQLAlchemy
user = session.execute(
    select(User).where(User.email == email)
).scalar_one()

// Java with JPA
@Query("SELECT u FROM User u WHERE u.email = :email")
User findByEmail(@Param("email") String email);`,
      bad: `// SQL INJECTION VULNERABILITY!
const user = await db.query(
  \`SELECT * FROM users WHERE email = '\${email}'\`
);
// If email = "'; DROP TABLE users; --"
// Query becomes: SELECT * FROM users WHERE email = ''; DROP TABLE users; --'

// Also bad - string concatenation
const query = "SELECT * FROM users WHERE email = '" + email + "'";`,
    },
    // "Never log sensitive data"
    10: {
      good: `// Log useful context without sensitive data
logger.info('User login attempt', {
  userId: user.id,
  email: maskEmail(user.email), // j***@example.com
  ip: request.ip,
  userAgent: request.headers['user-agent'],
  timestamp: new Date().toISOString(),
});

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return local[0] + '***@' + domain;
}`,
      bad: `// NEVER log sensitive data
logger.info('Login attempt', {
  email: user.email,
  password: password,        // NEVER log passwords
  creditCard: user.cardNumber, // NEVER log payment info
  ssn: user.ssn,             // NEVER log PII
  token: authToken,          // NEVER log tokens
});`,
    },
  },

  "testing-qa": {
    // "Test behavior, not implementation details"
    1: {
      good: `// Testing behavior - what the user sees
test('shows error message when login fails', async () => {
  render(<LoginForm />);

  await userEvent.type(screen.getByLabelText('Email'), 'bad@email.com');
  await userEvent.type(screen.getByLabelText('Password'), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: 'Login' }));

  expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
});`,
      bad: `// Testing implementation - brittle, breaks on refactor
test('sets error state when login fails', () => {
  const { result } = renderHook(() => useLogin());

  act(() => {
    result.current.setEmail('bad@email.com');
    result.current.setPassword('wrong');
  });

  await act(() => result.current.handleSubmit());

  expect(result.current.errorState).toBe('INVALID_CREDENTIALS');
  // Breaks if you rename errorState or change internal structure
});`,
    },
    // "Use factories or builders for test data"
    10: {
      good: `// Factory for creating test users
const createTestUser = (overrides = {}) => ({
  id: faker.string.uuid(),
  email: faker.internet.email(),
  name: faker.person.fullName(),
  role: 'user',
  createdAt: new Date(),
  ...overrides,
});

test('admin can delete users', async () => {
  const admin = createTestUser({ role: 'admin' });
  const userToDelete = createTestUser();

  await deleteUser(admin, userToDelete.id);

  expect(await findUser(userToDelete.id)).toBeNull();
});`,
      bad: `// Shared fixtures - tests affect each other
const testUser = {
  id: '123',
  email: 'test@test.com',
  name: 'Test User',
};

test('test 1', () => {
  testUser.role = 'admin';  // Mutates shared fixture
  // ...
});

test('test 2', () => {
  // Fails because test 1 changed testUser.role
  expect(testUser.role).toBe('user');
});`,
    },
  },

  "database-design": {
    // "Always use parameterized queries — never string concatenation"
    16: {
      good: `-- Safe: Using parameters
PREPARE get_user AS
SELECT * FROM users WHERE email = $1;
EXECUTE get_user('user@example.com');

-- Node.js
await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

-- Python
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))`,
      bad: `-- DANGER: SQL Injection
SELECT * FROM users WHERE email = '\${userInput}';
-- If userInput = "'; DROP TABLE users; --"
-- Executes: SELECT * FROM users WHERE email = ''; DROP TABLE users; --'

-- Also bad in code
query = f"SELECT * FROM users WHERE id = {user_id}"  # Python
query = "SELECT * FROM users WHERE id = " + userId;   // JS`,
    },
    // "Implement pagination for all list queries"
    19: {
      good: `-- Cursor-based pagination (best for large datasets)
SELECT * FROM orders
WHERE created_at < $1  -- cursor from last item
ORDER BY created_at DESC
LIMIT 20;

-- Offset pagination (simpler but slower for deep pages)
SELECT * FROM products
ORDER BY id
LIMIT $1 OFFSET $2;  -- LIMIT 20 OFFSET 40 for page 3

-- Always return pagination metadata
{
  "data": [...],
  "meta": {
    "total": 1000,
    "page": 3,
    "limit": 20,
    "hasMore": true
  }
}`,
      bad: `-- Returns ALL rows - crashes with large data
SELECT * FROM orders;

-- No limit - unbounded result set
SELECT * FROM logs WHERE user_id = $1;
-- Could return millions of rows, killing your server`,
    },
  },
};

/**
 * Get examples for a specific rule in a preset
 * @param {string} presetId - The preset ID
 * @param {number} ruleIndex - The index of the rule
 * @returns {{ good?: string, bad?: string } | null}
 */
export const getPresetExample = (presetId, ruleIndex) => {
  return PRESET_EXAMPLES[presetId]?.[ruleIndex] || null;
};

/**
 * Check if a preset has any examples
 * @param {string} presetId - The preset ID
 * @returns {boolean}
 */
export const presetHasExamples = (presetId) => {
  return Object.keys(PRESET_EXAMPLES[presetId] || {}).length > 0;
};

/**
 * Get count of examples in a preset
 * @param {string} presetId - The preset ID
 * @returns {number}
 */
export const getPresetExampleCount = (presetId) => {
  return Object.keys(PRESET_EXAMPLES[presetId] || {}).length;
};
