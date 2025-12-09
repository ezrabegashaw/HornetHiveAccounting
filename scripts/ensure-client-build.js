// scripts/ensure-client-build.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const clientDir = path.join(__dirname, '..', 'client');
const packageJsonPath = path.join(clientDir, 'package.json');

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

if (!fs.existsSync(clientDir) || !fs.existsSync(packageJsonPath)) {
  console.log('No client/ folder or client/package.json found — skipping client build.');
  process.exit(0);
}

const clientPkg = require(packageJsonPath);
if (!clientPkg.scripts || !clientPkg.scripts.build) {
  console.log('client/package.json found but no "build" script — skipping client build.');
  process.exit(0);
}

try {
  console.log('Building client...');
  run('npm ci', { cwd: clientDir });
  run('npm run build', { cwd: clientDir });
  console.log('Client build complete.');
} catch (err) {
  console.error('Client build failed:', err);
  process.exit(1);
}
