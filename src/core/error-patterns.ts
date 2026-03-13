/**
 * Error Patterns Database
 *
 * Curated map of common errors per framework with solutions.
 * Used by the diagnose_error tool.
 */

export interface ErrorPattern {
  /** Error message pattern (regex-compatible string) */
  pattern: string;
  /** Framework(s) this error is associated with */
  frameworks: string[];
  /** Human-readable error name */
  title: string;
  /** Likely cause explanation */
  cause: string;
  /** Solution steps */
  solutions: string[];
  /** Related documentation URLs or topics */
  relatedDocs?: string[];
}

/**
 * Curated error patterns for common framework errors
 */
const ERROR_PATTERNS: ErrorPattern[] = [
  // React
  {
    pattern: 'Cannot update a component.*while rendering a different component',
    frameworks: ['react'],
    title: 'State update during render',
    cause: 'A component is calling setState during the render phase of another component, which causes an infinite loop.',
    solutions: [
      'Move the state update into a useEffect hook',
      'Use useCallback to memoize the function causing the update',
      'Check if you\'re calling a setter directly in the component body instead of in an event handler or effect',
    ],
    relatedDocs: ['react/useEffect', 'react/useState'],
  },
  {
    pattern: 'Hydration failed because.*server rendered HTML.*client',
    frameworks: ['react', 'next'],
    title: 'Hydration mismatch',
    cause: 'The server-rendered HTML doesn\'t match what the client expects. Common causes: using Date.now(), Math.random(), or browser-only APIs during SSR.',
    solutions: [
      'Wrap browser-only code in useEffect or check typeof window !== "undefined"',
      'Use suppressHydrationWarning for intentional mismatches (e.g., timestamps)',
      'Ensure consistent data between server and client renders',
      'Use next/dynamic with ssr: false for client-only components',
    ],
    relatedDocs: ['next/dynamic', 'react/hydrateRoot'],
  },
  {
    pattern: 'Too many re-renders.*React limits the number',
    frameworks: ['react'],
    title: 'Infinite re-render loop',
    cause: 'A component is triggering setState on every render, causing an infinite loop.',
    solutions: [
      'Check for setState calls in the component body (move to useEffect or event handler)',
      'Ensure onClick handlers use arrow functions: onClick={() => fn()} not onClick={fn()}',
      'Add proper dependency arrays to useEffect/useMemo/useCallback',
    ],
  },
  {
    pattern: 'Invalid hook call.*Hooks can only be called inside.*function component',
    frameworks: ['react'],
    title: 'Invalid hook call',
    cause: 'Hooks are being called outside a React function component, inside a class component, or in a conditional/loop.',
    solutions: [
      'Ensure hooks are called at the top level of a function component',
      'Check for multiple React versions: npm ls react',
      'Don\'t call hooks inside conditions, loops, or nested functions',
      'Verify the component is a function, not a class',
    ],
  },
  {
    pattern: 'each child in a list should have a unique.*key.*prop',
    frameworks: ['react'],
    title: 'Missing key prop',
    cause: 'When rendering lists with .map(), each element needs a unique key prop for React\'s reconciliation.',
    solutions: [
      'Add a unique key prop to each element: items.map(item => <div key={item.id}>)',
      'Use a stable unique identifier (id, slug) — avoid using array index as key',
    ],
  },

  // Next.js
  {
    pattern: 'You\'re importing a component that needs.*useState.*from.*server component',
    frameworks: ['next'],
    title: 'Client hook in Server Component',
    cause: 'Using React hooks (useState, useEffect, etc.) in a Server Component. Server Components cannot use client-side hooks.',
    solutions: [
      'Add "use client" directive at the top of the file',
      'Move the interactive logic to a separate Client Component',
      'Use server-side alternatives (e.g., searchParams instead of useSearchParams in page.tsx)',
    ],
    relatedDocs: ['next/server-components', 'next/client-components'],
  },
  {
    pattern: 'NEXT_NOT_FOUND|notFound\\(\\)',
    frameworks: ['next'],
    title: 'Next.js notFound()',
    cause: 'The notFound() function was called, triggering the not-found boundary.',
    solutions: [
      'Create a not-found.tsx file in your app directory to customize the 404 page',
      'Check the data fetching logic that calls notFound()',
    ],
  },
  {
    pattern: 'Error: Invariant: headers\\(\\) expects to have requestAsyncStorage',
    frameworks: ['next'],
    title: 'Dynamic API in static context',
    cause: 'Using headers(), cookies(), or other dynamic functions outside of a request context.',
    solutions: [
      'Add export const dynamic = "force-dynamic" to the route',
      'Move the dynamic call inside the request handler, not at module level',
    ],
  },

  // Prisma
  {
    pattern: 'PrismaClientInitializationError|Can\'t reach database server',
    frameworks: ['prisma'],
    title: 'Prisma connection error',
    cause: 'Cannot connect to the database. Common in development when the database isn\'t running, or in production with connection pool exhaustion.',
    solutions: [
      'Verify DATABASE_URL in .env is correct',
      'Ensure the database server is running',
      'For serverless: use Prisma Accelerate or PgBouncer for connection pooling',
      'In development: use a singleton pattern for PrismaClient to avoid creating too many connections',
    ],
    relatedDocs: ['prisma/connection-management'],
  },
  {
    pattern: 'PrismaClientKnownRequestError.*Unique constraint.*failed',
    frameworks: ['prisma'],
    title: 'Unique constraint violation',
    cause: 'Attempting to create/update a record with a value that already exists in a unique field.',
    solutions: [
      'Use upsert() instead of create() to handle existing records',
      'Add proper error handling: catch (e) { if (e.code === "P2002") ... }',
      'Check if the record already exists before creating',
    ],
  },
  {
    pattern: 'prisma generate|Your Prisma schema .* was updated',
    frameworks: ['prisma'],
    title: 'Prisma client out of sync',
    cause: 'The generated Prisma Client is out of sync with the schema.',
    solutions: [
      'Run: npx prisma generate',
      'After schema changes, always run generate before using the client',
      'Add "prisma generate" to your postinstall script',
    ],
  },

  // Zod
  {
    pattern: 'ZodError|Expected.*received',
    frameworks: ['zod'],
    title: 'Zod validation error',
    cause: 'Input data doesn\'t match the Zod schema definition.',
    solutions: [
      'Use .safeParse() instead of .parse() to get error details without throwing',
      'Check the error.issues array for specific field failures',
      'Use z.coerce.string()/z.coerce.number() for type coercion',
      'Add .optional() or .default() for optional fields',
    ],
  },

  // TanStack Query
  {
    pattern: 'No QueryClient set|QueryClient.*must be.*provided',
    frameworks: ['tanstack-query'],
    title: 'Missing QueryClient provider',
    cause: 'The QueryClientProvider is not wrapping the component tree.',
    solutions: [
      'Wrap your app with <QueryClientProvider client={queryClient}>',
      'Ensure QueryClient is created outside the component to avoid recreation on re-render',
    ],
  },

  // Express
  {
    pattern: 'Cannot set headers after they are sent',
    frameworks: ['express', 'node'],
    title: 'Headers already sent',
    cause: 'Attempting to send a response after the response has already been sent (e.g., calling res.send() twice).',
    solutions: [
      'Add return after res.send()/res.json()/res.redirect()',
      'Check middleware for multiple next() calls',
      'Ensure error handlers don\'t send responses if the response is already sent',
    ],
  },
  {
    pattern: 'EADDRINUSE.*port',
    frameworks: ['express', 'node', 'next', 'fastify'],
    title: 'Port already in use',
    cause: 'Another process is already listening on the specified port.',
    solutions: [
      'Kill the existing process: lsof -i :PORT then kill -9 PID',
      'Use a different port: PORT=3001 npm run dev',
      'Check for zombie Node.js processes',
    ],
  },

  // TypeScript
  {
    pattern: 'Cannot find module.*or its corresponding type declarations',
    frameworks: ['react', 'next', 'vue', 'node'],
    title: 'Missing type declarations',
    cause: 'TypeScript can\'t find types for an imported module.',
    solutions: [
      'Install types package: npm install -D @types/package-name',
      'Add a declaration file: declare module "package-name"',
      'Check tsconfig.json moduleResolution setting',
      'For local files: ensure the path and extension are correct',
    ],
  },
  {
    pattern: 'Type.*is not assignable to type',
    frameworks: ['react', 'next', 'vue', 'node'],
    title: 'Type mismatch',
    cause: 'A value of one type is being used where another type is expected.',
    solutions: [
      'Check the expected type and ensure your value matches',
      'Use type assertion (as Type) only when you\'re certain of the type',
      'Add proper generics to your function/component',
      'Use discriminated unions for complex conditional types',
    ],
  },

  // General
  {
    pattern: 'CORS.*Access-Control-Allow-Origin',
    frameworks: ['express', 'next', 'fastify', 'hono'],
    title: 'CORS error',
    cause: 'Cross-origin request blocked because the server doesn\'t include CORS headers.',
    solutions: [
      'Express: app.use(cors()) from the cors package',
      'Next.js: Add headers to next.config.js or use middleware',
      'Set Access-Control-Allow-Origin header in your API responses',
      'For development: use a proxy in your dev server config',
    ],
  },
  {
    pattern: 'ERR_MODULE_NOT_FOUND|Cannot find module',
    frameworks: ['node', 'next'],
    title: 'Module not found',
    cause: 'The imported module cannot be resolved.',
    solutions: [
      'Check the import path for typos',
      'Ensure the package is installed: npm install package-name',
      'For ESM: add .js extension to relative imports',
      'Check "type": "module" in package.json for ESM projects',
    ],
  },
  {
    pattern: 'ReferenceError.*is not defined',
    frameworks: ['react', 'next', 'vue', 'node'],
    title: 'Variable not defined',
    cause: 'Accessing a variable that hasn\'t been declared in the current scope.',
    solutions: [
      'Check for typos in the variable name',
      'Ensure the variable is imported or declared before use',
      'For browser APIs in SSR: check typeof window !== "undefined"',
      'For environment variables in Next.js: prefix with NEXT_PUBLIC_ for client-side access',
    ],
  },

  // Zustand
  {
    pattern: 'zustand.*store.*undefined|Cannot read.*of undefined.*useStore',
    frameworks: ['zustand'],
    title: 'Zustand store undefined',
    cause: 'The store is being accessed before it\'s initialized or the hook is used incorrectly.',
    solutions: [
      'Ensure the store is created with create(): const useStore = create((set) => ({...}))',
      'Use the selector pattern: const count = useStore((state) => state.count)',
      'Don\'t destructure the hook: use useStore(s => s.field) not useStore().field',
    ],
  },

  // Drizzle
  {
    pattern: 'drizzle.*migration|DrizzleError',
    frameworks: ['drizzle'],
    title: 'Drizzle migration error',
    cause: 'Database migration failed or schema is out of sync.',
    solutions: [
      'Run: npx drizzle-kit generate then npx drizzle-kit migrate',
      'Check your drizzle.config.ts for correct database credentials',
      'For conflicts: npx drizzle-kit drop then regenerate',
    ],
  },

  // Vitest
  {
    pattern: 'vitest.*Cannot find.*test|ReferenceError.*describe.*not defined',
    frameworks: ['vitest'],
    title: 'Vitest globals not available',
    cause: 'Test globals (describe, it, expect) are not configured.',
    solutions: [
      'Add globals: true to vitest.config.ts defineConfig({ test: { globals: true } })',
      'Or import explicitly: import { describe, it, expect } from "vitest"',
      'Add "types": ["vitest/globals"] to tsconfig.json',
    ],
  },
];

/**
 * Get error patterns, optionally filtered by framework
 */
export function getErrorPatterns(framework?: string): ErrorPattern[] {
  if (!framework) return ERROR_PATTERNS;
  return ERROR_PATTERNS.filter((p) =>
    p.frameworks.some((f) => f.toLowerCase() === framework.toLowerCase())
  );
}

/**
 * Find matching error patterns for an error message
 */
export function matchErrorPatterns(error: string, framework?: string): ErrorPattern[] {
  const patterns = framework ? getErrorPatterns(framework) : ERROR_PATTERNS;
  const matches: Array<{ pattern: ErrorPattern; score: number }> = [];

  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern.pattern, 'i');
      if (regex.test(error)) {
        // Higher score for more specific patterns
        const specificity = pattern.pattern.length;
        matches.push({ pattern, score: specificity });
      }
    } catch {
      // If pattern is not valid regex, do simple includes check
      if (error.toLowerCase().includes(pattern.pattern.toLowerCase())) {
        matches.push({ pattern, score: pattern.pattern.length });
      }
    }
  }

  // Also check for keyword overlap
  const errorWords = error.toLowerCase().split(/\s+/);
  for (const pattern of patterns) {
    if (matches.some((m) => m.pattern === pattern)) continue;

    const titleWords = pattern.title.toLowerCase().split(/\s+/);
    const overlap = titleWords.filter((w) => errorWords.includes(w)).length;
    if (overlap >= 2) {
      matches.push({ pattern, score: overlap * 10 });
    }
  }

  return matches
    .sort((a, b) => b.score - a.score)
    .map((m) => m.pattern);
}
