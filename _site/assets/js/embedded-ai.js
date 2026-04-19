document.addEventListener('DOMContentLoaded', () => {
  const STEP = 10;
  const buttons = document.querySelectorAll('.embedded-ai-show-more-btn');

  buttons.forEach((button) => {
    const section = button.closest('.embedded-ai-category');
    if (!section) return;

    const items = Array.from(section.querySelectorAll('.embedded-ai-paper-item'));
    let visibleCount = items.filter((item) => !item.classList.contains('is-hidden')).length;

    function syncButton() {
      const hiddenCount = items.length - visibleCount;
      if (hiddenCount <= 0) {
        button.style.display = 'none';
      } else {
        button.style.display = '';
        button.textContent = `Show more (${Math.min(STEP, hiddenCount)})`;
      }
    }

    items.forEach((item, index) => {
      item.style.display = index < visibleCount ? 'block' : 'none';
    });

    syncButton();

    button.addEventListener('click', () => {
      const nextVisibleCount = Math.min(visibleCount + STEP, items.length);

      for (let i = visibleCount; i < nextVisibleCount; i += 1) {
        items[i].style.display = 'block';
      }

      visibleCount = nextVisibleCount;
      syncButton();
    });
  });
});