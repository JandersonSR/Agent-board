// Git e GitHub (gh) para o servidor: diff da sessão, status do PR e criação de PR.
const { execFile } = require('child_process');

function run(cmd, args, cwd, timeout = 8000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) { err.stderr = String(stderr || '').trim(); return reject(err); }
      resolve(String(stdout));
    });
  });
}
const git = (cwd, ...args) => run('git', args, cwd);
const tryGit = (cwd, ...args) => git(cwd, ...args).then(s => s.trim(), () => null);

// Base de comparação: o ponto onde a branch saiu da principal. Assim o diff mostra
// commits da sessão + mudanças ainda não commitadas.
async function baseOf(cwd) {
  const head = await tryGit(cwd, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD');
  const candidates = [head, 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean);
  for (const ref of candidates) {
    const mb = await tryGit(cwd, 'merge-base', 'HEAD', ref);
    if (mb) return { ref, sha: mb };
  }
  return { ref: 'HEAD', sha: 'HEAD' };
}

async function diffSummary(cwd) {
  if (!(await tryGit(cwd, 'rev-parse', '--is-inside-work-tree'))) return null;
  const base = await baseOf(cwd);
  const [numstat, untracked, ahead] = await Promise.all([
    tryGit(cwd, 'diff', '--numstat', base.sha),
    tryGit(cwd, 'ls-files', '--others', '--exclude-standard'),
    base.sha === 'HEAD' ? '0' : tryGit(cwd, 'rev-list', '--count', `${base.sha}..HEAD`),
  ]);
  const files = (numstat || '').split('\n').filter(Boolean).map(l => {
    const [add, del, ...p] = l.split('\t');
    return { path: p.join('\t'), add: add === '-' ? null : +add, del: del === '-' ? null : +del };
  });
  return {
    base: base.ref,
    commits: Number(ahead) || 0,
    files,
    untracked: (untracked || '').split('\n').filter(Boolean).slice(0, 200),
    add: files.reduce((n, f) => n + (f.add || 0), 0),
    del: files.reduce((n, f) => n + (f.del || 0), 0),
  };
}

const PATCH_LIMIT = 400 * 1024;
async function diffPatch(cwd, file) {
  const base = await baseOf(cwd);
  const args = ['diff', '--no-color', base.sha];
  if (file) args.push('--', file);
  const out = await git(cwd, ...args);
  return out.length > PATCH_LIMIT ? out.slice(0, PATCH_LIMIT) + '\n… (diff cortado)' : out;
}

// Resume os checks do PR em pass/fail/pending.
function summarizeChecks(rollup = []) {
  const c = { pass: 0, fail: 0, pending: 0 };
  for (const r of rollup) {
    const v = (r.conclusion || r.state || r.status || '').toUpperCase();
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(v)) c.pass++;
    else if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(v)) c.fail++;
    else c.pending++;
  }
  return c;
}

async function prStatus(cwd) {
  try {
    const out = await run('gh', ['pr', 'view', '--json',
      'number,title,url,state,isDraft,reviewDecision,statusCheckRollup,mergeStateStatus'], cwd, 15000);
    const pr = JSON.parse(out);
    return {
      number: pr.number, title: pr.title, url: pr.url, state: pr.state, draft: pr.isDraft,
      review: pr.reviewDecision || null, merge: pr.mergeStateStatus || null,
      checks: summarizeChecks(pr.statusCheckRollup),
    };
  } catch (e) {
    if (/no pull requests found/i.test(e.stderr || '')) return { none: true };
    return { error: (e.stderr || e.message || 'gh falhou').split('\n')[0] };
  }
}

const PROTECTED = /^(main|master|develop|production.*)$/;
async function createPr(cwd) {
  const branch = await tryGit(cwd, 'branch', '--show-current');
  if (!branch) throw new Error('HEAD destacado: não há branch para abrir PR');
  if (PROTECTED.test(branch)) throw new Error(`não abro PR a partir de "${branch}"`);
  await run('git', ['push', '-u', 'origin', 'HEAD'], cwd, 60000);
  const out = await run('gh', ['pr', 'create', '--fill', '--draft'], cwd, 60000);
  return out.trim().split('\n').pop();
}

module.exports = { run, diffSummary, diffPatch, prStatus, createPr, summarizeChecks };
