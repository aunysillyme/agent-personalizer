const status = document.getElementById('copy-status');

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const code = document.getElementById(button.dataset.copy);
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.textContent);
      if (status) status.textContent = status.dataset.success;
    } catch {
      if (status) status.textContent = status.dataset.fallback;
    }
  });
}

for (const button of document.querySelectorAll('[data-task]')) {
  button.addEventListener('click', () => {
    for (const tab of document.querySelectorAll('[data-task]')) tab.setAttribute('aria-pressed', String(tab === button));
    for (const node of document.querySelectorAll('[data-role]')) node.classList.toggle('selected', node.dataset.role === button.dataset.task);
    document.getElementById('task-text').textContent = button.dataset.caption;
  });
}

for (const link of document.querySelectorAll('.mobile-nav a')) {
  link.addEventListener('click', () => { link.closest('details').open = false; });
}
