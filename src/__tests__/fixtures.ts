/**
 * Shared test fixtures used across test files.
 */

// ─── Mock .d.ts content ───────────────────────────────────────────────────────

export const REACT_DTS = `
/**
 * Returns a stateful value, and a function to update it.
 * @param initialState - The initial state value or an initializer function
 * @returns A tuple of the current state and a setter function
 * @example
 * const [count, setCount] = useState(0);
 */
declare function useState<S>(initialState: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void];

/**
 * Accepts a function that contains imperative, possibly effectful code.
 * @param effect - The effect function; may return a cleanup function
 * @param deps - Optional dependency array
 */
declare function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void;

/**
 * Returns a memoized callback.
 * @param callback - The function to memoize
 * @param deps - Dependency array
 */
declare function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly any[]): T;

/**
 * Returns a memoized value.
 * @param factory - A function that computes and returns the memoized value
 * @param deps - Dependency array
 * @example
 * const sorted = useMemo(() => items.sort(), [items]);
 */
declare function useMemo<T>(factory: () => T, deps: readonly any[]): T;

/**
 * Returns a mutable ref object whose .current is initialized to the given value.
 * @param initialValue - The initial value for ref.current
 * @deprecated Use the single-parameter overload; passing null is discouraged
 */
declare function useRef<T>(initialValue: T): { current: T };
declare function useRef<T>(initialValue: T | null): { current: T | null };

interface SetStateAction<S> { (prevState: S): S; }
type Dispatch<A> = (value: A) => void;
`;

export const SIMPLE_PACKAGE_DTS = `
/**
 * Parses a raw JSON string into a typed object.
 * @param input - A valid JSON string
 * @returns The parsed value, or null if parsing fails
 */
declare function parseJson<T = unknown>(input: string): T | null;

/**
 * Deeply merges two objects, with source overriding target.
 * @param target - Base object
 * @param source - Object whose properties take precedence
 */
declare function deepMerge<T extends object>(target: T, source: Partial<T>): T;

/**
 * Generates a random UUID v4 string.
 * @example
 * const id = uuid(); // "f47ac10b-58cc-4372-a567-0e02b2c3d479"
 */
declare function uuid(): string;
`;

// ─── Mock npm registry responses ─────────────────────────────────────────────

export const NPM_REACT_METADATA = {
  name: 'react',
  'dist-tags': { latest: '18.2.0', next: '19.0.0-rc.1', canary: '19.0.0-canary.20' },
  versions: {
    '18.2.0': {
      name: 'react',
      version: '18.2.0',
      description: 'React is a JavaScript library for building user interfaces.',
      main: 'index.js',
      license: 'MIT',
      repository: { type: 'git', url: 'https://github.com/facebook/react.git' },
      peerDependencies: {},
      dist: { tarball: 'https://registry.npmjs.org/react/-/react-18.2.0.tgz' },
    },
    '18.0.0': {
      name: 'react',
      version: '18.0.0',
      description: 'React is a JavaScript library for building user interfaces.',
      main: 'index.js',
      license: 'MIT',
      dist: { tarball: 'https://registry.npmjs.org/react/-/react-18.0.0.tgz' },
    },
  },
  time: { '18.0.0': '2022-03-29T16:00:00.000Z', '18.2.0': '2022-06-14T20:00:00.000Z' },
};

export const NPM_NEXT_METADATA = {
  name: 'next',
  'dist-tags': { latest: '14.2.3', canary: '15.0.0-canary.5' },
  versions: {
    '14.2.3': {
      name: 'next',
      version: '14.2.3',
      description: 'The React Framework',
      license: 'MIT',
      repository: { type: 'git', url: 'https://github.com/vercel/next.js.git' },
      peerDependencies: { react: '>=18.2.0', 'react-dom': '>=18.2.0' },
      dist: { tarball: 'https://registry.npmjs.org/next/-/next-14.2.3.tgz' },
    },
    '13.5.6': {
      name: 'next',
      version: '13.5.6',
      description: 'The React Framework',
      license: 'MIT',
      dist: { tarball: 'https://registry.npmjs.org/next/-/next-13.5.6.tgz' },
    },
  },
  time: { '13.5.6': '2023-10-16T15:00:00.000Z', '14.2.3': '2024-05-07T17:00:00.000Z' },
};

export const NPM_ZOD_METADATA = {
  name: 'zod',
  'dist-tags': { latest: '3.23.8' },
  versions: {
    '3.23.8': {
      name: 'zod',
      version: '3.23.8',
      description: 'TypeScript-first schema validation with static type inference',
      license: 'MIT',
      repository: { type: 'git', url: 'https://github.com/colinhacks/zod.git' },
      dist: { tarball: 'https://registry.npmjs.org/zod/-/zod-3.23.8.tgz' },
    },
  },
  time: { '3.23.8': '2024-04-08T20:00:00.000Z' },
};

// ─── Mock README content ──────────────────────────────────────────────────────

export const MOCK_README = `# my-utils

A collection of lightweight TypeScript utilities.

## Installation

\`\`\`bash
npm install my-utils
\`\`\`

## Usage

### parseJson

Safely parse a JSON string without throwing.

\`\`\`typescript
import { parseJson } from 'my-utils';

const data = parseJson<{ name: string }>('{"name":"Alice"}');
if (data) {
  console.log(data.name); // "Alice"
}
\`\`\`

### deepMerge

Merge two objects, with the source taking precedence.

\`\`\`typescript
import { deepMerge } from 'my-utils';

const result = deepMerge({ a: 1, b: 2 }, { b: 99, c: 3 });
// { a: 1, b: 99, c: 3 }
\`\`\`

### uuid

Generate a random UUID v4.

\`\`\`typescript
import { uuid } from 'my-utils';

const id = uuid();
console.log(id); // e.g. "f47ac10b-58cc-4372-a567-0e02b2c3d479"
\`\`\`

## API

| Function | Description |
|---|---|
| \`parseJson<T>(input)\` | Parse JSON safely, returns \`null\` on error |
| \`deepMerge(target, source)\` | Deeply merge two objects |
| \`uuid()\` | Generate a UUID v4 string |
`;

// ─── Mock changelog content ───────────────────────────────────────────────────

export const MOCK_CHANGELOG = `# Changelog

All notable changes to this project will be documented in this file.

## [3.0.0] - 2024-03-01

### Breaking Changes

- \`parseJson\` now returns \`null\` instead of throwing on invalid input
- Removed deprecated \`merge\` export; use \`deepMerge\` instead
- Node.js < 18 is no longer supported

### Features

- feat: add \`uuid\` function for generating UUID v4 strings
- feat: \`deepMerge\` now handles arrays by concatenating them

### Bug Fixes

- fix: \`deepMerge\` no longer mutates the target object

## [2.1.0] - 2023-11-15

### Features

- feat: add optional \`reviver\` argument to \`parseJson\`
- feat: export TypeScript types for all public APIs

### Bug Fixes

- fix: resolve edge case where \`deepMerge\` lost prototype methods

## [2.0.0] - 2023-06-01

### Breaking Changes

- Renamed package from \`utils-lib\` to \`my-utils\`
- \`deepMerge\` now requires two arguments (removed default empty-object fallback)

### Features

- feat: full TypeScript rewrite with strict mode
`;

// ─── Mock GitHub release response ────────────────────────────────────────────

export const GITHUB_RELEASE_RESPONSE = [
  {
    tag_name: 'v3.0.0',
    name: 'v3.0.0 — Breaking Changes & UUID Support',
    body: `## Breaking Changes\n- \`parseJson\` returns \`null\` instead of throwing\n- Removed deprecated \`merge\` export\n\n## Features\n- Add \`uuid\` utility\n- Array concatenation in \`deepMerge\`\n\n## Bug Fixes\n- \`deepMerge\` no longer mutates target`,
    published_at: '2024-03-01T12:00:00Z',
    prerelease: false,
  },
  {
    tag_name: 'v2.1.0',
    name: 'v2.1.0 — Reviver support',
    body: `## Features\n- Add optional \`reviver\` argument to \`parseJson\`\n- Export TypeScript types`,
    published_at: '2023-11-15T09:00:00Z',
    prerelease: false,
  },
  {
    tag_name: 'v3.0.0-rc.1',
    name: 'v3.0.0-rc.1',
    body: `Release candidate for v3.0.0. Please test and report issues.`,
    published_at: '2024-02-20T08:00:00Z',
    prerelease: true,
  },
];
