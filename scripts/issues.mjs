/**
 * Generate guides/issues.mdx from the checker's own rule table.
 *
 * The issue codes are a public contract — the API README says so, and a guard
 * test in the API pins them. A hand-written reference would drift away from
 * that contract the first time a rule changed, and a docs page that lists a
 * code the checker no longer emits is worse than no page.
 *
 * So this reads RULES straight from src/report/issues.js. Regenerate with:
 *
 *   node scripts/issues.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, SEVERITY } from '../../platform/api/src/report/issues.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Rules describe themselves against a live report, so `describe()` needs a
 * context. These stand-ins produce the generic wording; rules that quote a
 * measured number fall back to their static text.
 */
/**
 * A stand-in for a parsed page.
 *
 * Shaped to match what extractMetadata() produces — `meta` and `properties` are
 * maps of name to array of values, which is what metaValue() and
 * propertyValue() read. Handing rules a flat object instead makes them throw,
 * and a thrown rule silently loses its description from this reference.
 */
const context = (title, description, image, properties = {}) => ({
  extracted: {
    title,
    titles: [title],
    meta: { description: [description] },
    properties,
    links: [],
    canonical: null,
    canonicals: [],
  },
  // The image rules read width/height off this; a null image makes them throw
  // and silently drop their description from the reference.
  image: image,
  finalUrl: 'https://example.com/',
});

// Two contexts that differ only in the measured values. Rendering a rule
// against both reveals which words came from the page rather than from the
// rule — see `describe` below.
const CONTEXT = context('Example title', 'An example description.',
  { width: 600, height: 315, bytes: 40_000, type: 'image/png', accessible: true },
  { 'og:image:width': ['1200'], 'og:image:height': ['630'] });
const OTHER = context('A rather longer example title', 'A noticeably longer example description here.',
  { width: 800, height: 420, bytes: 90_000, type: 'image/jpeg', accessible: true },
  { 'og:image:width': ['1600'], 'og:image:height': ['900'] });

const SEVERITY_NOTE = {
  [SEVERITY.ERROR]: 'Something is broken and is costing you now.',
  [SEVERITY.WARNING]: 'A tag that matters is missing or wrong.',
  [SEVERITY.TIP]: 'Worth improving, but nothing is broken.',
};

const escape = (s) => String(s).replace(/\|/gu, '\\|').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

/**
 * A rule's description, with measured values neutralised.
 *
 * Several rules quote a number taken from the page — "Your title is 13
 * characters". Rendered against a stub that number is fiction, and printing it
 * in a reference reads as though 13 were meaningful. So each rule is rendered
 * against two contexts that differ only in their measurements, and any word
 * that changes between them is replaced with `N`. Thresholds, which come from
 * the rule rather than the page, are identical in both and survive.
 */
function describe(rule) {
  let a;
  let b;
  try {
    a = rule.describe(CONTEXT);
    b = rule.describe(OTHER);
  } catch {
    return null;
  }
  if (a === b) return a;

  const left = a.split(' ');
  const right = b.split(' ');
  if (left.length !== right.length) return null;

  // Keep punctuation attached to the token. "315." and "420." differ as whole
  // words, and replacing the pair wholesale eats the sentence's full stop.
  const SPLIT = /^([^\w]*)(.*?)([^\w]*)$/u;
  return left.map((word, i) => {
    if (word === right[i]) return word;
    const [, open, , close] = word.match(SPLIT);
    return `${open}N${close}`;
  }).join(' ');
}

function fixFor(rule) {
  try {
    return rule.fix(CONTEXT);
  } catch {
    return { html: null, laravel: null };
  }
}

const groups = [
  ['Core HTML', (c) => /title|description|canonical|favicon|viewport|lang/u.test(c) && !c.startsWith('og_') && !c.includes('twitter')],
  ['Open Graph', (c) => c.includes('og_')],
  ['Twitter Cards', (c) => c.includes('twitter')],
  ['Images', (c) => c.startsWith('image_')],
  ['Consistency and URLs', () => true],
];

const seen = new Set();
let body = '';

for (const [heading, matches] of groups) {
  const rules = RULES.filter((r) => !seen.has(r.code) && matches(r.code));
  if (rules.length === 0) continue;
  rules.forEach((r) => seen.add(r.code));

  body += `\n## ${heading}\n\n`;
  for (const rule of rules) {
    const text = describe(rule);
    const fix = fixFor(rule);

    body += `### \`${rule.code}\`\n\n`;
    body += `**${rule.title}** — ${rule.severity}, ${rule.importance}`;
    body += rule.weight > 0 ? `, costs ${rule.weight} points.\n\n` : ', no score impact.\n\n';
    if (text) body += `${escape(text)}\n\n`;

    if (fix.html) {
      body += '```html\n' + fix.html + '\n```\n\n';
      if (fix.laravel) body += `Laravel: \`${fix.laravel}\`\n\n`;
    } else {
      body += `<Note>No generic fix: this one depends on your own content, so \`fix\` is \`null\`.</Note>\n\n`;
    }
  }
}

const page = `---
title: "Issue codes"
description: "Every issue the checker can report, what it means, and how to fix it."
---

{/* GENERATED by scripts/issues.mjs from the checker's own rule table. Do not hand-edit. */}

The checker reports ${RULES.length} distinct issues. Each carries a stable \`code\`, a \`severity\`, an \`importance\`, and — where a generic fix is possible — a snippet you can paste.

<Note>
  **Issue codes are a public contract.** New codes get added; existing ones are not renamed or removed without a deprecation. Branch on \`code\`, never on \`title\` or \`description\`, which are prose and may be reworded.
</Note>

## Severity

| Severity | Meaning |
| :--- | :--- |
${Object.entries(SEVERITY_NOTE).map(([k, v]) => `| \`${k}\` | ${v} |`).join('\n')}

## Importance

\`required\` tags every page needs, \`recommended\` tags most pages benefit from, \`optional\` refinements. Importance is about the tag; severity is about your page.

## Score weight

Only some issues move the score, and they move it by different amounts — a missing \`og:image\` costs more than a missing \`og:locale\` because one of them decides whether anybody clicks. Issues listed below as "no score impact" are advice, not deductions.
${body}`;

writeFileSync(resolve(here, '../guides/issues.mdx'), page);
console.log(`wrote guides/issues.mdx — ${RULES.length} codes, ${seen.size} documented`);
