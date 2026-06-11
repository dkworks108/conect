const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('client bundle files are present', () => {
  const clientDir = path.join(__dirname, '..', 'client');
  const files = [
    'index.html',
    'manifest.json',
    'service-worker.js',
    'install.js',
    'js/app.js',
    'js/chat.js',
    'js/socket.js',
    'js/storage.js',
    'js/profile.js',
    'js/webrtc.js',
    'js/audio.js',
    'js/gps.js',
    'js/utils.js',
    'js/ui.js',
    'css/main.css',
    'css/themes.css',
    'css/animations.css',
    'css/responsive.css',
    'css/components.css'
  ];

  for (const relativePath of files) {
    assert.equal(fs.existsSync(path.join(clientDir, relativePath)), true, `${relativePath} missing`);
  }
});

test('client shell references core scripts and assets', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'client', 'index.html'), 'utf8');
  assert.match(indexHtml, /<script src="\/js\/app\.js"><\/script>/);
  assert.match(indexHtml, /<link rel="manifest" href="\/manifest\.json">/);
  assert.match(indexHtml, /favicon\.svg/);
});
