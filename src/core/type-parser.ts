/**
 * TypeScript Parser
 *
 * Uses TypeScript compiler API to parse .d.ts files and extract API signatures.
 * Given a concept (e.g., "useEffect"), finds its signature and resolves type references.
 *
 * Features:
 * - AST parse caching (djb2 hash-based, max 50 entries)
 * - Enhanced JSDoc extraction (@param, @returns, @example, @deprecated, @see)
 * - Smart response filtering with maxResults and scoring
 */

import ts from 'typescript';
import { getLogger } from '@/utils/logger';

const logger = getLogger('type-parser');

// Relevance scoring constants for searchApis ranking
const SCORE_EXACT_MATCH = 100;
const SCORE_STARTS_WITH = 80;
const SCORE_CONTAINS = 60;
const SCORE_KIND_FUNCTION = 15;
const SCORE_KIND_INTERFACE = 10;
const SCORE_HAS_DESCRIPTION = 10;
const SCORE_HAS_EXAMPLES = 5;
const SCORE_DEPRECATED_PENALTY = -20;

/**
 * Represents a parsed type definition
 */
export interface TypeDefinition {
  name: string;
  kind: 'function' | 'interface' | 'type' | 'class' | 'constant' | 'enum';
  signature: string;
  description?: string;
  parameters?: ParameterInfo[];
  returnType?: string;
  generics?: string[];
  members?: MemberInfo[];
  extends?: string[];
  deprecated?: boolean;
  deprecatedMessage?: string;
  seeAlso?: string[];
  examples?: string[];
  location?: {
    line: number;
    column: number;
  };
}

export interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
  description?: string;
}

export interface MemberInfo {
  name: string;
  type: string;
  optional: boolean;
  readonly: boolean;
  description?: string;
}

/**
 * Result of parsing type definitions
 */
export interface ParseResult {
  definitions: TypeDefinition[];
  relatedTypes: Map<string, TypeDefinition>;
  errors: string[];
}

/**
 * API signature extraction result
 */
export interface ApiSignature {
  name: string;
  signature: string;
  description?: string;
  parameters?: ParameterInfo[];
  returnType?: string;
  overloads?: string[];
  relatedTypes: Record<string, string>;
  examples?: string[];
  deprecated?: boolean;
  deprecatedMessage?: string;
}

/**
 * djb2 hash function for fast content hashing
 */
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0; // Convert to unsigned
}

/**
 * TypeScript parser for extracting API signatures from .d.ts content
 */
export class TypeParser {
  private printer: ts.Printer;
  private parseCache: Map<number, ParseResult> = new Map();
  private readonly MAX_PARSE_CACHE_SIZE = 50;

  constructor() {
    this.printer = ts.createPrinter({
      newLine: ts.NewLineKind.LineFeed,
      removeComments: false,
    });
  }

  /**
   * Parse TypeScript definition content and extract all type definitions.
   * Results are cached based on content hash.
   */
  parse(content: string, fileName: string = 'types.d.ts'): ParseResult {
    // Check parse cache
    const contentHash = djb2Hash(content);
    const cached = this.parseCache.get(contentHash);
    if (cached) {
      logger.debug('Parse cache hit', { fileName, hash: contentHash });
      return cached;
    }

    const definitions: TypeDefinition[] = [];
    const relatedTypes = new Map<string, TypeDefinition>();
    const errors: string[] = [];

    try {
      const sourceFile = ts.createSourceFile(
        fileName,
        content,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );

      const visit = (node: ts.Node) => {
        try {
          const def = this.parseNode(node, sourceFile);
          if (def) {
            definitions.push(def);
          }
        } catch (error) {
          errors.push(
            `Failed to parse node: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        ts.forEachChild(node, visit);
      };

      ts.forEachChild(sourceFile, visit);

      // Build related types map
      for (const def of definitions) {
        relatedTypes.set(def.name, def);
      }
    } catch (error) {
      errors.push(
        `Failed to parse source file: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const result = { definitions, relatedTypes, errors };

    // Cache the result (evict oldest if at capacity)
    if (this.parseCache.size >= this.MAX_PARSE_CACHE_SIZE) {
      const firstKey = this.parseCache.keys().next().value;
      if (firstKey !== undefined) {
        this.parseCache.delete(firstKey);
      }
    }
    this.parseCache.set(contentHash, result);

    logger.debug('Parsed type definitions', {
      fileName,
      definitionCount: definitions.length,
      errorCount: errors.length,
    });

    return result;
  }

  /**
   * Extract API signature for a specific concept/name
   */
  extractApiSignature(
    content: string,
    conceptName: string,
    fileName: string = 'types.d.ts'
  ): ApiSignature | null {
    const parseResult = this.parse(content, fileName);
    const normalizedName = conceptName.toLowerCase();

    // Find matching definitions
    const matches = parseResult.definitions.filter(
      (def) =>
        def.name.toLowerCase() === normalizedName ||
        def.name.toLowerCase().includes(normalizedName)
    );

    if (matches.length === 0) {
      logger.debug('No matching definition found', { conceptName });
      return null;
    }

    // Prefer exact match
    const exactMatch = matches.find(
      (def) => def.name.toLowerCase() === normalizedName
    );
    const primaryMatch = exactMatch || matches[0];

    // Collect overloads (multiple function signatures with same name)
    const overloads = matches
      .filter((def) => def.name === primaryMatch.name && def.kind === 'function')
      .map((def) => def.signature);

    // Collect related types from parameter and return types
    const relatedTypes = this.collectRelatedTypes(primaryMatch, parseResult);

    // Collect examples from JSDoc
    const examples = primaryMatch.examples || [];

    return {
      name: primaryMatch.name,
      signature: primaryMatch.signature,
      description: primaryMatch.description,
      parameters: primaryMatch.parameters,
      returnType: primaryMatch.returnType,
      overloads: overloads.length > 1 ? overloads : undefined,
      relatedTypes,
      examples: examples.length > 0 ? examples : undefined,
      deprecated: primaryMatch.deprecated,
      deprecatedMessage: primaryMatch.deprecatedMessage,
    };
  }

  /**
   * Search for APIs matching a query with smart response filtering
   */
  searchApis(
    content: string,
    query: string,
    fileName: string = 'types.d.ts',
    maxResults: number = 20
  ): TypeDefinition[] {
    const parseResult = this.parse(content, fileName);
    const queryLower = query.toLowerCase();
    const queryParts = queryLower.split(/\s+/);

    return parseResult.definitions
      .filter((def) => {
        const nameLower = def.name.toLowerCase();
        const signatureLower = def.signature.toLowerCase();

        // Match all query parts
        return queryParts.every(
          (part) => nameLower.includes(part) || signatureLower.includes(part)
        );
      })
      .sort((a, b) => {
        // Score-based sorting for better ranking
        const scoreA = this.scoreDefinition(a, queryLower);
        const scoreB = this.scoreDefinition(b, queryLower);
        return scoreB - scoreA;
      })
      .slice(0, maxResults);
  }

  /**
   * Score a type definition for relevance ranking
   */
  private scoreDefinition(def: TypeDefinition, queryLower: string): number {
    let score = 0;
    const nameLower = def.name.toLowerCase();

    // Exact name match
    if (nameLower === queryLower) score += SCORE_EXACT_MATCH;
    // Starts with query
    else if (nameLower.startsWith(queryLower)) score += SCORE_STARTS_WITH;
    // Contains query
    else if (nameLower.includes(queryLower)) score += SCORE_CONTAINS;

    // Boost exported declarations (functions and interfaces are usually more useful)
    if (def.kind === 'function') score += SCORE_KIND_FUNCTION;
    if (def.kind === 'interface') score += SCORE_KIND_INTERFACE;

    // Boost items with JSDoc descriptions
    if (def.description) score += SCORE_HAS_DESCRIPTION;

    // Boost items with examples
    if (def.examples && def.examples.length > 0) score += SCORE_HAS_EXAMPLES;

    // Penalize deprecated items
    if (def.deprecated) score += SCORE_DEPRECATED_PENALTY;

    return score;
  }

  /**
   * Parse a TypeScript node into a TypeDefinition
   */
  private parseNode(node: ts.Node, sourceFile: ts.SourceFile): TypeDefinition | null {
    // Function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      return this.parseFunctionDeclaration(node, sourceFile);
    }

    // Interface declarations
    if (ts.isInterfaceDeclaration(node)) {
      return this.parseInterfaceDeclaration(node, sourceFile);
    }

    // Type alias declarations
    if (ts.isTypeAliasDeclaration(node)) {
      return this.parseTypeAliasDeclaration(node, sourceFile);
    }

    // Class declarations
    if (ts.isClassDeclaration(node) && node.name) {
      return this.parseClassDeclaration(node, sourceFile);
    }

    // Variable declarations (for exported constants/hooks)
    if (ts.isVariableStatement(node)) {
      return this.parseVariableStatement(node, sourceFile);
    }

    // Enum declarations
    if (ts.isEnumDeclaration(node)) {
      return this.parseEnumDeclaration(node, sourceFile);
    }

    return null;
  }

  /**
   * Parse function declaration
   */
  private parseFunctionDeclaration(
    node: ts.FunctionDeclaration,
    sourceFile: ts.SourceFile
  ): TypeDefinition | null {
    if (!node.name) return null;

    const name = node.name.text;
    const signature = this.getNodeText(node, sourceFile);
    const jsDoc = this.getEnhancedJsDoc(node, sourceFile);
    const parameters = this.parseParameters(node.parameters, sourceFile);
    const returnType = node.type ? this.getNodeText(node.type, sourceFile) : 'void';
    const generics = this.parseTypeParameters(node.typeParameters, sourceFile);

    // Wire JSDoc @param descriptions into ParameterInfo
    if (jsDoc.params) {
      for (const param of parameters) {
        const docParam = jsDoc.params[param.name];
        if (docParam) {
          param.description = docParam;
        }
      }
    }

    return {
      name,
      kind: 'function',
      signature: this.cleanSignature(signature),
      description: jsDoc.description,
      parameters,
      returnType: jsDoc.returns ? `${returnType} — ${jsDoc.returns}` : returnType,
      generics: generics.length > 0 ? generics : undefined,
      deprecated: jsDoc.deprecated !== undefined,
      deprecatedMessage: jsDoc.deprecated || undefined,
      seeAlso: jsDoc.see?.length ? jsDoc.see : undefined,
      examples: jsDoc.examples?.length ? jsDoc.examples : undefined,
      location: this.getLocation(node, sourceFile),
    };
  }

  /**
   * Parse interface declaration
   */
  private parseInterfaceDeclaration(
    node: ts.InterfaceDeclaration,
    sourceFile: ts.SourceFile
  ): TypeDefinition {
    const name = node.name.text;
    const signature = this.getNodeText(node, sourceFile);
    const jsDoc = this.getEnhancedJsDoc(node, sourceFile);
    const members = this.parseInterfaceMembers(node.members, sourceFile);
    const generics = this.parseTypeParameters(node.typeParameters, sourceFile);
    const extendsClause = node.heritageClauses
      ?.filter((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
      .flatMap((h) => h.types.map((t) => this.getNodeText(t, sourceFile)));

    return {
      name,
      kind: 'interface',
      signature: this.cleanSignature(signature),
      description: jsDoc.description,
      members,
      generics: generics.length > 0 ? generics : undefined,
      extends: extendsClause && extendsClause.length > 0 ? extendsClause : undefined,
      deprecated: jsDoc.deprecated !== undefined,
      deprecatedMessage: jsDoc.deprecated || undefined,
      examples: jsDoc.examples?.length ? jsDoc.examples : undefined,
      location: this.getLocation(node, sourceFile),
    };
  }

  /**
   * Parse type alias declaration
   */
  private parseTypeAliasDeclaration(
    node: ts.TypeAliasDeclaration,
    sourceFile: ts.SourceFile
  ): TypeDefinition {
    const name = node.name.text;
    const signature = this.getNodeText(node, sourceFile);
    const jsDoc = this.getEnhancedJsDoc(node, sourceFile);
    const generics = this.parseTypeParameters(node.typeParameters, sourceFile);

    return {
      name,
      kind: 'type',
      signature: this.cleanSignature(signature),
      description: jsDoc.description,
      generics: generics.length > 0 ? generics : undefined,
      deprecated: jsDoc.deprecated !== undefined,
      deprecatedMessage: jsDoc.deprecated || undefined,
      examples: jsDoc.examples?.length ? jsDoc.examples : undefined,
      location: this.getLocation(node, sourceFile),
    };
  }

  /**
   * Parse class declaration
   */
  private parseClassDeclaration(
    node: ts.ClassDeclaration,
    sourceFile: ts.SourceFile
  ): TypeDefinition | null {
    if (!node.name) return null;

    const name = node.name.text;
    const signature = this.getNodeText(node, sourceFile);
    const jsDoc = this.getEnhancedJsDoc(node, sourceFile);
    const members = this.parseClassMembers(node.members, sourceFile);
    const generics = this.parseTypeParameters(node.typeParameters, sourceFile);

    return {
      name,
      kind: 'class',
      signature: this.cleanSignature(signature),
      description: jsDoc.description,
      members,
      generics: generics.length > 0 ? generics : undefined,
      deprecated: jsDoc.deprecated !== undefined,
      deprecatedMessage: jsDoc.deprecated || undefined,
      examples: jsDoc.examples?.length ? jsDoc.examples : undefined,
      location: this.getLocation(node, sourceFile),
    };
  }

  /**
   * Parse variable statement (for exported hooks/constants)
   */
  private parseVariableStatement(
    node: ts.VariableStatement,
    sourceFile: ts.SourceFile
  ): TypeDefinition | null {
    const declaration = node.declarationList.declarations[0];
    if (!declaration || !ts.isIdentifier(declaration.name)) return null;

    const name = declaration.name.text;
    const signature = this.getNodeText(node, sourceFile);
    const jsDoc = this.getEnhancedJsDoc(node, sourceFile);

    // Check if it's a function type (like React hooks)
    const isFunctionType =
      declaration.type && ts.isFunctionTypeNode(declaration.type);

    return {
      name,
      kind: isFunctionType ? 'function' : 'constant',
      signature: this.cleanSignature(signature),
      description: jsDoc.description,
      deprecated: jsDoc.deprecated !== undefined,
      deprecatedMessage: jsDoc.deprecated || undefined,
      examples: jsDoc.examples?.length ? jsDoc.examples : undefined,
      location: this.getLocation(node, sourceFile),
    };
  }

  /**
   * Parse enum declaration
   */
  private parseEnumDeclaration(
    node: ts.EnumDeclaration,
    sourceFile: ts.SourceFile
  ): TypeDefinition {
    const name = node.name.text;
    const signature = this.getNodeText(node, sourceFile);
    const jsDoc = this.getEnhancedJsDoc(node, sourceFile);

    const members = node.members.map((member) => ({
      name: ts.isIdentifier(member.name) ? member.name.text : this.getNodeText(member.name, sourceFile),
      type: member.initializer ? this.getNodeText(member.initializer, sourceFile) : 'auto',
      optional: false,
      readonly: true,
    }));

    return {
      name,
      kind: 'enum',
      signature: this.cleanSignature(signature),
      description: jsDoc.description,
      members,
      deprecated: jsDoc.deprecated !== undefined,
      deprecatedMessage: jsDoc.deprecated || undefined,
      location: this.getLocation(node, sourceFile),
    };
  }

  /**
   * Parse function parameters
   */
  private parseParameters(
    parameters: ts.NodeArray<ts.ParameterDeclaration>,
    sourceFile: ts.SourceFile
  ): ParameterInfo[] {
    return parameters.map((param) => ({
      name: ts.isIdentifier(param.name)
        ? param.name.text
        : this.getNodeText(param.name, sourceFile),
      type: param.type ? this.getNodeText(param.type, sourceFile) : 'any',
      optional: !!param.questionToken || !!param.initializer,
      defaultValue: param.initializer
        ? this.getNodeText(param.initializer, sourceFile)
        : undefined,
    }));
  }

  /**
   * Parse type parameters (generics)
   */
  private parseTypeParameters(
    typeParameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined,
    sourceFile: ts.SourceFile
  ): string[] {
    if (!typeParameters) return [];
    return typeParameters.map((tp) => this.getNodeText(tp, sourceFile));
  }

  /**
   * Parse interface members
   */
  private parseInterfaceMembers(
    members: ts.NodeArray<ts.TypeElement>,
    sourceFile: ts.SourceFile
  ): MemberInfo[] {
    return members
      .filter((m) => ts.isPropertySignature(m) || ts.isMethodSignature(m))
      .map((member) => {
        const name = member.name ? this.getNodeText(member.name, sourceFile) : 'unknown';
        let type = 'unknown';

        if (ts.isPropertySignature(member) && member.type) {
          type = this.getNodeText(member.type, sourceFile);
        } else if (ts.isMethodSignature(member)) {
          type = this.getNodeText(member, sourceFile);
        }

        return {
          name,
          type,
          optional: !!member.questionToken,
          readonly: member.modifiers?.some(
            (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword
          ) ?? false,
          description: this.getJsDocComment(member, sourceFile),
        };
      });
  }

  /**
   * Parse class members
   */
  private parseClassMembers(
    members: ts.NodeArray<ts.ClassElement>,
    sourceFile: ts.SourceFile
  ): MemberInfo[] {
    return members
      .filter(
        (m) =>
          ts.isPropertyDeclaration(m) ||
          ts.isMethodDeclaration(m) ||
          ts.isGetAccessorDeclaration(m)
      )
      .map((member) => {
        const name = member.name ? this.getNodeText(member.name, sourceFile) : 'unknown';
        let type = 'unknown';

        if (
          (ts.isPropertyDeclaration(member) || ts.isGetAccessorDeclaration(member)) &&
          member.type
        ) {
          type = this.getNodeText(member.type, sourceFile);
        } else if (ts.isMethodDeclaration(member)) {
          type = this.getNodeText(member, sourceFile);
        }

        const isReadonly = member.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword
        ) ?? ts.isGetAccessorDeclaration(member);

        return {
          name,
          type,
          optional: (ts.isPropertyDeclaration(member) && !!member.questionToken) ?? false,
          readonly: isReadonly,
          description: this.getJsDocComment(member, sourceFile),
        };
      });
  }

  /**
   * Enhanced JSDoc extraction result
   */
  private getEnhancedJsDoc(node: ts.Node, sourceFile: ts.SourceFile): {
    description?: string;
    params?: Record<string, string>;
    returns?: string;
    examples?: string[];
    deprecated?: string;
    see?: string[];
  } {
    const result: {
      description?: string;
      params?: Record<string, string>;
      returns?: string;
      examples?: string[];
      deprecated?: string;
      see?: string[];
    } = {};

    // Try TS compiler JSDoc API first
    const jsDocTags = ts.getJSDocTags(node);
    if (jsDocTags.length > 0) {
      const params: Record<string, string> = {};
      const examples: string[] = [];
      const see: string[] = [];

      for (const tag of jsDocTags) {
        const tagName = tag.tagName.text.toLowerCase();
        const comment = tag.comment ? ts.getTextOfJSDocComment(tag.comment) : '';

        switch (tagName) {
          case 'param': {
            // Extract param name from the tag
            if (ts.isJSDocParameterTag(tag) && ts.isIdentifier(tag.name)) {
              params[tag.name.text] = comment || '';
            }
            break;
          }
          case 'returns':
          case 'return':
            result.returns = comment || undefined;
            break;
          case 'example':
            if (comment) examples.push(comment);
            break;
          case 'deprecated':
            result.deprecated = comment || 'Deprecated';
            break;
          case 'see':
            if (comment) see.push(comment);
            break;
          case 'description':
            result.description = comment || undefined;
            break;
        }
      }

      if (Object.keys(params).length > 0) result.params = params;
      if (examples.length > 0) result.examples = examples;
      if (see.length > 0) result.see = see;
    }

    // Fall back to / supplement with leading comment parsing
    if (!result.description) {
      const fullText = sourceFile.getFullText();
      const commentRanges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
      if (commentRanges && commentRanges.length > 0) {
        const lastComment = commentRanges[commentRanges.length - 1];
        const commentText = fullText.slice(lastComment.pos, lastComment.end);

        if (commentText.startsWith('/**')) {
          const parsed = this.parseEnhancedJsDocComment(commentText);
          // Merge: leading comment supplements but doesn't override
          if (!result.description && parsed.description) result.description = parsed.description;
          if (!result.params && parsed.params) result.params = parsed.params;
          if (!result.returns && parsed.returns) result.returns = parsed.returns;
          if (!result.examples && parsed.examples) result.examples = parsed.examples;
          if (result.deprecated === undefined && parsed.deprecated !== undefined) result.deprecated = parsed.deprecated;
          if (!result.see && parsed.see) result.see = parsed.see;
        }
      }
    }

    return result;
  }

  /**
   * Parse enhanced JSDoc comment text extracting all tag types
   */
  private parseEnhancedJsDocComment(comment: string): {
    description?: string;
    params?: Record<string, string>;
    returns?: string;
    examples?: string[];
    deprecated?: string;
    see?: string[];
  } {
    const result: {
      description?: string;
      params?: Record<string, string>;
      returns?: string;
      examples?: string[];
      deprecated?: string;
      see?: string[];
    } = {};

    const lines = comment
      .replace(/^\/\*\*/, '')
      .replace(/\*\/$/, '')
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, ''));

    const descriptionLines: string[] = [];
    let currentTag: string | null = null;
    let currentTagContent: string[] = [];
    const params: Record<string, string> = {};
    const examples: string[] = [];
    const see: string[] = [];

    const flushTag = () => {
      if (!currentTag) return;
      const content = currentTagContent.join('\n').trim();

      if (currentTag === 'param') {
        // Parse "@param {type} name description" or "@param name description"
        const paramMatch = content.match(/^(?:\{[^}]*\}\s+)?(\w+)\s*(.*)/s);
        if (paramMatch) {
          params[paramMatch[1]] = paramMatch[2].trim();
        }
      } else if (currentTag === 'returns' || currentTag === 'return') {
        result.returns = content.replace(/^\{[^}]*\}\s*/, '');
      } else if (currentTag === 'example') {
        if (content) examples.push(content);
      } else if (currentTag === 'deprecated') {
        result.deprecated = content || 'Deprecated';
      } else if (currentTag === 'see') {
        if (content) see.push(content);
      }

      currentTag = null;
      currentTagContent = [];
    };

    for (const line of lines) {
      const trimmed = line.trim();
      const tagMatch = trimmed.match(/^@(\w+)\s*(.*)/);

      if (tagMatch) {
        flushTag();
        currentTag = tagMatch[1].toLowerCase();
        currentTagContent = [tagMatch[2]];
      } else if (currentTag) {
        currentTagContent.push(trimmed);
      } else if (trimmed) {
        descriptionLines.push(trimmed);
      }
    }
    flushTag();

    const description = descriptionLines.join(' ').trim();
    if (description) result.description = description;
    if (Object.keys(params).length > 0) result.params = params;
    if (examples.length > 0) result.examples = examples;
    if (see.length > 0) result.see = see;

    return result;
  }

  /**
   * Get JSDoc comment for a node (simple version for members)
   */
  private getJsDocComment(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
    const jsDoc = this.getEnhancedJsDoc(node, sourceFile);
    return jsDoc.description;
  }

  /**
   * Get text of a node
   */
  private getNodeText(node: ts.Node, sourceFile: ts.SourceFile): string {
    return node.getText(sourceFile);
  }

  /**
   * Get source location of a node
   */
  private getLocation(
    node: ts.Node,
    sourceFile: ts.SourceFile
  ): { line: number; column: number } {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile)
    );
    return { line: line + 1, column: character + 1 };
  }

  /**
   * Clean up signature for better readability
   */
  private cleanSignature(signature: string): string {
    return signature
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/;\s*}/g, ' }') // Clean up interface endings
      .trim();
  }

  /**
   * Collect related types from a definition
   */
  private collectRelatedTypes(
    definition: TypeDefinition,
    parseResult: ParseResult
  ): Record<string, string> {
    const relatedTypes: Record<string, string> = {};
    const typeNames = new Set<string>();

    // Extract type names from parameters
    if (definition.parameters) {
      for (const param of definition.parameters) {
        this.extractTypeNames(param.type, typeNames);
      }
    }

    // Extract type names from return type
    if (definition.returnType) {
      this.extractTypeNames(definition.returnType, typeNames);
    }

    // Extract type names from extends clause
    if (definition.extends) {
      for (const ext of definition.extends) {
        this.extractTypeNames(ext, typeNames);
      }
    }

    // Extract type names from members
    if (definition.members) {
      for (const member of definition.members) {
        this.extractTypeNames(member.type, typeNames);
      }
    }

    // Look up related types in parse result
    for (const typeName of typeNames) {
      const relatedDef = parseResult.relatedTypes.get(typeName);
      if (relatedDef) {
        relatedTypes[typeName] = relatedDef.signature;
      }
    }

    return relatedTypes;
  }

  /**
   * Extract type names from a type string
   */
  private extractTypeNames(typeString: string, typeNames: Set<string>): void {
    // Match type identifiers (PascalCase names)
    const matches = typeString.match(/[A-Z][a-zA-Z0-9]*/g);
    if (matches) {
      for (const match of matches) {
        // Skip built-in types
        if (!this.isBuiltInType(match)) {
          typeNames.add(match);
        }
      }
    }
  }

  /**
   * Check if a type name is a built-in type
   */
  private isBuiltInType(typeName: string): boolean {
    const builtIns = new Set([
      'Array',
      'String',
      'Number',
      'Boolean',
      'Object',
      'Function',
      'Symbol',
      'BigInt',
      'Promise',
      'Map',
      'Set',
      'WeakMap',
      'WeakSet',
      'Record',
      'Partial',
      'Required',
      'Readonly',
      'Pick',
      'Omit',
      'Exclude',
      'Extract',
      'NonNullable',
      'Parameters',
      'ReturnType',
      'InstanceType',
      'ThisType',
      'Awaited',
      'ReadonlyArray',
    ]);
    return builtIns.has(typeName);
  }

  /**
   * Clear parse cache
   */
  clearCache(): void {
    this.parseCache.clear();
    logger.debug('Parse cache cleared');
  }
}

// Singleton instance
let instance: TypeParser | null = null;

export function getTypeParser(): TypeParser {
  if (!instance) {
    instance = new TypeParser();
  }
  return instance;
}
