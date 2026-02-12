/**
 * Demo Mode — Paste into browser DevTools console
 * Refresh the page to restore real data.
 */
(() => {
  // ── Fake Top 5 data (pre-sorted) ────────────────────────────────
  const TOP5_HOURS = [
    { name: 'Jordan Rivera',  hours: '168.5h', revenue: '$14,280.00' },
    { name: 'Sam Nakamura',   hours: '152.0h', revenue: '$12,160.00' },
    { name: 'Taylor Brooks',  hours: '143.5h', revenue: '$11,480.00' },
    { name: 'Casey Kim',      hours: '128.0h', revenue: '$9,600.00' },
    { name: 'Morgan Walsh',   hours: '112.5h', revenue: '$8,437.50' },
  ];

  const TOP5_REVENUE = [
    { name: 'Riley Patel',    hours: '134.0h', revenue: '$17,420.00' },
    { name: 'Jordan Rivera',  hours: '168.5h', revenue: '$14,280.00' },
    { name: 'Drew Martinez',  hours: '118.5h', revenue: '$13,035.00' },
    { name: 'Sam Nakamura',   hours: '152.0h', revenue: '$12,160.00' },
    { name: 'Taylor Brooks',  hours: '143.5h', revenue: '$11,480.00' },
  ];

  const PIE_NAMES = [
    'Jordan Rivera', 'Sam Nakamura', 'Taylor Brooks', 'Casey Kim',
    'Morgan Walsh', 'Riley Patel', 'Drew Martinez', 'Jamie Sullivan',
    'Quinn Anderson', 'Avery Thompson', 'Blake Nguyen', 'Reese Campbell',
  ];
  let pieIdx = 0;

  // ── 1. Greeting ──────────────────────────────────────────────────
  document.querySelectorAll('h1, h2').forEach(el => {
    for (const g of ['Good Morning', 'Good Afternoon', 'Good Evening', 'Good morning', 'Good afternoon', 'Good evening']) {
      if (el.textContent.includes(g)) {
        el.textContent = g + ', Alex Chen';
        break;
      }
    }
  });

  // ── 2. "The B Team" → "Acme Co." ────────────────────────────────
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) {
    if (node.textContent.includes('The B Team')) {
      node.textContent = node.textContent.replaceAll('The B Team', 'Acme Co.');
    }
    if (node.textContent.includes('the B Team')) {
      node.textContent = node.textContent.replaceAll('the B Team', 'Acme Co.');
    }
  }

  // ── 3. Top 5 By Hours ───────────────────────────────────────────
  document.querySelectorAll('h3').forEach(heading => {
    if (heading.textContent.trim() !== 'Top 5 By Hours') return;
    const card = heading.closest('[class*="border"]') || heading.parentElement;
    if (!card) return;
    const rows = card.querySelectorAll('.flex.items-center.justify-between');
    rows.forEach((row, i) => {
      if (i >= TOP5_HOURS.length) return;
      const d = TOP5_HOURS[i];
      // Name
      const nameEl = row.querySelector('.text-vercel-gray-600:not(.font-mono)');
      if (nameEl) nameEl.textContent = d.name;
      // Hours
      const hoursEl = row.querySelector('.text-vercel-gray-400.font-mono');
      if (hoursEl) hoursEl.textContent = d.hours;
      // Revenue
      const revenueEl = row.querySelector('.font-mono.w-20, .font-mono.text-right');
      if (revenueEl) revenueEl.textContent = d.revenue;
    });
  });

  // ── 4. Top 5 By Revenue ─────────────────────────────────────────
  document.querySelectorAll('h3').forEach(heading => {
    if (heading.textContent.trim() !== 'Top 5 By Revenue') return;
    const card = heading.closest('[class*="border"]') || heading.parentElement;
    if (!card) return;
    const rows = card.querySelectorAll('.flex.items-center.justify-between');
    rows.forEach((row, i) => {
      if (i >= TOP5_REVENUE.length) return;
      const d = TOP5_REVENUE[i];
      const nameEl = row.querySelector('.text-vercel-gray-600:not(.font-mono)');
      if (nameEl) nameEl.textContent = d.name;
      const hoursEl = row.querySelector('.text-vercel-gray-400.font-mono');
      if (hoursEl) hoursEl.textContent = d.hours;
      const revenueEl = row.querySelector('.font-mono.w-20, .font-mono.text-right');
      if (revenueEl) revenueEl.textContent = d.revenue;
    });
  });

  // ── 5. Hours by Resource — pie chart legend names ────────────────
  document.querySelectorAll('h3').forEach(heading => {
    if (heading.textContent.trim() !== 'Hours by Resource') return;
    const card = heading.closest('[class*="border"]') || heading.parentElement;
    if (!card) return;
    // Recharts legend text (rendered as spans)
    card.querySelectorAll('.recharts-legend-item-text').forEach(el => {
      el.textContent = PIE_NAMES[pieIdx % PIE_NAMES.length];
      pieIdx++;
    });
    // Also tspan inside SVG legend (Recharts duplicates text there)
    card.querySelectorAll('.recharts-legend-wrapper tspan').forEach(el => {
      const t = el.textContent.trim();
      if (t && t.length > 1 && !/^[\d$.,%-]+$/.test(t) && !/^(Hours|Other)$/.test(t)) {
        el.textContent = PIE_NAMES[pieIdx % PIE_NAMES.length];
        pieIdx++;
      }
    });
  });

  // ── 6. Revenue trend — multiply Y-axis dollar labels ─────────────
  document.querySelectorAll('h3').forEach(heading => {
    if (heading.textContent.trim() !== '12-Month Revenue Trend') return;
    const card = heading.closest('[class*="border"]') || heading.parentElement;
    if (!card) return;
    card.querySelectorAll('tspan').forEach(el => {
      const t = el.textContent.trim();
      const m = t.match(/^\$?([\d,]+)$/);
      if (m) {
        const num = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(num)) {
          const boosted = num * 1.4;
          el.textContent = '$' + boosted.toLocaleString('en-US', { maximumFractionDigits: 0 });
        }
      }
    });
  });

  // ── 7. CAGR chart — impressive growth numbers ───────────────────
  // Replace the CAGR percentage badge
  document.querySelectorAll('h3').forEach(heading => {
    if (heading.textContent.trim() !== 'Annual Revenue (CAGR)') return;
    const card = heading.closest('[class*="border"]') || heading.parentElement;
    if (!card) return;
    // The CAGR percentage (e.g. "CAGR: +18.2%")
    card.querySelectorAll('.text-success, .text-error').forEach(el => {
      const t = el.textContent.trim();
      if (t.includes('CAGR:')) {
        el.textContent = 'CAGR: +32.4%';
        el.classList.remove('text-error');
        el.classList.add('text-success');
      }
      // YoY growth rates at the bottom
      if (/^[+-]?\d+\.?\d*%$/.test(t)) {
        const fake = (20 + Math.random() * 25).toFixed(1);
        el.textContent = '+' + fake + '%';
        el.classList.remove('text-error');
        el.classList.add('text-success');
      }
    });
    // Y-axis dollar labels
    card.querySelectorAll('tspan').forEach(el => {
      const t = el.textContent.trim();
      const m = t.match(/^\$?([\d,]+)$/);
      if (m) {
        const num = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(num)) {
          const boosted = num * 1.6;
          el.textContent = '$' + boosted.toLocaleString('en-US', { maximumFractionDigits: 0 });
        }
      }
    });
  });

  // ── 8. MoM Growth Rate — make it positive ────────────────────────
  document.querySelectorAll('h3').forEach(heading => {
    if (heading.textContent.trim() !== 'MoM Growth Rate') return;
    const card = heading.closest('[class*="border"]') || heading.parentElement;
    if (!card) return;
    card.querySelectorAll('.text-success, .text-error').forEach(el => {
      const t = el.textContent.trim();
      if (t.includes('Avg:')) {
        el.textContent = 'Avg: +8.3%';
        el.classList.remove('text-error');
        el.classList.add('text-success');
      }
    });
  });

  // ── 9. Avatar initials ───────────────────────────────────────────
  document.querySelectorAll('[class*="rounded-full"]').forEach(el => {
    const t = el.textContent.trim();
    if (/^[A-Z]{1,2}$/.test(t) && el.children.length === 0) el.textContent = 'AC';
  });

  // ── Done ─────────────────────────────────────────────────────────
  console.log('%c Demo mode activated! ', 'background: #E50A73; color: white; font-size: 14px; padding: 4px 8px; border-radius: 4px;');
  console.log('Refresh to restore real data.');
})();
