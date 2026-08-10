const { execFileSync } = require('node:child_process');
const path = require('node:path');

const files = execFileSync('git', ['ls-files', '*.js'], { encoding: 'utf8' })
  .split('\n')
  .map(file => file.trim())
  .filter(Boolean)
  .filter(file => !file.startsWith('.yarn/'));

for (const file of files) {
  execFileSync(process.execPath, ['--check', path.resolve(file)], { stdio: 'inherit' });
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
