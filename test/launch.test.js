const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { prepareDir, validBranch } = require('../lib/launch');

test('nomes de branch válidos e inválidos', () => {
  assert.ok(validBranch('feat/FEAT-1-login'));
  for (const b of ['', '-x', 'a..b', 'a b', 'feat/', 'x;rm']) assert.ok(!validBranch(b), b);
});

test('cria worktree ao lado do repositório', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-launch-'));
  const repo = path.join(base, 'app');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');

  const dir = await prepareDir({ repo, branch: 'feat/FEAT-7-login', worktree: true });
  assert.equal(path.basename(dir), 'app-feat-7-login');
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: dir }).toString().trim(), 'feat/FEAT-7-login');
  await assert.rejects(prepareDir({ repo, branch: 'feat/FEAT-7-login', worktree: true }), /já existe/);
  await assert.rejects(prepareDir({ repo, branch: 'a..b', worktree: true }), /inválido/);
  await assert.rejects(prepareDir({ repo: path.join(base, 'nope'), worktree: false }), /não existe/);
  assert.equal(await prepareDir({ repo, worktree: false }), repo);
});
