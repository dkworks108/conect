const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
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

test('server starts and serves health/info endpoints', async (t) => {
  const { child, ready } = startServer();
  t.after(() => {
    if (!child.killed) child.kill('SIGTERM');
  });

  await ready;
  const health = await fetch('http://127.0.0.1:3000/api/health');
  const info = await fetch('http://127.0.0.1:3000/api/info');

  assert.equal(health.ok, true);
  assert.equal(info.ok, true);

  const healthJson = await health.json();
  const infoJson = await info.json();

  assert.equal(healthJson.status, 'ok');
  assert.ok(Array.isArray(infoJson.rooms));
  assert.equal(infoJson.version, '2.0.0');
});
