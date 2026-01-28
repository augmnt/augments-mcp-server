/**
 * TypeScript Parser
 *
 * Uses TypeScript compiler API to parse .d.ts files and extract API signatures.
 * Given a concept (e.g., "useEffect"), finds its signature and resolves type references.
 */

import ts from 'typescript';
import { getLogger } from '@/utils/logger';

const logger = getLogger('type-parser');

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
}

/**
 * TypeScript parser for extracting API signatures from .d.ts content
 */
export class TypeParser {
  private printer: ts.Printer;

  constructor() {
    this.printer = ts.createPrinter({
      newLine: ts.NewLineKind.LineFeed,
      removeComments: false,
    });
  }

  /**
   * Parse TypeScript definition content and extract all type definitions
   */
  parse(content: string, fileName: string = 'types.d.ts'): ParseResult {
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

    logger.debug('Parsed type definitions', {
      fileName,
      definitionCount: definitions.length,
      errorCount: errors.length,
    });

    return { definitions, relatedTypes, errors };
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

    return {
      name: primaryMatch.name,
      signature: primaryMatch.signature,
      description: primaryMatch.description,
      parameters: primaryMatch.parameters,
      returnType: primaryMatch.returnType,
      overloads: overloads.length > 1 ? overloads : undefined,
      relatedTypes,
    };
  }

  /**
   * Search for APIs matching a query
   */
  searchApis(content: string, query: string, fileName: string = 'types.d.ts'): TypeDefinition[] {
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
        // Prioritize exact name matches
        const aExact = a.name.toLowerCase() === queryLower;
        const bExact = b.name.toLowerCase() === queryLower;
        if (aExact && !bExact) return -1;
        if (bExact && !aExact) return 1;

        // Then prioritize starts-with matches
        const aStarts = a.name.toLowerCase().startsWith(queryLower);
        const bStarts = b.name.toLowerCase().startsWith(queryLower);
        if (aStarts && !bStarts) return -1;
        if (bStarts && !aStarts) return 1;

        // Finally sort alphabetically
        return a.name.localeCompare(b.name);
      });
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
    const description = this.getJsDocComment(node, sourceFile);
    const parameters = this.parseParameters(node.parameters, sourceFile);
    const returnType = node.type ? this.getNodeText(node.type, sourceFile) : 'void';
    const generics = this.parseTypeParameters(node.typeParameters, sourceFile);

    return {
      name,
      kind: 'function',
      signature: this.cleanSignature(signature),
      description,
      parameters,
      returnType,
      generics: generics.length > 0 ? generics : undefined,
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
    const description = this.getJsDocComment(node, sourceFile);
    const members = this.parseInterfaceMembers(node.members, sourceFile);
    const generics = this.parseTypeParameters(node.typeParameters, sourceFile);
    const extendsClause = node.heritageClauses
      ?.filter((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
      .flatMap((h) => h.types.map((t) => this.getNodeText(t, sourceFile)));

    return {
      name,
      kind: 'interface',
      signature: this.cleanSignature(signature),
      description,
      members,
      generics: generics.length > 0 ? generics : undefined,
      extends: extendsClause && extendsClause.length > 0 ? extendsClause : undefined,
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
    const description = this.getJsDocComment(node, sourceFile);
    const generics = this.parseTypeParameters(node.typeParameters, sourceFile);

    return {
      name,
      kind: 'type',
      signature: this.cleanSignature(signature),
      description,
      generics: generics.length > 0 ? generics : undefined,
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
    const description = this.getJsDocComment(node, sourceFile);
    const members = this.parseClassMembers(node.members, sourceFile);
    const generics = this.parseTypeParameters(node.typeParameters, sourceFile);

    return {
      name,
      kind: 'class',
      signature: this.cleanSignature(signature),
      description,
      members,
      generics: generics.length > 0 ? generics : undefined,
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
    const description = this.getJsDocComment(node, sourceFile);

    // Check if it's a function type (like React hooks)
    const isFunctionType =
      declaration.type && ts.isFunctionTypeNode(declaration.type);

    return {
      name,
      kind: isFunctionType ? 'function' : 'constant',
      signature: this.cleanSignature(signature),
      description,
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
    const description = this.getJsDocComment(node, sourceFile);

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
      description,
      members,
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
   * Get JSDoc comment for a node
   */
  private getJsDocComment(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
    const jsDocTags = ts.getJSDocTags(node);
    if (jsDocTags.length > 0) {
      const descriptions = jsDocTags
        .filter((tag) => tag.tagName.text === 'description' || !tag.tagName.text)
        .map((tag) => (tag.comment ? ts.getTextOfJSDocComment(tag.comment) : ''))
        .filter(Boolean);
      if (descriptions.length > 0) {
        return descriptions.join('\n');
      }
    }

    // Try to get leading comment
    const fullText = sourceFile.getFullText();
    const commentRanges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
    if (commentRanges && commentRanges.length > 0) {
      const lastComment = commentRanges[commentRanges.length - 1];
      const commentText = fullText.slice(lastComment.pos, lastComment.end);

      // Parse JSDoc style comment
      if (commentText.startsWith('/**')) {
        return this.parseJsDocComment(commentText);
      }
    }

    return undefined;
  }

  /**
   * Parse JSDoc comment text
   */
  private parseJsDocComment(comment: string): string | undefined {
    // Remove /** and */ and clean up
    const lines = comment
      .replace(/^\/\*\*/, '')
      .replace(/\*\/$/, '')
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').trim())
      .filter((line) => !line.startsWith('@')); // Remove @param, @returns, etc.

    const description = lines.join(' ').trim();
    return description || undefined;
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
}

// Singleton instance
let instance: TypeParser | null = null;

export function getTypeParser(): TypeParser {
  if (!instance) {
    instance = new TypeParser();
  }
  return instance;
}
