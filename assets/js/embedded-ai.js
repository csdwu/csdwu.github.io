document.addEventListener('DOMContentLoaded', () => {
  console.log('Embedded AI JS loaded');
  const STEP = 10;
  const buttons = document.querySelectorAll('.embedded-ai-show-more-btn');
  console.log('Found buttons:', buttons.length);

  buttons.forEach((button, btnIndex) => {
    console.log('Setting up button', btnIndex);
    const section = button.closest('.embedded-ai-category');
    if (!section) {
      console.error('No section found for button', btnIndex);
      return;
    }

    const items = Array.from(section.querySelectorAll('.embedded-ai-paper-item'));
    console.log('Found items:', items.length);
    let visibleCount = items.filter((item) => !item.classList.contains('is-hidden')).length;
    console.log('Initial visible count:', visibleCount);

    function syncButton() {
      const hiddenCount = items.length - visibleCount;
      if (hiddenCount <= 0) {
        button.style.display = 'none';
      } else {
        button.style.display = '';
        button.textContent = `Show more (${Math.min(STEP, hiddenCount)})`;
      }
    }

    syncButton();

    button.addEventListener('click', () => {
      console.log('Button clicked');
      const nextVisibleCount = Math.min(visibleCount + STEP, items.length);
      console.log('Showing from', visibleCount, 'to', nextVisibleCount);

      for (let i = visibleCount; i < nextVisibleCount; i += 1) {
        console.log('Removing is-hidden from item', i);
        items[i].classList.remove('is-hidden');
      }

      visibleCount = nextVisibleCount;
      syncButton();
    });
  });
});