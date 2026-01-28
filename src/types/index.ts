/**
 * Shared types for Augments MCP Server
 */

import { z } from 'zod';

// Framework configuration schemas
export const GitHubSourceSchema = z.object({
  repo: z.string(),
  docs_path: z.string().default('docs'),
  branch: z.string().default('main'),
});

export const DocumentationSourceSchema = z.object({
  github: GitHubSourceSchema.optional(),
  website: z.string().url().optional(),
});

export const FrameworkSourcesSchema = z.object({
  documentation: DocumentationSourceSchema,
  examples: DocumentationSourceSchema.optional(),
});

export const FrameworkConfigSchema = z.object({
  name: z.string(),
  display_name: z.string(),
  category: z.string(),
  type: z.string(),
  version: z.string().default('latest'),
  sources: FrameworkSourcesSchema,
  sections: z.record(z.string()).optional(),
  context_files: z.array(z.string()),
  key_features: z.array(z.string()),
  common_patterns: z.array(z.string()),
  priority: z.number().default(50),
});

// Infer types from schemas
export type GitHubSource = z.infer<typeof GitHubSourceSchema>;
export type DocumentationSource = z.infer<typeof DocumentationSourceSchema>;
export type FrameworkSources = z.infer<typeof FrameworkSourcesSchema>;
export type FrameworkConfig = z.infer<typeof FrameworkConfigSchema>;

// Framework info for listing and search
export interface FrameworkInfo {
  name: string;
  display_name: string;
  category: string;
  type: string;
  description: string;
  tags: string[];
  priority: number;
  version: string;
}

// Search result with relevance scoring
export interface SearchResult {
  framework: FrameworkInfo;
  relevance_score: number;
  matched_fields: string[];
}

// Cache entry
export interface CacheEntry {
  content: string;
  cached_at: number;
  ttl: number;
  version: string;
  framework: string;
  source_type: string;
  content_hash?: string; // SHA-256 hash for change detection when HTTP headers unavailable
}

// Update status
export interface UpdateStatus {
  framework: string;
  last_checked: string;
  last_modified: string | null;
  has_updates: boolean;
  change_summary: string[];
}

// Compatibility issue
export interface CompatibilityIssue {
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

// Compatibility analysis results
export interface CompatibilityAnalysis {
  compatible: boolean;
  frameworks: string[];
  overall_compatibility_score: number;
  framework_scores: Record<string, number>;
  issues: CompatibilityIssue[];
  suggestions: string[];
  code_analysis: CodeAnalysis;
}

// Code analysis structure
export interface CodeAnalysis {
  language: string;
  imports: string[];
  functions: string[];
  classes: string[];
  jsx_elements: string[];
  css_selectors: string[];
  patterns: string[];
}

// Cache statistics
export interface CacheStats {
  memory_entries: number;
  memory_max_entries: number;
  memory_utilization_pct: number;
  indexed_frameworks: number;
  ttl_strategies: Record<string, number>;
}

// Registry statistics
export interface RegistryStats {
  total_frameworks: number;
  categories: string[];
  category_counts: Record<string, number>;
  is_loaded: boolean;
}

// Documentation search result
export interface DocSearchResult {
  line_number: number;
  content: string;
  relevance: number;
}

// Framework category enum
export const FrameworkCategories = [
  'web',
  'backend',
  'mobile',
  'ai-ml',
  'design',
  'tools',
  'database',
  'devops',
  'testing',
  'state-management',
] as const;

export type FrameworkCategory = (typeof FrameworkCategories)[number];
