import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(full));
    else files.push(full);
  }
  return files;
}

const files = await filesUnder(root);
const textFiles = files.filter((file) => ['.json', '.md', '.mdx', '.mjs', '.yml', '.yaml'].includes(extname(file)));

/*
 * This site began as a clone of another product's docs. These patterns exist so
 * that origin cannot leak back in — a docs page describing somebody else's API
 * is worse than a missing page, because it reads as authoritative.
 */
const clonedTerms = [
  /scrinly/iu,
  /boostgpt/iu,
  /api\.scrinly\.com/iu,
  /discord\.gg\/(?:KGhz5SnyXM|mt8pGkgUZj)/iu,
];

for (const file of textFiles) {
  if (file.endsWith('scripts/audit.mjs')) continue;
  const content = await readFile(file, 'utf8');
  for (const pattern of clonedTerms) {
    if (pattern.test(content)) failures.push(`${relative(root, file)} contains cloned-product content matching ${pattern}`);
  }

  const fenced = [...content.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)].map((match) => match[1]).join('\n');
  const secretPatterns = [
    /sk_(?:live|test)_[A-Za-z0-9_-]{20,}/gu,
    /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/gu,
    /\bAKIA[0-9A-Z]{16}\b/gu,
    /\bre_[A-Za-z0-9]{20,}\b/gu,
    /\bwhsec_[A-Za-z0-9+/=]{20,}\b/gu,
    /\bpolar_(?:oat|pat)_[A-Za-z0-9_-]{16,}\b/gu,
    /Authorization:\s*Bearer\s+(?!\$[A-Z_]+\b|<)[^\s'"]{16,}/giu,
  ];
  for (const pattern of secretPatterns) {
    if (pattern.test(fenced)) failures.push(`${relative(root, file)} appears to contain a real credential in an example`);
  }
}

const openapiPath = join(root, 'api-reference', 'openapi.json');
const openapi = JSON.parse(await readFile(openapiPath, 'utf8'));
if (openapi.openapi !== '3.1.0') failures.push('OpenAPI document must use version 3.1.0');
if (!openapi.servers?.some(({ url }) => url === 'https://metamanager.dev')) failures.push('OpenAPI production server is missing');

const expected = new Set([
  'GET /inspect',
  'GET /entitlements',
  'GET /health',
  'GET /api/issues',
  'GET /api/issues/{code}',
]);

const actual = new Set();
for (const [path, pathItem] of Object.entries(openapi.paths ?? {})) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    if (pathItem[method]) actual.add(`${method.toUpperCase()} ${path}`);
  }
}

for (const route of expected) {
  if (!actual.has(route)) failures.push(`OpenAPI is missing ${route}`);
}
for (const route of actual) {
  if (!expected.has(route)) failures.push(`OpenAPI exposes unexpected route ${route}`);
}

/*
 * Routes that exist but are not a public API. /auth is the sign-in flow and
 * /polar is a payment provider's webhook; documenting either would invite people
 * to build against something that is free to change without notice.
 *
 * /api was on this list until Phase 7, on the grounds that it was the web
 * application's own cookie-authenticated surface. API keys made that false: it
 * is now a public, key-authenticated API. It is NOT blanket-allowed though —
 * the `expected` set above is what admits an /api route, so adding one to the
 * spec without deciding to document it still fails.
 *
 * /health is deliberately absent too — it is a documented public endpoint.
 */
const operatorPrefixes = ['/auth', '/polar', '/admin', '/internal'];
for (const path of Object.keys(openapi.paths ?? {})) {
  if (operatorPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    failures.push(`Operator route appears in OpenAPI: ${path}`);
  }
}

/*
 * Match whole values, not substrings. A plain `includes('/auth')` also fires on
 * the page slug `getting-started/authentication`, which is a documentation page
 * rather than an operator route.
 */
const docsJson = JSON.parse(await readFile(join(root, 'docs.json'), 'utf8'));
const navigationText = JSON.stringify(docsJson.navigation ?? {});

const stringValues = (node, out = []) => {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => stringValues(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => stringValues(n, out));
  return out;
};

for (const value of stringValues(docsJson)) {
  for (const prefix of operatorPrefixes) {
    const isRoute = value === prefix
      || value.startsWith(`${prefix}/`)
      || /^https?:\/\/[^/]+/u.test(value) && new URL(value).pathname.startsWith(prefix);
    if (isRoute) failures.push(`Operator route appears in navigation: ${value}`);
  }
}

for (const page of navigationText.matchAll(/"((?:getting-started|guides|operations|api-reference)\/[a-z0-9-]+|index|changelog)"/gu)) {
  if (page[1] === 'api-reference/endpoints') continue;
  const file = join(root, `${page[1]}.mdx`);
  try {
    if (!(await stat(file)).isFile()) failures.push(`Navigation page is not a file: ${page[1]}`);
  } catch {
    failures.push(`Navigation page is missing: ${page[1]}`);
  }
}

if (failures.length) {
  console.error(`Documentation audit failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Documentation audit passed: ${actual.size} public operations, ${textFiles.length} text files.`);
