// Generate portal wrappers from plain READMEs using project-owned metadata.
import { portalReadmeSource } from './readme-portal-source.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, posix } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const outputIndex = process.argv.indexOf('--output-dir');
if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw Error('Missing --output-dir destination');
const outputRoot = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : root;
const entries = JSON.parse(readFileSync(resolve(root, 'readme-landings.json'), 'utf8'));
const mapping = new Map(entries.map(item => [item.source, item.output]));
for (const item of entries) {
 const source = readFileSync(resolve(root, item.source), 'utf8');
 if (source.startsWith('---')) throw Error('README must be plain Markdown: ' + item.source);
 // GitHub README language links are not portal translations; the portal owns its locale navigation.
 const introduction = portalReadmeSource(source);
 const body = introduction.replace(/(!?\[[^\]]*\]\()([^\s)]+)(\))/g, (all, prefix, target, suffix) => {
  if (/^(?:https?:|mailto:|#)/i.test(target)) return all;
  const [file, fragment] = target.split('#');
  const canonical = posix.normalize(posix.join(posix.dirname(item.source), file));
  return prefix + posix.relative(posix.dirname(item.output), mapping.get(canonical) ?? canonical) + (fragment ? '#' + fragment : '') + suffix;
 });
 const front = ['---', ...['title', 'description'].map(key => key + ': ' + JSON.stringify(item[key])), 'sidebar:', '  order: ' + item.order, ...['archetype', 'project', 'tags'].map(key => key + ': ' + JSON.stringify(item[key])), '---', '', '<!-- Generated from ' + item.source + '; edit the README and run docs:readmes:prepare. -->', ''].join('\n');
 const output = resolve(outputRoot, item.output);
 mkdirSync(dirname(output), { recursive: true });
 writeFileSync(output, front + '\n' + body);
}
console.log('Generated README metadata wrappers:', entries.length);
