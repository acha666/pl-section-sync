import { readFile, writeFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const tag = process.env.RELEASE_TAG;
if (tag !== `v${version}`) throw new Error('Tag must match package.json version.');
const changelog = await readFile('CHANGELOG.md', 'utf8');
const heading = new RegExp(
  `^## ${version.replaceAll('.', '\\.')} \\((\\d{4}-\\d{2}-\\d{2})\\)$`,
  'm',
);
const match = heading.exec(changelog);
if (!match) throw new Error('Missing dated changelog entry.');
const notes = changelog
  .slice(match.index + match[0].length)
  .split(/^## /m)[0]
  .trim();
if (!notes) throw new Error('Release notes are empty.');
await writeFile('release/notes.md', notes + '\n');
