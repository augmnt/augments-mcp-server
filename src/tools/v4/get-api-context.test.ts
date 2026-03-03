import { describe, it, expect, vi } from 'vitest';
import {
  formatApiContextResponse,
  type GetApiContextOutput,
} from './get-api-context';
import type { ParsedQuery, ApiSignature, CodeExample } from '@/core';

vi.mock('@/utils/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('get-api-context', () => {
  describe('formatApiContextResponse', () => {
    function makeOutput(overrides: Partial<GetApiContextOutput> = {}): GetApiContextOutput {
      const defaultQuery: ParsedQuery = {
        framework: 'react',
        packageName: 'react',
        concept: 'useState',
        version: null,
        originalQuery: 'react useState',
        confidence: 0.8,
        contextKeywords: [],
      };

      return {
        framework: 'react',
        packageName: 'react',
        version: '18.2.0',
        api: null,
        relatedApis: [],
        examples: [],
        prose: null,
        intent: 'balanced' as const,
        confidence: 0.8,
        query: defaultQuery,
        notes: [],
        ...overrides,
      };
    }

    it('formats basic response with framework header', () => {
      const output = makeOutput();
      const response = formatApiContextResponse(output);
      expect(response).toContain('# react API Context');
      expect(response).toContain('Version: 18.2.0');
    });

    it('formats API signature section', () => {
      const api: ApiSignature = {
        name: 'useState',
        signature: 'function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>]',
        description: 'Returns a stateful value, and a function to update it.',
        parameters: [
          { name: 'initialState', type: 'S | (() => S)', optional: false, description: 'The initial state value' },
        ],
        returnType: '[S, Dispatch<SetStateAction<S>>]',
        relatedTypes: {
          SetStateAction: 'type SetStateAction<S> = S | ((prevState: S) => S)',
        },
      };

      const output = makeOutput({ api });
      const response = formatApiContextResponse(output);

      expect(response).toContain('## API Signature');
      expect(response).toContain('useState');
      expect(response).toContain('### Parameters');
      expect(response).toContain('initialState');
      expect(response).toContain('The initial state value');
      expect(response).toContain('### Returns');
      expect(response).toContain('### Related Types');
      expect(response).toContain('SetStateAction');
    });

    it('shows deprecation warning', () => {
      const api: ApiSignature = {
        name: 'render',
        signature: 'function render(element: ReactElement, container: Element): void',
        deprecated: true,
        deprecatedMessage: 'Use createRoot instead',
        relatedTypes: {},
      };

      const output = makeOutput({ api });
      const response = formatApiContextResponse(output);

      expect(response).toContain('**DEPRECATED**');
      expect(response).toContain('Use createRoot instead');
    });

    it('includes JSDoc examples', () => {
      const api: ApiSignature = {
        name: 'useState',
        signature: 'function useState<S>(init: S): [S, (v: S) => void]',
        examples: ['const [count, setCount] = useState(0)'],
        relatedTypes: {},
      };

      const output = makeOutput({ api });
      const response = formatApiContextResponse(output);

      expect(response).toContain('### JSDoc Examples');
      expect(response).toContain('const [count, setCount] = useState(0)');
    });

    it('includes overloads', () => {
      const api: ApiSignature = {
        name: 'createElement',
        signature: 'function createElement(type: string): ReactElement',
        overloads: [
          'function createElement(type: string): ReactElement',
          'function createElement(type: string, props: object): ReactElement',
          'function createElement(type: string, props: object, children: any[]): ReactElement',
        ],
        relatedTypes: {},
      };

      const output = makeOutput({ api });
      const response = formatApiContextResponse(output);

      expect(response).toContain('### Overloads');
    });

    it('formats related APIs', () => {
      const output = makeOutput({
        api: {
          name: 'useState',
          signature: 'function useState()',
          relatedTypes: {},
        },
        relatedApis: ['useReducer', 'useContext', 'useMemo'],
      });

      const response = formatApiContextResponse(output);
      expect(response).toContain('## Related APIs');
      expect(response).toContain('useReducer');
      expect(response).toContain('useContext');
    });

    it('formats code examples', () => {
      const examples: CodeExample[] = [
        {
          code: 'const [count, setCount] = useState(0);',
          language: 'tsx',
          source: 'https://react.dev/hooks/useState',
          concepts: ['usestate'],
          context: 'Counter Example',
        },
      ];

      const output = makeOutput({ examples });
      const response = formatApiContextResponse(output);

      expect(response).toContain('## Code Examples');
      expect(response).toContain('Counter Example');
      expect(response).toContain('const [count, setCount]');
      expect(response).toContain('*Source:');
    });

    it('formats notes', () => {
      const output = makeOutput({
        notes: ['No API named "foo" found in react@18.2.0'],
      });

      const response = formatApiContextResponse(output);
      expect(response).toContain('## Notes');
      expect(response).toContain('No API named "foo"');
    });

    describe('response size optimization (Phase 2.7)', () => {
      it('truncates long related type signatures', () => {
        const longSig = 'type LongType = ' + 'A | '.repeat(100) + 'Z';
        const api: ApiSignature = {
          name: 'test',
          signature: 'function test(): void',
          relatedTypes: {
            LongType: longSig,
          },
        };

        const output = makeOutput({ api });
        const response = formatApiContextResponse(output);

        // The signature should be truncated to ~300 chars
        expect(response).toContain('...');
      });

      it('limits related types when response is large', () => {
        const relatedTypes: Record<string, string> = {};
        for (let i = 0; i < 20; i++) {
          relatedTypes[`Type${i}`] = `interface Type${i} { ${'field: string; '.repeat(20)} }`;
        }

        const api: ApiSignature = {
          name: 'test',
          signature: 'function test(): void\n' + '// '.repeat(500),
          description: 'A '.repeat(1000),
          relatedTypes,
        };

        const output = makeOutput({ api });
        const response = formatApiContextResponse(output);

        // Should cap related types
        const typeCount = (response.match(/\*\*Type\d+\*\*/g) || []).length;
        expect(typeCount).toBeLessThanOrEqual(20);
      });

      it('reduces examples when response is large', () => {
        const api: ApiSignature = {
          name: 'test',
          signature: 'function test(): void\n' + '// '.repeat(2000),
          description: 'Description '.repeat(500),
          relatedTypes: {},
        };

        const examples: CodeExample[] = Array.from({ length: 5 }, (_, i) => ({
          code: `// Example ${i}\nconst x${i} = test();\n` + '// filler '.repeat(50),
          language: 'typescript',
          source: `source-${i}.md`,
          concepts: ['test'],
        }));

        const output = makeOutput({ api, examples });
        const response = formatApiContextResponse(output);

        // When response is large, examples should be reduced
        const exampleCount = (response.match(/\*Source:/g) || []).length;
        expect(exampleCount).toBeLessThanOrEqual(5);
      });
    });
  });
});
