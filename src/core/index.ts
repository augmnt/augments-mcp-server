/**
 * Core modules for v4 query-focused context extraction
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
