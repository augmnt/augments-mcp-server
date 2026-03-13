/**
 * Core modules for v4+ query-focused context extraction
 */

export {
  TypeFetcher,
  getTypeFetcher,
  type NpmPackageInfo,
  type NpmVersionInfo,
  type TypeDefinitionResult,
} from './type-fetcher';

export {
  TypeParser,
  getTypeParser,
  expandWithSynonyms,
  type TypeDefinition,
  type ParameterInfo,
  type MemberInfo,
  type ParseResult,
  type ApiSignature,
} from './type-parser';

export {
  QueryParser,
  getQueryParser,
  type ParsedQuery,
} from './query-parser';

export {
  VersionRegistry,
  getVersionRegistry,
  type VersionInfo,
  type PackageVersions,
  type MajorVersionGroup,
  type VersionDiff,
} from './version-registry';

export {
  ExampleExtractor,
  getExampleExtractor,
  type CodeExample,
  type DocSourceConfig,
} from './example-extractor';

export {
  DocFetcher,
  getDocFetcher,
  type DocSearchResult,
} from './doc-fetcher';

export {
  DocSearchEngine,
  getDocSearchEngine,
  type DocChunk,
  type DocSearchResult as BM25SearchResult,
} from './doc-search';

export {
  ChangelogFetcher,
  getChangelogFetcher,
} from './changelog-fetcher';

export {
  TypeDiffer,
  getTypeDiffer,
} from './type-differ';

export {
  getErrorPatterns,
  type ErrorPattern,
} from './error-patterns';
