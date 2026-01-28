/**
 * Test script for v4 query-focused context extraction
 *
 * Run with: npx tsx scripts/test-v4.ts
 */

import { getApiContext, formatApiContextResponse } from '../src/tools/v4/get-api-context';
import { searchApis, formatSearchApisResponse } from '../src/tools/v4/search-apis';
import { getVersionInfo, formatVersionInfoResponse } from '../src/tools/v4/get-version-info';

async function main() {
  console.log('='.repeat(60));
  console.log('Testing v4 Query-Focused Context Extraction');
  console.log('='.repeat(60));
  console.log();

  // Test 1: React useEffect query
  console.log('Test 1: get_api_context - "useEffect cleanup react 19"');
  console.log('-'.repeat(60));
  try {
    const result1 = await getApiContext({
      query: 'useEffect cleanup react 19',
      includeExamples: true,
      maxExamples: 1,
    });
    console.log('Framework:', result1.framework);
    console.log('Package:', result1.packageName);
    console.log('Version:', result1.version);
    console.log('API Found:', result1.api ? result1.api.name : 'None');
    console.log('Confidence:', result1.confidence);
    console.log('Related APIs:', result1.relatedApis.join(', ') || 'None');
    console.log('Examples:', result1.examples.length);
    console.log('Notes:', result1.notes.join('; ') || 'None');
    console.log();
    console.log('Formatted Response (truncated):');
    const formatted1 = formatApiContextResponse(result1);
    console.log(formatted1.substring(0, 1500) + (formatted1.length > 1500 ? '\n...(truncated)' : ''));
  } catch (error) {
    console.error('Error:', error);
  }
  console.log();

  // Test 2: Prisma findMany query
  console.log('Test 2: get_api_context - "prisma findMany"');
  console.log('-'.repeat(60));
  try {
    const result2 = await getApiContext({
      query: 'prisma findMany',
      includeExamples: false,
    });
    console.log('Framework:', result2.framework);
    console.log('Package:', result2.packageName);
    console.log('Version:', result2.version);
    console.log('API Found:', result2.api ? result2.api.name : 'None');
    console.log('Confidence:', result2.confidence);
    console.log('Notes:', result2.notes.join('; ') || 'None');
  } catch (error) {
    console.error('Error:', error);
  }
  console.log();

  // Test 3: Search APIs
  console.log('Test 3: search_apis - "state hook"');
  console.log('-'.repeat(60));
  try {
    const result3 = await searchApis({
      query: 'state hook',
      frameworks: ['react'],
      limit: 5,
    });
    console.log('Total Found:', result3.totalFound);
    console.log('Frameworks Searched:', result3.frameworksSearched.join(', '));
    console.log('Results:');
    for (const r of result3.results.slice(0, 3)) {
      console.log(`  - ${r.name} (${r.kind}) - Relevance: ${Math.round(r.relevance * 100)}%`);
    }
  } catch (error) {
    console.error('Error:', error);
  }
  console.log();

  // Test 4: Version info
  console.log('Test 4: get_version_info - "react"');
  console.log('-'.repeat(60));
  try {
    const result4 = await getVersionInfo({
      framework: 'react',
    });
    console.log('Package:', result4.packageName);
    console.log('Latest Stable:', result4.latestStable);
    console.log('Latest:', result4.latest);
    console.log('Major Versions:', result4.majorVersions.map(m => `v${m.major}`).join(', '));
    console.log('Total Versions:', result4.totalVersions);
    console.log('Tags:', Object.entries(result4.tags).map(([k, v]) => `${k}=${v}`).join(', '));
  } catch (error) {
    console.error('Error:', error);
  }
  console.log();

  // Test 5: Version diff
  console.log('Test 5: get_version_info - "react" from v18 to v19');
  console.log('-'.repeat(60));
  try {
    const result5 = await getVersionInfo({
      framework: 'react',
      fromVersion: '18.0.0',
      toVersion: '19.0.0',
    });
    if (result5.diff) {
      console.log('Diff From:', result5.diff.from);
      console.log('Diff To:', result5.diff.to);
      console.log('Major Change:', result5.diff.isMajorChange);
      console.log('Summary:', result5.diff.summary.join('; '));
    }
  } catch (error) {
    console.error('Error:', error);
  }
  console.log();

  console.log('='.repeat(60));
  console.log('Tests completed');
  console.log('='.repeat(60));
}

main().catch(console.error);
