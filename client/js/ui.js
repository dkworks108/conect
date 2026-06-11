/**
 * Connect — UI Helpers
 * Shared DOM helpers and lightweight accessibility utilities.
 */
class ConnectUI {
  static show(element) {
    if (element) element.classList.remove('hidden');
  }

  static hide(element) {
    if (element) element.classList.add('hidden');
  }

  static setText(selector, text) {
    const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (element) element.textContent = text;
  }

  static announce(message) {
    let region = document.getElementById('aria-live-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'aria-live-region';
      region.setAttribute('aria-live', 'polite');
      region.setAttribute('aria-atomic', 'true');
      region.className = 'sr-only';
      document.body.appendChild(region);
    }
    region.textContent = '';
    window.setTimeout(() => {
      region.textContent = String(message ?? '');
    }, 10);
  }

  static createToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${ConnectUtils.escapeHTML(message)}</span>`;
    container.appendChild(toast);
    window.setTimeout(() => toast.classList.add('show'), 10);
    window.setTimeout(() => {
      toast.classList.remove('show');
      window.setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}

window.ConnectUI = ConnectUI;
