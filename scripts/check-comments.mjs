import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import ts from 'typescript';

const roots = ['src', 'test', 'prisma', 'scripts'];
const ignoredDirectories = new Set(['node_modules', 'dist', 'generated', 'migrations']);
const extensions = new Set(['.ts', '.mts', '.js', '.mjs']);
const allowedDirectives = [
  /^\/\/\s*eslint-disable/,
  /^\/\*\s*eslint-disable/,
  /^\/\/\s*@ts-expect-error/,
];

function collectFiles(directory) {
  let files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (!ignoredDirectories.has(entry)) files = files.concat(collectFiles(path));
    } else if (extensions.has(extname(entry))) {
      files.push(path);
    }
  }
  return files;
}

function findComments(path) {
  const text = readFileSync(path, 'utf8');
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  const found = [];
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const comment = scanner.getTokenText();
      if (!allowedDirectives.some((pattern) => pattern.test(comment))) {
        const line = text.slice(0, scanner.getTokenStart()).split('\n').length;
        found.push(`${path}:${line}  ${comment.split('\n')[0]}`);
      }
    }
    token = scanner.scan();
  }
  return found;
}

const existingRoots = roots.filter((root) => {
  try {
    return statSync(root).isDirectory();
  } catch {
    return false;
  }
});

const offenders = existingRoots.flatMap(collectFiles).flatMap(findComments);

if (offenders.length > 0) {
  process.stderr.write(`Comments are not allowed in this codebase:\n${offenders.join('\n')}\n`);
  process.exit(1);
}
