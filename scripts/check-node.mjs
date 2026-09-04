// Runs before every npm script (plain JavaScript so it works on any Node). The rest of the
// repo needs Node 22.18 or later: built-in TypeScript stripping loads bridge.config.ts, and
// the MCP SDK needs a modern runtime.
const REQUIRED = [22, 18];
const [major, minor] = process.versions.node.split('.').map(Number);
const ok = major > REQUIRED[0] || (major === REQUIRED[0] && minor >= REQUIRED[1]);

if (!ok) {
  const fix = process.env.NVM_DIR
    ? '  nvm install 22 && nvm use        (this repo has an .nvmrc)'
    : '  Install Node 22 LTS: https://nodejs.org/en/download  or  brew install node@22\n' +
      '  With nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash && nvm install 22';
  process.stderr.write(
    `\nThis project needs Node ${REQUIRED.join('.')} or later; you are running Node ${process.versions.node}.\n\n${fix}\n\n` +
      'Then run the command again. `npm run doctor` checks everything else you need.\n\n',
  );
  process.exit(1);
}
