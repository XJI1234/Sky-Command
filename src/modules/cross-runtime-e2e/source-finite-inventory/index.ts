import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

export interface SourceFiniteInventoryEntry {
  readonly runtime: "desktop" | "mobile";
  readonly kind: "typescript-union" | "typescript-const" | "kotlin-enum" | "kotlin-sealed";
  readonly name: string;
  readonly path: string;
  readonly values: readonly string[];
}

export interface SourceFiniteInventorySnapshot {
  readonly entries: readonly SourceFiniteInventoryEntry[];
  readonly digest: string;
}

export interface SourceFiniteInventoryInput {
  readonly desktopRoot: string;
  readonly mobileRoot: string;
}

const filesBelow = (root: string, extension: string): readonly string[] => {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) visit(path);
      else if (item.isFile() && item.name.endsWith(extension)) files.push(path);
    }
  };
  visit(root);
  return files.sort();
};

const exported = (node: ts.Node): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;

const unionMember = (node: ts.TypeNode): string | null => {
  if (ts.isLiteralTypeNode(node)) {
    if (ts.isStringLiteral(node.literal) || ts.isNumericLiteral(node.literal)) return node.literal.text;
    if (node.literal.kind === ts.SyntaxKind.TrueKeyword) return "true";
    if (node.literal.kind === ts.SyntaxKind.FalseKeyword) return "false";
  }
  if (ts.isTypeReferenceNode(node)) return node.typeName.getText();
  if (ts.isTypeLiteralNode(node)) {
    const discriminator = node.members.find((member): member is ts.PropertySignature =>
      ts.isPropertySignature(member) && member.name?.getText() === "type" && member.type !== undefined);
    return discriminator?.type === undefined ? null : unionMember(discriminator.type);
  }
  return null;
};

const desktopEntries = (root: string): readonly SourceFiniteInventoryEntry[] => {
  const entries: SourceFiniteInventoryEntry[] = [];
  for (const path of filesBelow(root, ".ts")) {
    const normalized = relative(root, path).replaceAll("\\", "/");
    if (normalized.includes("/cross-runtime-e2e/") || normalized.endsWith(".test.ts") || normalized.includes("/tests/")) continue;
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    source.forEachChild((node) => {
      if (ts.isTypeAliasDeclaration(node) && exported(node) && ts.isUnionTypeNode(node.type)) {
        const values = node.type.types.map(unionMember);
        const unique = [...new Set(values.filter((value): value is string => value !== null))].sort();
        if (values.every((value): value is string => value !== null) && unique.length >= 2) {
          entries.push({ runtime: "desktop", kind: "typescript-union", name: node.name.text, path: normalized, values: Object.freeze(unique) });
        }
      }
      if (ts.isVariableStatement(node) && exported(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
          let expression: ts.Expression = declaration.initializer;
          if (ts.isCallExpression(expression) && expression.expression.getText() === "Object.freeze" && expression.arguments[0] !== undefined) expression = expression.arguments[0];
          if (ts.isAsExpression(expression)) expression = expression.expression;
          if (!ts.isArrayLiteralExpression(expression)) continue;
          const values = expression.elements.map((element) => ts.isStringLiteral(element) ? element.text : null);
          if (values.length >= 2 && values.every((value): value is string => value !== null)) {
            entries.push({ runtime: "desktop", kind: "typescript-const", name: declaration.name.text, path: normalized, values: Object.freeze([...new Set(values)].sort()) });
          }
        }
      }
    });
  }
  return entries;
};

const matchingBrace = (source: string, opening: number): number => {
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return index;
  }
  return -1;
};

const maskParentheses = (source: string): string => {
  const characters = [...source];
  let depth = 0;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === "(") { depth += 1; characters[index] = " "; }
    else if (character === ")" && depth > 0) { depth -= 1; characters[index] = " "; }
    else if (depth > 0 && character !== "\n" && character !== "\r") characters[index] = " ";
  }
  return characters.join("");
};

const kotlinEntries = (root: string): readonly SourceFiniteInventoryEntry[] => {
  const entries: SourceFiniteInventoryEntry[] = [];
  for (const path of filesBelow(root, ".kt")) {
    const normalized = relative(root, path).replaceAll("\\", "/");
    if (!normalized.includes("/src/main/") || normalized.includes("/cross-runtime-e2e/")) continue;
    const source = readFileSync(path, "utf8");
    const declarations = maskParentheses(source);
    for (const match of source.matchAll(/\benum\s+class\s+([A-Za-z_][A-Za-z0-9_]*)[^\{]*\{/gu)) {
      const name = match[1];
      const opening = (match.index ?? 0) + match[0].lastIndexOf("{");
      const closing = matchingBrace(source, opening);
      if (name === undefined || closing < 0) continue;
      const header = source.slice(opening + 1, closing).split(";")[0] ?? "";
      const values = [...header.matchAll(/(?:^|,)\s*([A-Z][A-Z0-9_]*)\b/gu)].map((entry) => entry[1]).filter((value): value is string => value !== undefined);
      if (values.length >= 1) entries.push({ runtime: "mobile", kind: "kotlin-enum", name, path: normalized, values: Object.freeze([...new Set(values)].sort()) });
    }
    for (const match of source.matchAll(/\bsealed\s+(?:interface|class)\s+([A-Za-z_][A-Za-z0-9_]*)/gu)) {
      const name = match[1];
      if (name === undefined) continue;
      const declarationsFound = [...declarations.matchAll(/\b(?:data\s+)?(?:class|object)\s+([A-Za-z_][A-Za-z0-9_]*)/gu)];
      const values = declarationsFound.flatMap((declaration, index) => {
        const variant = declaration[1];
        const start = declaration.index ?? 0;
        const next = declarationsFound[index + 1]?.index ?? declarations.length;
        const opening = declarations.indexOf("{", start);
        const end = opening >= 0 && opening < next ? opening : next;
        const header = declarations.slice(start, end);
        return variant !== undefined && new RegExp(`:\\s*${name}\\b`, "u").test(header) ? [variant] : [];
      });
      if (values.length >= 1) entries.push({ runtime: "mobile", kind: "kotlin-sealed", name, path: normalized, values: Object.freeze([...new Set(values)].sort()) });
    }
  }
  return entries;
};

const collect = (input: SourceFiniteInventoryInput): SourceFiniteInventorySnapshot => {
  const entries = [...desktopEntries(resolve(input.desktopRoot)), ...kotlinEntries(resolve(input.mobileRoot))]
    .sort((left, right) => `${left.runtime}:${left.path}:${left.name}`.localeCompare(`${right.runtime}:${right.path}:${right.name}`));
  const frozen = Object.freeze(entries.map((entry) => Object.freeze({ ...entry, values: Object.freeze([...entry.values]) })));
  const digest = createHash("sha256").update(JSON.stringify(frozen)).digest("hex");
  return Object.freeze({ entries: frozen, digest });
};

export const SourceFiniteInventory = Object.freeze({ collect });
