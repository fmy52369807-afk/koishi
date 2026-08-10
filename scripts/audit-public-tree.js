const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const patterns = [
  ['GitHub personal token', /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/],
  ['OpenAI-style secret', /sk-[A-Za-z0-9]{20,}/],
  ['Google API key', /AIza[A-Za-z0-9_-]{20,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['inline quoted credential assignment', /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_./=-]{24,}["']/i],
];

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter(file => !file.startsWith('.yarn/'))
  .filter(file => file !== '.env.example');

const findings = [];
for (const file of files) {
  const stat = fs.statSync(file);
  if (stat.size > 1024 * 1024) continue;
  const content = fs.readFileSync(file, 'utf8');
  for (const [name, pattern] of patterns) {
    if (pattern.test(content)) findings.push({ file, name });
  }
}

if (findings.length) {
  for (const finding of findings) console.error(`${finding.file}: ${finding.name}`);
  process.exitCode = 1;
} else {
  console.log(`Public-tree secret audit passed for ${files.length} publishable files.`);
}
