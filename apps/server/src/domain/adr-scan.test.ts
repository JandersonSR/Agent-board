import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { reposToScan, scanRepoAdrs } from './adr-scan.js';

describe('scanRepoAdrs', () => {
  it('reads ADRs from the known folders and ignores README, links and other folders', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-'));
    const repo = path.join(root, 'api');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'docs/adr'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/adr/0001-kafka.md'), '# Usar Kafka\n\nStatus: aceito\n');
    fs.writeFileSync(path.join(repo, 'docs/adr/README.md'), '# Índice');
    fs.writeFileSync(path.join(repo, 'src/x.md'), '# Não é ADR');
    fs.writeFileSync(path.join(root, 'segredo.md'), '# fora');
    fs.symlinkSync(path.join(root, 'segredo.md'), path.join(repo, 'docs/adr/0002-link.md'));
    expect(scanRepoAdrs('api', repo)).toEqual([{ repo: 'api', path: 'docs/adr/0001-kafka.md', title: 'Usar Kafka', status: 'decided' }]);
    expect(reposToScan([], root).map(r => r.slug)).toEqual(['api']);
  });
});
