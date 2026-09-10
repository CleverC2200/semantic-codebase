import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error standalone reader projection
import { createReaderCapabilityModel } from '../../scripts/semantic-reader-capabilities.mjs';

function fixture(snapshot = 's1') {
  return { repository: 'repo', snapshot, files: [{ path: 'a.ts', verified: true, source_digest: 'hash' }],
    definitions: [{ definition_key: 'run' }, { definition_key: 'shared' }, { definition_key: 'unknown' }], mainlines: [{ id: 'create', available: true, stages: [{ keys: ['run'] }] }],
    capabilityCandidates: [
      { id: 'system', kind: 'system', title: '系统', parent: null, source_digests: { 'a.ts': 'hash' } },
      { id: 'users', kind: 'feature', title: '用户管理', parent: 'system', mainlines: ['create'], uses: ['audit'], source_digests: { 'a.ts': 'hash' } },
      { id: 'audit', kind: 'feature', title: '审计', parent: 'system', definitions: ['shared'], source_digests: { 'a.ts': 'hash' } },
    ] };
}

test('capability navigation separates hierarchy and shared use without losing unassigned definitions', () => {
  const m = createReaderCapabilityModel(fixture());
  assert.deepEqual(m.get('users').uses, ['audit']);
  assert.deepEqual(m.children('users'), []);
  assert.deepEqual(m.members('users'), ['run']);
  assert.deepEqual(m.members('system'), ['run', 'shared']);
  assert.deepEqual(m.unassigned(), ['unknown']);
  assert.equal(m.get('users').status, 'candidate');
  assert.deepEqual(m.ancestors('users').map((x: { id: string }) => x.id), ['system']);
});

test('stale module sources return their definitions to unassigned rather than retaining candidate coverage', () => {
  const data = fixture();
  data.files[0].source_digest = 'changed';
  const m = createReaderCapabilityModel(data);
  assert.deepEqual(m.members('system'), []);
  assert.deepEqual(m.unassigned().sort(), ['run', 'shared', 'unknown']);
  assert.equal(m.get('audit').available, false);
});

import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('human mapping decisions survive storage readback, reject cycles, and become stale across snapshots', () => {
  const directory = mkdtempSync(join(tmpdir(), 'reader-decisions-')), file = join(directory, 'decisions.json');
  const storage = { getItem: () => existsSync(file) ? readFileSync(file, 'utf8') : null, setItem: (_key: string, value: string) => writeFileSync(file, value) };
  try {
    let model = createReaderCapabilityModel(fixture(), { storage });
    model.decide({ id: 'users', action: 'confirm', parent: 'audit', actor: 'reviewer', reason: '已核对业务归属', expected_version: 0 });
    model = createReaderCapabilityModel(fixture(), { storage });
    assert.equal(model.get('users').status, 'confirmed');
    assert.equal(model.get('users').parent, 'audit');
    assert.equal(model.history('users')[0].actor, 'reviewer');
    assert.throws(() => model.decide({ id: 'audit', action: 'confirm', parent: 'users', actor: 'reviewer', reason: 'cycle', expected_version: 0 }), /HIERARCHY/);
    assert.throws(() => model.decide({ id: 'users', action: 'confirm', parent: 'system', actor: 'reviewer', reason: 'stale write', expected_version: 0 }), /VERSION_CONFLICT/);
    const changed = fixture('s2');
    const stale = createReaderCapabilityModel(changed, { storage });
    assert.equal(stale.get('users').status, 'needs_review');
    assert.equal(stale.get('users').parent, 'system');
    assert.equal(stale.history('users').length, 1);
    stale.decide({ id: 'users', action: 'revoke', actor: 'reviewer', reason: '撤销旧归属', expected_version: 1 });
    assert.equal(createReaderCapabilityModel(changed, { storage }).get('users').status, 'candidate');
    assert.equal(createReaderCapabilityModel(changed, { storage }).history('users').length, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
