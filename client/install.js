/**
 * Connect - PWA Installation Prompt Manager
 */
let deferredPrompt = null;
const installBtn = document.getElementById('install-btn');

function showInstallButton(show) {
  if (installBtn) {
    installBtn.style.display = show ? 'flex' : 'none';
    installBtn.setAttribute('aria-hidden', show ? 'false' : 'true');
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallButton(true);
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    installBtn.disabled = true;
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to the install prompt: ${outcome}`);
    } finally {
      installBtn.disabled = false;
    deferredPrompt = null;
      showInstallButton(false);
    }
  });
}

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  showInstallButton(false);
  console.log('Connect App was installed.');
});

window.addEventListener('load', () => {
  if (!deferredPrompt) showInstallButton(false);
});
