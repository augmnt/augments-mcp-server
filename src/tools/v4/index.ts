/**
 * v4+ Tools for query-focused context extraction
 */

export {
  getApiContext,
  formatApiContextResponse,
  type GetApiContextInput,
  type GetApiContextOutput,
  type QueryIntent,
} from './get-api-context';

export {
  searchApis,
  formatSearchApisResponse,
  type SearchApisInput,
  type SearchApisOutput,
  type ApiSearchResult,
} from './search-apis';

export {
  getVersionInfo,
  formatVersionInfoResponse,
  type GetVersionInfoInput,
  type GetVersionInfoOutput,
} from './get-version-info';

export {
  getMigrationGuide,
  formatMigrationGuideResponse,
  type GetMigrationGuideInput,
  type GetMigrationGuideOutput,
} from './get-migration-guide';

export {
  diagnoseError,
  formatDiagnoseErrorResponse,
  type DiagnoseErrorInput,
  type DiagnoseErrorOutput,
} from './diagnose-error';

export {
  comparePackages,
  formatComparePackagesResponse,
  type ComparePackagesInput,
  type ComparePackagesOutput,
} from './compare-packages';

export {
  scanProjectDeps,
  formatScanProjectDepsResponse,
  type ScanProjectDepsInput,
  type ScanProjectDepsOutput,
} from './scan-project-deps';
