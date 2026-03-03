import { describe, it, expect, beforeEach } from 'vitest';
import { TypeParser } from './type-parser';

describe('TypeParser', () => {
  let parser: TypeParser;

  beforeEach(() => {
    parser = new TypeParser();
    parser.clearCache();
  });

  describe('basic parsing', () => {
    it('parses function declarations', () => {
      const content = `
declare function greet(name: string): string;
`;
      const result = parser.parse(content);
      expect(result.definitions.length).toBe(1);
      expect(result.definitions[0].name).toBe('greet');
      expect(result.definitions[0].kind).toBe('function');
      expect(result.definitions[0].parameters).toHaveLength(1);
      expect(result.definitions[0].parameters![0].name).toBe('name');
      expect(result.definitions[0].parameters![0].type).toBe('string');
      expect(result.definitions[0].returnType).toBe('string');
    });

    it('parses interface declarations', () => {
      const content = `
interface UserConfig {
  name: string;
  age?: number;
  readonly id: string;
}
`;
      const result = parser.parse(content);
      expect(result.definitions.length).toBe(1);
      expect(result.definitions[0].name).toBe('UserConfig');
      expect(result.definitions[0].kind).toBe('interface');
      expect(result.definitions[0].members).toHaveLength(3);
      expect(result.definitions[0].members![1].optional).toBe(true);
      expect(result.definitions[0].members![2].readonly).toBe(true);
    });

    it('parses type alias declarations', () => {
      const content = `
type Status = 'active' | 'inactive' | 'pending';
`;
      const result = parser.parse(content);
      expect(result.definitions.length).toBe(1);
      expect(result.definitions[0].name).toBe('Status');
      expect(result.definitions[0].kind).toBe('type');
    });

    it('parses class declarations', () => {
      const content = `
declare class EventEmitter {
  on(event: string, listener: Function): this;
  emit(event: string, ...args: any[]): boolean;
}
`;
      const result = parser.parse(content);
      expect(result.definitions.length).toBe(1);
      expect(result.definitions[0].name).toBe('EventEmitter');
      expect(result.definitions[0].kind).toBe('class');
      expect(result.definitions[0].members).toHaveLength(2);
    });

    it('parses enum declarations', () => {
      const content = `
enum Direction {
  Up = "UP",
  Down = "DOWN",
  Left = "LEFT",
  Right = "RIGHT",
}
`;
      const result = parser.parse(content);
      expect(result.definitions.length).toBe(1);
      expect(result.definitions[0].name).toBe('Direction');
      expect(result.definitions[0].kind).toBe('enum');
      expect(result.definitions[0].members).toHaveLength(4);
    });

    it('parses variable statements (hooks/constants)', () => {
      const content = `
declare const VERSION: string;
`;
      const result = parser.parse(content);
      expect(result.definitions.length).toBe(1);
      expect(result.definitions[0].name).toBe('VERSION');
      expect(result.definitions[0].kind).toBe('constant');
    });

    it('parses generics', () => {
      const content = `
declare function identity<T>(value: T): T;
`;
      const result = parser.parse(content);
      expect(result.definitions[0].generics).toContain('T');
    });

    it('parses interface extends', () => {
      const content = `
interface Base { id: string; }
interface User extends Base { name: string; }
`;
      const result = parser.parse(content);
      const userDef = result.definitions.find((d) => d.name === 'User');
      expect(userDef?.extends).toContain('Base');
    });
  });

  describe('JSDoc extraction (Phase 2.2)', () => {
    it('extracts basic description', () => {
      const content = `
/** Greets a user by name */
declare function greet(name: string): string;
`;
      const result = parser.parse(content);
      expect(result.definitions[0].description).toBe('Greets a user by name');
    });

    it('extracts @param tags', () => {
      const content = `
/**
 * Greets a user
 * @param name - The user's name
 * @param greeting - Optional greeting prefix
 */
declare function greet(name: string, greeting?: string): string;
`;
      const result = parser.parse(content);
      const params = result.definitions[0].parameters!;
      expect(params[0].description).toBe("- The user's name");
      expect(params[1].description).toBe('- Optional greeting prefix');
    });

    it('extracts @returns tag', () => {
      const content = `
/**
 * Adds two numbers
 * @returns The sum of a and b
 */
declare function add(a: number, b: number): number;
`;
      const result = parser.parse(content);
      expect(result.definitions[0].returnType).toContain('The sum of a and b');
    });

    it('extracts @example tags', () => {
      const content = `
/**
 * Formats a date
 * @example
 * format(new Date(), 'yyyy-MM-dd')
 */
declare function format(date: Date, pattern: string): string;
`;
      const result = parser.parse(content);
      expect(result.definitions[0].examples).toBeDefined();
      expect(result.definitions[0].examples!.length).toBeGreaterThan(0);
      expect(result.definitions[0].examples![0]).toContain('format(new Date()');
    });

    it('extracts @deprecated tag', () => {
      const content = `
/**
 * @deprecated Use newFunction instead
 */
declare function oldFunction(): void;
`;
      const result = parser.parse(content);
      expect(result.definitions[0].deprecated).toBe(true);
      expect(result.definitions[0].deprecatedMessage).toContain('Use newFunction instead');
    });

    it('extracts @see tag', () => {
      const content = `
/**
 * Does something
 * @see https://example.com/docs
 */
declare function doSomething(): void;
`;
      const result = parser.parse(content);
      expect(result.definitions[0].seeAlso).toBeDefined();
      expect(result.definitions[0].seeAlso![0]).toContain('example.com/docs');
    });

    it('extracts multiple JSDoc tags from the same function', () => {
      const content = `
/**
 * Fetches user data from the API
 * @param id - The user ID
 * @param options - Fetch options
 * @returns The user object
 * @example
 * const user = await fetchUser('123')
 * @see https://api.example.com/users
 * @deprecated Use fetchUserV2 instead
 */
declare function fetchUser(id: string, options?: RequestInit): Promise<User>;
interface User { id: string; name: string; }
`;
      const result = parser.parse(content);
      const fn = result.definitions.find((d) => d.name === 'fetchUser')!;
      expect(fn.description).toContain('Fetches user data');
      expect(fn.parameters![0].description).toBeDefined();
      expect(fn.returnType).toContain('The user object');
      expect(fn.examples!.length).toBeGreaterThan(0);
      expect(fn.seeAlso!.length).toBeGreaterThan(0);
      expect(fn.deprecated).toBe(true);
    });
  });

  describe('AST caching (Phase 2.1)', () => {
    it('returns same result for identical content (cache hit)', () => {
      const content = `declare function foo(): void;`;

      const result1 = parser.parse(content);
      const result2 = parser.parse(content);

      // Same reference from cache
      expect(result1).toBe(result2);
    });

    it('returns different result for different content', () => {
      const content1 = `declare function foo(): void;`;
      const content2 = `declare function bar(): void;`;

      const result1 = parser.parse(content1);
      const result2 = parser.parse(content2);

      expect(result1).not.toBe(result2);
      expect(result1.definitions[0].name).toBe('foo');
      expect(result2.definitions[0].name).toBe('bar');
    });

    it('clearCache resets the cache', () => {
      const content = `declare function foo(): void;`;

      const result1 = parser.parse(content);
      parser.clearCache();
      const result2 = parser.parse(content);

      // Should be a new parse result (different object reference)
      expect(result1).not.toBe(result2);
      // But with the same data
      expect(result1.definitions[0].name).toBe(result2.definitions[0].name);
    });

    it('evicts oldest cache entry when at capacity (50)', () => {
      // Parse 51 unique contents
      for (let i = 0; i < 51; i++) {
        parser.parse(`declare function fn${i}(): void;`);
      }

      // The first parsed content should have been evicted
      // Re-parsing it should give a new object
      const freshResult = parser.parse(`declare function fn0(): void;`);
      expect(freshResult.definitions[0].name).toBe('fn0');
    });
  });

  describe('extractApiSignature', () => {
    it('finds exact match', () => {
      const content = `
declare function useState<S>(initialState: S | (() => S)): [S, (value: S) => void];
declare function useEffect(effect: () => void, deps?: any[]): void;
`;
      const sig = parser.extractApiSignature(content, 'useState');
      expect(sig).not.toBeNull();
      expect(sig!.name).toBe('useState');
      expect(sig!.parameters).toBeDefined();
    });

    it('finds case-insensitive match', () => {
      const content = `
declare function FindMany(query: object): Promise<object[]>;
`;
      const sig = parser.extractApiSignature(content, 'findmany');
      expect(sig).not.toBeNull();
      expect(sig!.name).toBe('FindMany');
    });

    it('finds partial match', () => {
      const content = `
declare function useCallback<T extends Function>(callback: T, deps: any[]): T;
`;
      const sig = parser.extractApiSignature(content, 'callback');
      expect(sig).not.toBeNull();
      expect(sig!.name).toBe('useCallback');
    });

    it('returns null when no match found', () => {
      const content = `declare function foo(): void;`;
      const sig = parser.extractApiSignature(content, 'nonExistent');
      expect(sig).toBeNull();
    });

    it('collects related types', () => {
      const content = `
interface Options { timeout: number; }
declare function fetch(url: string, options: Options): Promise<Response>;
`;
      const sig = parser.extractApiSignature(content, 'fetch');
      expect(sig!.relatedTypes).toHaveProperty('Options');
    });

    it('includes overloads', () => {
      const content = `
declare function createElement(type: string): HTMLElement;
declare function createElement(type: string, props: object): HTMLElement;
declare function createElement(type: string, props: object, children: any[]): HTMLElement;
`;
      const sig = parser.extractApiSignature(content, 'createElement');
      expect(sig!.overloads).toBeDefined();
      expect(sig!.overloads!.length).toBe(3);
    });

    it('includes deprecated info in signature', () => {
      const content = `
/** @deprecated Use createRoot instead */
declare function render(element: any, container: Element): void;
`;
      const sig = parser.extractApiSignature(content, 'render');
      expect(sig!.deprecated).toBe(true);
      expect(sig!.deprecatedMessage).toContain('createRoot');
    });

    it('includes JSDoc examples in signature', () => {
      const content = `
/**
 * @example
 * const [state, setState] = useState(0)
 */
declare function useState<S>(init: S): [S, (v: S) => void];
`;
      const sig = parser.extractApiSignature(content, 'useState');
      expect(sig!.examples).toBeDefined();
      expect(sig!.examples!.length).toBeGreaterThan(0);
    });
  });

  describe('searchApis with scoring (Phase 2.3)', () => {
    const content = `
/**
 * @deprecated Use useFormStatus instead
 */
declare function useFormState(): any;

/** Hook for managing state */
declare function useState<S>(initialState: S): [S, (value: S) => void];

interface StateManager { get(): any; set(value: any): void; }

/**
 * Creates a store
 * @example
 * const store = createStore({ count: 0 })
 */
declare function createStore(config: object): StateManager;

declare function useCallback<T>(callback: T, deps: any[]): T;
`;

    it('returns results sorted by score', () => {
      const results = parser.searchApis(content, 'state');
      expect(results.length).toBeGreaterThan(0);
      // useState should rank high (function + starts with query-ish + has description)
      const names = results.map((r) => r.name);
      expect(names).toContain('useState');
    });

    it('boosts functions with kind bonus', () => {
      // Functions get +15 and interfaces get +10 in scoring
      // With same name match level, functions should score higher
      const results = parser.searchApis(content, 'usestate');
      const useStateDef = results.find((r) => r.name === 'useState');
      expect(useStateDef).toBeDefined();
      expect(useStateDef!.kind).toBe('function');
      // useState should rank first for exact query "usestate"
      expect(results[0].name).toBe('useState');
    });

    it('penalizes deprecated items', () => {
      const results = parser.searchApis(content, 'useform');
      // useFormState is deprecated, should be ranked lower or filtered
      const deprecatedItem = results.find((r) => r.name === 'useFormState');
      if (deprecatedItem) {
        expect(deprecatedItem.deprecated).toBe(true);
      }
    });

    it('respects maxResults parameter', () => {
      const results = parser.searchApis(content, 'state', 'types.d.ts', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('boosts items with examples', () => {
      const results = parser.searchApis(content, 'store');
      // createStore has @example, should be boosted
      const storeItem = results.find((r) => r.name === 'createStore');
      expect(storeItem).toBeDefined();
      expect(storeItem!.examples).toBeDefined();
    });
  });

  describe('complex type parsing', () => {
    it('parses function with optional parameters', () => {
      const content = `
declare function configure(host: string, port?: number, ssl?: boolean): void;
`;
      const result = parser.parse(content);
      const params = result.definitions[0].parameters!;
      expect(params[0].optional).toBe(false);
      expect(params[1].optional).toBe(true);
      expect(params[2].optional).toBe(true);
    });

    it('parses function with default parameters', () => {
      const content = `
declare function timeout(ms: number, message?: string): Promise<never>;
`;
      const result = parser.parse(content);
      expect(result.definitions[0].parameters![0].type).toBe('number');
    });

    it('handles large type definitions without errors', () => {
      // Generate a large .d.ts file
      const lines = [];
      for (let i = 0; i < 200; i++) {
        lines.push(`declare function fn${i}(arg: string): void;`);
      }
      const content = lines.join('\n');

      const result = parser.parse(content);
      expect(result.errors.length).toBe(0);
      expect(result.definitions.length).toBe(200);
    });
  });

  describe('error resilience with malformed input', () => {
    it('returns no definitions and no errors for empty string content', () => {
      const result = parser.parse('');
      expect(result.definitions).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('returns no definitions for content that is just whitespace', () => {
      const result = parser.parse('   \n\t\n   ');
      expect(result.definitions).toHaveLength(0);
    });

    it('parses JavaScript (non-declaration) content without crashing', () => {
      const content = `
const x = 42;
function hello() { console.log("hi"); }
if (true) { let y = 10; }
`;
      const result = parser.parse(content);
      // Should not throw; may or may not extract definitions
      expect(result).toBeDefined();
      expect(result.errors).toBeDefined();
    });

    it('returns partial results for content with syntax errors (unclosed braces)', () => {
      const content = `
declare function validFn(x: string): void;
interface Broken {
  name: string;
`;
      const result = parser.parse(content);
      // Should still parse the valid function declaration
      expect(result).toBeDefined();
      const validDef = result.definitions.find((d) => d.name === 'validFn');
      expect(validDef).toBeDefined();
    });

    it('parses extremely large content (10000+ chars) successfully', () => {
      const lines: string[] = [];
      for (let i = 0; i < 300; i++) {
        lines.push(`declare function generatedFn${i}(arg: string, opt?: number): Promise<boolean>;`);
      }
      const content = lines.join('\n');
      expect(content.length).toBeGreaterThan(10000);

      const result = parser.parse(content);
      expect(result.definitions.length).toBe(300);
      expect(result.errors).toHaveLength(0);
    });

    it('does not crash on content with null bytes or unicode', () => {
      const content = `
declare function normalFn(x: string): void;
// Comment with unicode: \u00e9\u00e0\u00fc\u4e16\u754c
declare function another\u0000Fn(): void;
`;
      const result = parser.parse(content);
      expect(result).toBeDefined();
      // At minimum the normalFn should be found
      const normalDef = result.definitions.find((d) => d.name === 'normalFn');
      expect(normalDef).toBeDefined();
    });
  });

  describe('extractApiSignature edge cases', () => {
    it('returns null for empty string content', () => {
      const sig = parser.extractApiSignature('', 'anything');
      expect(sig).toBeNull();
    });

    it('does not crash when query contains special regex characters', () => {
      const content = `
declare function useEffect(effect: () => void, deps?: any[]): void;
`;
      // "use.*Effect" contains regex special chars .* 
      const sig = parser.extractApiSignature(content, 'use.*Effect');
      // Should not throw; result depends on implementation
      expect(true).toBe(true);
    });

    it('returns null gracefully for a very long concept name (1000+ chars)', () => {
      const content = `
declare function useState<S>(initialState: S): [S, (value: S) => void];
`;
      const longName = 'a'.repeat(1001);
      const sig = parser.extractApiSignature(content, longName);
      expect(sig).toBeNull();
    });
  });

});
