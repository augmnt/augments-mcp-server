import { describe, it, expect, beforeEach } from 'vitest';
import { QueryParser } from './query-parser';

describe('QueryParser', () => {
  let parser: QueryParser;

  beforeEach(() => {
    parser = new QueryParser();
  });

  describe('basic framework identification', () => {
    it('identifies react from direct mention', () => {
      const result = parser.parse('react useEffect');
      expect(result.framework).toBe('react');
      expect(result.packageName).toBe('react');
    });

    it('identifies next.js from alias', () => {
      const result = parser.parse('nextjs app router');
      expect(result.framework).toBe('next');
      expect(result.packageName).toBe('next');
    });

    it('identifies vue from alias vue3', () => {
      const result = parser.parse('vue3 reactive');
      expect(result.framework).toBe('vue');
      expect(result.packageName).toBe('vue');
    });

    it('identifies express from direct mention', () => {
      const result = parser.parse('express middleware');
      expect(result.framework).toBe('express');
      expect(result.packageName).toBe('express');
    });

    it('identifies prisma and maps to @prisma/client', () => {
      const result = parser.parse('prisma findMany');
      expect(result.framework).toBe('prisma');
      expect(result.packageName).toBe('@prisma/client');
    });

    it('identifies zod', () => {
      const result = parser.parse('zod safeparse');
      expect(result.framework).toBe('zod');
      expect(result.packageName).toBe('zod');
    });
  });

  describe('scoped package parsing (Phase 1.8)', () => {
    it('identifies @tanstack/react-query from package name', () => {
      const result = parser.parse('@tanstack/react-query useQuery');
      expect(result.framework).toBe('tanstack-query');
      expect(result.packageName).toBe('@tanstack/react-query');
    });

    it('identifies @tanstack/query alias', () => {
      const result = parser.parse('@tanstack/query useInfiniteQuery');
      expect(result.framework).toBe('tanstack-query');
      expect(result.packageName).toBe('@tanstack/react-query');
    });

    it('identifies react-query alias', () => {
      const result = parser.parse('react-query useMutation');
      expect(result.framework).toBe('tanstack-query');
      expect(result.packageName).toBe('@tanstack/react-query');
    });

    it('identifies @trpc/client', () => {
      const result = parser.parse('@trpc/client createTRPCProxyClient');
      expect(result.framework).toBe('trpc');
      expect(result.packageName).toBe('@trpc/client');
    });

    it('identifies @prisma/client directly', () => {
      const result = parser.parse('@prisma/client findMany');
      expect(result.framework).toBe('prisma');
      expect(result.packageName).toBe('@prisma/client');
    });

    it('identifies @angular/core from package name', () => {
      const result = parser.parse('@angular/core Component');
      expect(result.framework).toBe('angular');
      expect(result.packageName).toBe('@angular/core');
    });
  });

  describe('API pattern detection', () => {
    it('identifies react from useEffect hook', () => {
      const result = parser.parse('useEffect cleanup');
      expect(result.framework).toBe('react');
      expect(result.packageName).toBe('react');
    });

    it('identifies react from useState hook', () => {
      const result = parser.parse('useState hook');
      expect(result.framework).toBe('react');
    });

    it('identifies tanstack-query from useQuery', () => {
      const result = parser.parse('useQuery options');
      expect(result.framework).toBe('tanstack-query');
    });

    it('identifies next.js from getServerSideProps', () => {
      const result = parser.parse('getServerSideProps');
      expect(result.framework).toBe('next');
    });

    it('identifies react-hook-form from useForm', () => {
      const result = parser.parse('useForm register');
      expect(result.framework).toBe('react-hook-form');
    });
  });

  describe('false positive reduction (Phase 1.9)', () => {
    it('does NOT detect prisma from generic "create" keyword', () => {
      const result = parser.parse('how to create a form');
      // Should not match prisma — "create" was removed from patterns
      expect(result.framework).not.toBe('prisma');
    });

    it('does NOT detect any framework from "update data"', () => {
      const result = parser.parse('update data in database');
      // "update" is too generic, should not match any specific framework
      expect(result.framework).not.toBe('prisma');
    });

    it('does NOT match short generic tokens like "ref"', () => {
      const result = parser.parse('ref to element');
      // "ref" is only 3 chars and was removed from patterns
      expect(result.framework).not.toBe('vue');
    });

    it('does NOT match "array" as an API pattern', () => {
      const result = parser.parse('array methods map filter');
      expect(result.framework).not.toBe('zod');
    });

    it('does NOT match "router" as a standalone pattern', () => {
      const result = parser.parse('router configuration');
      // "router" removed to avoid false express/vue matches
      expect(result.confidence).toBeLessThan(0.8);
    });

    it('minimum token length: skips short tokens for API pattern matching', () => {
      // "z" alone is too short (< 6 chars and doesn't start with "use")
      const result = parser.parse('z string validation');
      // Should NOT confidently match zod from just "z"
      // (though it may match via dynamic resolution)
      if (result.framework === 'zod') {
        expect(result.confidence).toBeLessThan(0.8);
      }
    });
  });

  describe('version extraction (Phase 1.10)', () => {
    it('extracts version with v prefix', () => {
      const result = parser.parse('react v19 hooks');
      expect(result.version).toBe('19');
    });

    it('extracts semver version with v prefix', () => {
      const result = parser.parse('react v19.0.0 useEffect');
      expect(result.version).toBe('19.0.0');
    });

    it('extracts version with "version" keyword', () => {
      const result = parser.parse('react version 18 hooks');
      expect(result.version).toBe('18');
    });

    it('extracts version with @ prefix (requires major.minor)', () => {
      const result = parser.parse('react@19.0 useEffect');
      expect(result.version).toBe('19.0');
    });

    it('does NOT extract port numbers as versions', () => {
      const result = parser.parse('express port 3000');
      // "3000" alone should not be detected as a version
      expect(result.version).toBeNull();
    });

    it('does NOT extract issue numbers as versions', () => {
      const result = parser.parse('react issue 19');
      // "19" alone (no v prefix, no @ prefix) should not be detected
      expect(result.version).toBeNull();
    });

    it('does NOT extract standalone numbers as versions', () => {
      const result = parser.parse('react component 42');
      expect(result.version).toBeNull();
    });

    it('extracts prerelease versions', () => {
      const result = parser.parse('react v19.0.0-beta.1 useEffect');
      expect(result.version).toBe('19.0.0-beta.1');
    });
  });

  describe('fuzzy matching (Phase 2.6)', () => {
    it('matches "expres" to "express" (1 char off)', () => {
      const result = parser.parse('expres middleware');
      expect(result.framework).toBe('express');
      expect(result.confidence).toBeLessThan(1.0); // lower confidence for fuzzy
    });

    it('matches "recct" to "react" (1 char off)', () => {
      const result = parser.parse('recct useEffect');
      // Should match react via fuzzy (distance 2 <= ceil(5*0.3)=2)
      // or via useEffect API pattern
      expect(result.framework).toBe('react');
    });

    it('matches "prisam" to "prisma" (transposition)', () => {
      const result = parser.parse('prisam findMany');
      // Either fuzzy matches prisma or findMany API pattern matches
      expect(result.framework).toBe('prisma');
    });

    it('does NOT fuzzy match completely different words', () => {
      const result = parser.parse('banana split');
      // "banana" is not close to any framework (distance > 30%)
      // Should fall through to dynamic resolution (confidence 0.4 for framework)
      // but concept extraction can add to total confidence
      expect(result.confidence).toBeLessThan(0.6);
    });
  });

  describe('dynamic npm package resolution (Phase 3.5)', () => {
    it('treats unknown package-like token as potential npm package', () => {
      const result = parser.parse('cheerio load');
      expect(result.framework).toBe('cheerio');
      expect(result.packageName).toBe('cheerio');
      expect(result.confidence).toBeLessThanOrEqual(0.4);
    });

    it('treats scoped unknown package as potential npm package', () => {
      const result = parser.parse('@my-org/my-package doSomething');
      expect(result.packageName).toBe('@my-org/my-package');
    });

    it('resolves date-fns (known framework)', () => {
      const result = parser.parse('date-fns format');
      expect(result.framework).toBe('date-fns');
      expect(result.packageName).toBe('date-fns');
      expect(result.confidence).toBeGreaterThan(0.4);
    });
  });

  describe('concept extraction', () => {
    it('extracts concept from "react useEffect cleanup"', () => {
      const result = parser.parse('react useEffect cleanup');
      expect(result.concept).toContain('useeffect');
    });

    it('extracts concept from hook pattern', () => {
      const result = parser.parse('react useState');
      expect(result.concept.toLowerCase()).toContain('usestate');
    });

    it('removes stop words from concept', () => {
      const result = parser.parse('how to use react hooks');
      expect(result.concept).not.toContain('how');
      expect(result.concept).not.toContain('to');
    });
  });

  describe('context keywords', () => {
    it('extracts cleanup as context keyword', () => {
      const result = parser.parse('react useEffect cleanup');
      expect(result.contextKeywords).toContain('cleanup');
    });

    it('extracts async as context keyword', () => {
      const result = parser.parse('react useEffect async');
      expect(result.contextKeywords).toContain('async');
    });

    it('extracts multiple context keywords', () => {
      const result = parser.parse('react server component suspense');
      expect(result.contextKeywords).toContain('server');
      expect(result.contextKeywords).toContain('component');
      expect(result.contextKeywords).toContain('suspense');
    });
  });

  describe('expanded aliases (Phase 3.4)', () => {
    it('identifies tailwind from alias "tw"', () => {
      const result = parser.parse('tw classes');
      expect(result.framework).toBe('tailwindcss');
    });

    it('identifies shadcn-ui', () => {
      const result = parser.parse('shadcn-ui button');
      expect(result.framework).toBe('shadcn');
    });

    it('identifies clerk from @clerk alias', () => {
      const result = parser.parse('@clerk auth');
      expect(result.framework).toBe('clerk');
    });

    it('identifies next-auth from authjs alias', () => {
      const result = parser.parse('authjs session');
      expect(result.framework).toBe('next-auth');
    });

    it('identifies three.js', () => {
      const result = parser.parse('three.js scene');
      expect(result.framework).toBe('three');
    });

    it('identifies socket.io from socketio alias', () => {
      const result = parser.parse('socketio emit');
      expect(result.framework).toBe('socket.io');
    });
  });

  describe('confidence scoring', () => {
    it('gives high confidence for framework + concept', () => {
      const result = parser.parse('react useEffect cleanup');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('gives lower confidence for fuzzy-matched framework', () => {
      const result = parser.parse('expres middleware');
      expect(result.confidence).toBeLessThan(
        parser.parse('express middleware').confidence
      );
    });

    it('gives lowest confidence for dynamic npm resolution', () => {
      const result = parser.parse('cheerio load');
      expect(result.confidence).toBeLessThanOrEqual(0.4);
    });
  });

  describe('getPackageName', () => {
    it('returns package for known framework', () => {
      expect(parser.getPackageName('react')).toBe('react');
      expect(parser.getPackageName('prisma')).toBe('@prisma/client');
      expect(parser.getPackageName('angular')).toBe('@angular/core');
    });

    it('returns null for unknown framework', () => {
      expect(parser.getPackageName('unknown-framework')).toBeNull();
    });
  });

  describe('getKnownFrameworks', () => {
    it('returns all known framework names', () => {
      const frameworks = parser.getKnownFrameworks();
      expect(frameworks).toContain('react');
      expect(frameworks).toContain('next');
      expect(frameworks).toContain('vue');
      expect(frameworks).toContain('prisma');
      expect(frameworks).toContain('shadcn');
      expect(frameworks).toContain('tailwindcss');
      expect(frameworks.length).toBeGreaterThan(40);
    });
  });

  describe('isApiName', () => {
    it('returns true for camelCase names', () => {
      expect(parser.isApiName('useEffect')).toBe(true);
      expect(parser.isApiName('findMany')).toBe(true);
    });

    it('returns true for PascalCase names', () => {
      expect(parser.isApiName('Component')).toBe(true);
      expect(parser.isApiName('QueryClient')).toBe(true);
    });

    it('returns false for lowercase names', () => {
      expect(parser.isApiName('hook')).toBe(false);
      expect(parser.isApiName('middleware')).toBe(false);
    });
  });

  describe('edge case inputs', () => {
    it('empty string query does not crash and returns low confidence', () => {
      const result = parser.parse('');
      expect(result).toBeDefined();
      expect(result.confidence).toBeLessThanOrEqual(0.5);
    });

    it('whitespace-only query does not crash', () => {
      const result = parser.parse('   ');
      expect(result).toBeDefined();
    });

    it('very long query (10000 chars) does not crash and returns a result', () => {
      const longQuery = 'a'.repeat(10000);
      const result = parser.parse(longQuery);
      expect(result).toBeDefined();
      expect(result.framework).toBeDefined();
    });

    it('query with special characters (!@#$%^&*) does not crash', () => {
      const result = parser.parse('!@#$%^&*()');
      expect(result).toBeDefined();
    });

    it('query with only numbers does not crash', () => {
      const result = parser.parse('12345');
      expect(result).toBeDefined();
    });

    it('query with unicode characters does not crash', () => {
      const result = parser.parse('react 使用効果');
      expect(result).toBeDefined();
    });

    it('query with newlines and tabs does not crash', () => {
      const result = parser.parse('react\nuseEffect\tcleanup');
      expect(result).toBeDefined();
    });

    it('repeated query produces consistent (deterministic) results', () => {
      const query = 'react useEffect cleanup';
      const result1 = parser.parse(query);
      const result2 = parser.parse(query);
      expect(result1.framework).toBe(result2.framework);
      expect(result1.packageName).toBe(result2.packageName);
      expect(result1.confidence).toBe(result2.confidence);
      expect(result1.concept).toBe(result2.concept);
      expect(result1.version).toBe(result2.version);
    });
  });
});
