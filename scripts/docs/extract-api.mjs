/**
 * Extracts the real API surface from source so the documentation can never
 * drift from the code: every exported symbol, class member and JSDoc summary
 * is read from the TypeScript AST rather than copied by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(url.fileURLToPath(new URL('../../', import.meta.url)));

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'reports', 'test-results', '.husky'].includes(entry.name))
      continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function jsdoc(node, source) {
  const ranges = ts.getLeadingCommentRanges(source.text, node.pos) ?? [];
  const block = ranges
    .map((r) => source.text.slice(r.pos, r.end))
    .filter((t) => t.startsWith('/**'))
    .pop();
  if (!block) return '';
  return block
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*\*ances?/, '')
        .replace(/^\s*\*ance?/, '')
        .replace(/^\s*\* ?/, '')
        .trim(),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isExported(node) {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

function memberSignature(member, source) {
  const name = member.name ? member.name.getText(source) : '(anonymous)';
  const mods = (member.modifiers ?? []).map((m) => m.getText(source));
  const isPrivate = mods.includes('private') || mods.includes('protected') || name.startsWith('#');
  if (ts.isMethodDeclaration(member)) {
    const params = member.parameters.map((p) => p.getText(source)).join(', ');
    const ret = member.type ? member.type.getText(source) : '';
    return {
      kind: 'method',
      name,
      signature: `${name}(${params})${ret ? `: ${ret}` : ''}`,
      isPrivate,
      doc: jsdoc(member, source),
    };
  }
  if (ts.isGetAccessor(member)) {
    const ret = member.type ? member.type.getText(source) : '';
    return {
      kind: 'getter',
      name,
      signature: `get ${name}${ret ? `: ${ret}` : ''}`,
      isPrivate,
      doc: jsdoc(member, source),
    };
  }
  if (ts.isPropertyDeclaration(member)) {
    const type = member.type ? member.type.getText(source) : '';
    return {
      kind: 'property',
      name,
      signature: `${name}${type ? `: ${type}` : ''}`,
      isPrivate,
      doc: jsdoc(member, source),
    };
  }
  return null;
}

const files = walk(ROOT)
  .map((f) => path.relative(ROOT, f))
  .sort();
const result = { generatedAt: new Date().toISOString(), files: {} };

for (const rel of files) {
  const abs = path.join(ROOT, rel);
  const stat = fs.statSync(abs);
  const entry = { path: rel, bytes: stat.size, lines: 0, exports: [], moduleDoc: '' };

  if (/\.(ts|mts|mjs|js)$/.test(rel) && !rel.endsWith('.d.ts')) {
    const text = fs.readFileSync(abs, 'utf8');
    entry.lines = text.split('\n').length;
    const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);

    for (const node of source.statements) {
      if (ts.isClassDeclaration(node) && node.name && isExported(node)) {
        const members = node.members.map((m) => memberSignature(m, source)).filter(Boolean);
        const heritage = (node.heritageClauses ?? []).map((h) => h.getText(source)).join(' ');
        entry.exports.push({
          kind: 'class',
          name: node.name.getText(source),
          heritage,
          doc: jsdoc(node, source),
          members: members.filter((m) => !m.isPrivate),
          privateCount: members.filter((m) => m.isPrivate).length,
        });
      } else if (ts.isFunctionDeclaration(node) && node.name && isExported(node)) {
        const params = node.parameters.map((p) => p.getText(source)).join(', ');
        const ret = node.type ? node.type.getText(source) : '';
        entry.exports.push({
          kind: 'function',
          name: node.name.getText(source),
          signature: `${node.name.getText(source)}(${params})${ret ? `: ${ret}` : ''}`,
          doc: jsdoc(node, source),
        });
      } else if (ts.isInterfaceDeclaration(node) && isExported(node)) {
        entry.exports.push({
          kind: 'interface',
          name: node.name.getText(source),
          doc: jsdoc(node, source),
          members: node.members.map((m) => m.getText(source).replace(/\s+/g, ' ')),
        });
      } else if (ts.isTypeAliasDeclaration(node) && isExported(node)) {
        entry.exports.push({
          kind: 'type',
          name: node.name.getText(source),
          doc: jsdoc(node, source),
          definition: node.type.getText(source).replace(/\s+/g, ' ').slice(0, 400),
        });
      } else if (ts.isVariableStatement(node) && isExported(node)) {
        for (const decl of node.declarationList.declarations) {
          entry.exports.push({
            kind: 'const',
            name: decl.name.getText(source),
            doc: jsdoc(node, source),
            type: decl.type ? decl.type.getText(source) : '',
          });
        }
      } else if (ts.isExportDeclaration(node)) {
        const names =
          node.exportClause && ts.isNamedExports(node.exportClause)
            ? node.exportClause.elements.map((e) => e.name.getText(source))
            : [];
        if (names.length)
          entry.exports.push({
            kind: 're-export',
            name: names.join(', '),
            from: node.moduleSpecifier?.getText(source) ?? '',
          });
      }
    }
  } else {
    entry.lines = /\.(json|md|yml|yaml|xml|txt|csv|html)$/.test(rel)
      ? fs.readFileSync(abs, 'utf8').split('\n').length
      : 0;
  }

  result.files[rel] = entry;
}

fs.mkdirSync(path.join(ROOT, 'docs/generated'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/generated/api.json'), JSON.stringify(result, null, 2));

const counts = Object.values(result.files);
console.log('FILES=' + counts.length);
console.log('TS_FILES=' + counts.filter((f) => f.path.endsWith('.ts')).length);
console.log('EXPORTS=' + counts.reduce((n, f) => n + f.exports.length, 0));
