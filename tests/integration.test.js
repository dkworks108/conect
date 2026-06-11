const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', 'server'),
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start in time')), 15000);
    const onData = (chunk) => {
      const text = chunk.toString();
      if (text.includes('Waiting for connections')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return { child, ready };
}

test('serves the app shell and manifest over HTTP', async (t) => {
  const { child, ready } = startServer();
  t.after(() => {
    if (!child.killed) child.kill('SIGTERM');
  });

  await ready;
  const [indexRes, manifestRes] = await Promise.all([
    fetch('http://127.0.0.1:3000/index.html'),
    fetch('http://127.0.0.1:3000/manifest.json')
  ]);

  assert.equal(indexRes.ok, true);
  assert.equal(manifestRes.ok, true);

  const indexHtml = await indexRes.text();
  const manifest = await manifestRes.json();

  assert.match(indexHtml, /Connect/);
  assert.equal(manifest.short_name, 'Connect');
});
