const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WorkspaceService } = require('../src/workspace-service');
const { validateToolRequest } = require('../src/server');

function createWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-mcp-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, service: new WorkspaceService(root) };
}

test('writes, appends, lists, and reads workspace files', (t) => {
  const { service } = createWorkspace(t);
  service.writeFile({ path: 'src/note.txt', content: 'first\nsecond' });
  service.writeFile({ path: 'src/note.txt', content: '\nthird', append: true });

  assert.deepEqual(service.listDirectory({ path: 'src' }).map((entry) => entry.name), ['note.txt']);
  assert.deepEqual(service.readFile({ path: 'src/note.txt', start: 1, end: 3 }), {
    path: 'src/note.txt',
    content: 'second\nthird',
    lines: 2,
    totalLines: 3,
  });
  assert.equal(service.searchFiles({ path: '.', query: 'second', extension: '.txt' }).length, 1);
});

test('rejects invalid input and parent traversal', (t) => {
  const { service } = createWorkspace(t);

  assert.throws(() => service.readFile({ path: '../outside.txt' }), /parent-directory/);
  assert.throws(() => service.readFile({ path: 'missing.txt', start: 2.5 }), /start must be an integer/);
  assert.throws(() => service.readFile({ path: 'missing.txt', start: 3, end: 1 }), /end must be greater/);
  assert.throws(() => service.searchFiles({ query: '  ' }), /must not be empty/);
  assert.throws(() => service.writeFile({ path: 'note.txt', content: 'x', append: 'yes' }), /append must be a boolean/);
  assert.throws(() => service.listDirectory({ path: '.', extra: true }), /Unknown arguments field/);
});

test('does not follow symbolic links outside the workspace', (t) => {
  const { root, service } = createWorkspace(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-mcp-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const outsideFile = path.join(outside, 'secret.txt');
  fs.writeFileSync(outsideFile, 'private');

  try {
    fs.symlinkSync(outside, path.join(root, 'linked'), 'junction');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip('Symbolic links are not available in this environment.');
      return;
    }
    throw error;
  }

  assert.throws(() => service.readFile({ path: 'linked/secret.txt' }), /Symbolic links are not allowed/);
  assert.throws(() => service.writeFile({ path: 'linked/new.txt', content: 'no' }), /Symbolic links are not allowed/);
});

test('rejects unknown MCP tool arguments', () => {
  assert.throws(() => validateToolRequest('read_file', { path: 'file.txt', unexpected: true }), /Unknown arguments field/);
  assert.throws(() => validateToolRequest('unknown', {}), /Unknown tool/);
});
