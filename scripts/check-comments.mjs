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
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const seen = new Map();

  const collect = (ranges) => {
    for (const range of ranges ?? []) {
      seen.set(range.pos, text.slice(range.pos, range.end));
    }
  };

  const visit = (node) => {
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, node.getEnd()));
    for (const child of node.getChildren(source)) {
      visit(child);
    }
  };

  visit(source);

  return [...seen.entries()]
    .filter(([, comment]) => !allowedDirectives.some((pattern) => pattern.test(comment)))
    .map(([position, comment]) => {
      const line = text.slice(0, position).split('\n').length;
      return `${path}:${line}  ${comment.split('\n')[0]}`;
    });
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
