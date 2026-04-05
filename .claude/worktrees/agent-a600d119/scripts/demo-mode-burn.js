/**
 * Demo Mode (Burn Page) — Paste into browser DevTools console
 * Refresh the page to restore real data.
 */
(() => {
  const FAKE_NAMES = [
    'Alex Chen', 'Jordan Rivera', 'Sam Nakamura', 'Taylor Brooks',
    'Morgan Walsh', 'Casey Kim', 'Riley Patel', 'Drew Martinez',
    'Jamie Sullivan', 'Quinn Anderson', 'Avery Thompson', 'Blake Nguyen',
    'Reese Campbell', 'Dakota Ellis', 'Sage Harrison', 'Rowan Mitchell',
  ];

  // ── 1. BurnGrid — replace employee names ─────────────────────────
  // Names are in the first <td> of each row (sticky left column)
  const rows = document.querySelectorAll('tbody tr');
  rows.forEach((row, i) => {
    const nameCell = row.querySelector('td:first-child');
    if (nameCell && nameCell.textContent.trim().length > 1) {
      nameCell.textContent = FAKE_NAMES[i % FAKE_NAMES.length];
    }
  });

  // ── 2. BurnGrid — randomize hour values ──────────────────────────
  // Hour cells are all the td's after the first one in each row
  rows.forEach(row => {
    const cells = row.querySelectorAll('td:not(:first-child)');
    cells.forEach(cell => {
      const t = cell.textContent.trim();
      if (t === '—' || t === '') return; // skip empty days
      const num = parseFloat(t);
      if (!isNaN(num) && num > 0) {
        // Randomize within a realistic daily range (4-10 hours)
        const fake = (4 + Math.random() * 6).toFixed(1);
        cell.textContent = fake;
      }
    });
  });

  // ── 3. Resource Utilization chart — boost Y-axis labels ──────────
  // The chart Y-axis shows "Xh" values. Multiply to make utilization look healthy.
  document.querySelectorAll('h2').forEach(heading => {
    if (heading.textContent.trim() !== 'Resource Utilization') return;
    const card = heading.closest('[class*="border"]') || heading.parentElement;
    if (!card) return;
    card.querySelectorAll('tspan').forEach(el => {
      const t = el.textContent.trim();
      // Match "48h" style Y-axis ticks
      const m = t.match(/^(\d+)h$/);
      if (m) {
        const num = parseInt(m[1], 10);
        const boosted = Math.round(num * 1.3);
        el.textContent = boosted + 'h';
      }
    });
  });

  // ── Done ─────────────────────────────────────────────────────────
  console.log('%c Demo mode (Burn) activated! ', 'background: #E50A73; color: white; font-size: 14px; padding: 4px 8px; border-radius: 4px;');
  console.log('Replaced', rows.length, 'employee rows. Refresh to restore real data.');
})();
