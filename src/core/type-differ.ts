/**
 * Type Differ
 *
 * Compares two TypeDefinitionResult contents and reports added/removed/changed exports.
 * Used by get_migration_guide to show type-level breaking changes.
 */

import { getLogger } from '@/utils/logger';
import { getTypeParser, type TypeDefinition } from './type-parser';

const logger = getLogger('type-differ');

/**
 * Diff result for exported types
 */
export interface TypeDiffResult {
  /** New exports added in the target version */
  added: TypeDiffEntry[];
  /** Exports removed from the source version */
  removed: TypeDiffEntry[];
  /** Exports with changed signatures */
  changed: TypeDiffChange[];
  /** Summary counts */
  summary: {
    added: number;
    removed: number;
    changed: number;
  };
}

export interface TypeDiffEntry {
  name: string;
  kind: string;
  signature: string;
}

export interface TypeDiffChange {
  name: string;
  kind: string;
  before: string;
  after: string;
  /** Description of what changed */
  description: string;
}

export class TypeDiffer {
  /**
   * Diff two type definition contents
   */
  diff(
    fromContent: string,
    toContent: string,
    fromFileName: string = 'from.d.ts',
    toFileName: string = 'to.d.ts'
  ): TypeDiffResult {
    const typeParser = getTypeParser();

    const fromResult = typeParser.parse(fromContent, fromFileName);
    const toResult = typeParser.parse(toContent, toFileName);

    // Build maps by name
    const fromMap = new Map<string, TypeDefinition>();
    for (const def of fromResult.definitions) {
      fromMap.set(def.name, def);
    }

    const toMap = new Map<string, TypeDefinition>();
    for (const def of toResult.definitions) {
      toMap.set(def.name, def);
    }

    const added: TypeDiffEntry[] = [];
    const removed: TypeDiffEntry[] = [];
    const changed: TypeDiffChange[] = [];

    // Find added and changed
    for (const [name, toDef] of toMap) {
      const fromDef = fromMap.get(name);
      if (!fromDef) {
        added.push({
          name,
          kind: toDef.kind,
          signature: this.truncateSignature(toDef.signature),
        });
      } else {
        // Check for changes
        const normalizedFrom = this.normalizeSignature(fromDef.signature);
        const normalizedTo = this.normalizeSignature(toDef.signature);

        if (normalizedFrom !== normalizedTo) {
          changed.push({
            name,
            kind: toDef.kind,
            before: this.truncateSignature(fromDef.signature),
            after: this.truncateSignature(toDef.signature),
            description: this.describeChange(fromDef, toDef),
          });
        }
      }
    }

    // Find removed
    for (const [name, fromDef] of fromMap) {
      if (!toMap.has(name)) {
        removed.push({
          name,
          kind: fromDef.kind,
          signature: this.truncateSignature(fromDef.signature),
        });
      }
    }

    logger.debug('Type diff completed', {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
    });

    return {
      added,
      removed,
      changed,
      summary: {
        added: added.length,
        removed: removed.length,
        changed: changed.length,
      },
    };
  }

  private normalizeSignature(sig: string): string {
    return sig.replace(/\s+/g, ' ').trim();
  }

  private truncateSignature(sig: string, maxLen: number = 300): string {
    if (sig.length <= maxLen) return sig;
    return sig.substring(0, maxLen - 3) + '...';
  }

  private describeChange(from: TypeDefinition, to: TypeDefinition): string {
    const changes: string[] = [];

    if (from.kind !== to.kind) {
      changes.push(`Changed from ${from.kind} to ${to.kind}`);
    }

    if (from.deprecated !== to.deprecated) {
      if (to.deprecated) {
        changes.push(`Marked as deprecated${to.deprecatedMessage ? `: ${to.deprecatedMessage}` : ''}`);
      } else {
        changes.push('Deprecation removed');
      }
    }

    // Parameter changes for functions
    if (from.parameters && to.parameters) {
      const fromParams = from.parameters.length;
      const toParams = to.parameters.length;
      if (fromParams !== toParams) {
        changes.push(`Parameters changed from ${fromParams} to ${toParams}`);
      }
    }

    // Return type changes
    if (from.returnType && to.returnType && from.returnType !== to.returnType) {
      changes.push(`Return type changed`);
    }

    return changes.length > 0 ? changes.join('; ') : 'Signature changed';
  }
}

// Singleton
let instance: TypeDiffer | null = null;

export function getTypeDiffer(): TypeDiffer {
  if (!instance) {
    instance = new TypeDiffer();
  }
  return instance;
}
