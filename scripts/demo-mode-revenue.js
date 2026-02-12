/**
 * Demo Mode (Revenue Page) — Paste into browser DevTools console
 * Refresh the page to restore real data.
 */
(() => {
  const FAKE_CLIENTS = [
    'Meridian Corp', 'Zenith Industries', 'Pinnacle Tech',
    'Cascade Group', 'Elevate Solutions', 'NovaBridge LLC',
    'Horizon Partners', 'Summit Digital', 'Atlas Ventures',
  ];

  const FAKE_PROJECTS = [
    'Platform Redesign', 'API Integration', 'Mobile App v2.0',
    'Data Migration', 'Cloud Infrastructure', 'Security Audit',
    'Analytics Dashboard', 'Payment Gateway', 'User Portal',
    'DevOps Pipeline', 'CRM Enhancement', 'Reporting Engine',
    'SSO Implementation', 'Performance Tuning', 'Brand Refresh',
    'Inventory System', 'Notification Service', 'Search Engine',
  ];

  const FAKE_TASKS = [
    'Backend Development', 'Frontend Implementation', 'Code Review',
    'Testing & QA', 'Database Optimization', 'Architecture Planning',
    'Bug Fixes', 'Documentation', 'Deployment Setup',
    'Performance Tuning', 'UI/UX Polish', 'API Design',
    'Data Modeling', 'Integration Testing', 'Security Hardening',
    'Schema Migration', 'Component Library', 'Monitoring Setup',
    'Load Testing', 'Accessibility Audit', 'Cache Layer',
  ];

  const FAKE_RATES = [85, 95, 110, 125, 135, 150, 165, 175];

  let clientIdx = 0, projectIdx = 0, taskIdx = 0;

  // ── 1. "The B Team" → "Acme Co." ──────────────────────────────
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

  // ── 2. Page header revenue totals ──────────────────────────────
  document.querySelectorAll('.text-lg.font-semibold').forEach(el => {
    const t = el.textContent.trim();
    if (/^\$[\d,]+\.\d{2}$/.test(t)) {
      const fake = 45000 + Math.random() * 55000;
      el.textContent = '$' + fake.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  });

  // ── Helper: randomize a dollar amount by magnitude ─────────────
  function fakeDollars(original) {
    if (original < 5) return original; // skip tiny/zero
    // Randomize within 50%-150% of original, minimum $50
    const fake = Math.max(50, original * (0.5 + Math.random()));
    return '$' + fake.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ── Helper: randomize HH:MM hours by magnitude ────────────────
  function fakeHoursHHMM(original) {
    const factor = 0.5 + Math.random();
    const totalMin = Math.max(15, Math.round(original * factor));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h + ':' + m.toString().padStart(2, '0');
  }

  // ── Helper: randomize decimal hours by magnitude ───────────────
  function fakeHoursDecimal(original) {
    const factor = 0.5 + Math.random();
    return Math.max(0.25, original * factor).toFixed(2);
  }

  // ── Helper: replace numeric cells in a row ─────────────────────
  function replaceCells(cells) {
    // Skip first cell (name column), process the rest
    for (let i = 1; i < cells.length; i++) {
      const td = cells[i];
      // Some cells have nested spans, some don't
      const spans = td.querySelectorAll('span');
      const targets = spans.length > 0 ? spans : [td];

      targets.forEach(span => {
        const text = span.textContent.trim();
        if (!text || text === '—' || text === 'Total') return;

        // Skip badges (MIN, MAX, +C/O)
        if (/^(MIN|MAX|\+C\/O)$/.test(text)) return;

        // Skip rounding values (e.g. "15m", "30m")
        if (/^\d+m$/.test(text)) return;

        // Skip transaction type labels (plain text like "Fixed Fee", "Retainer")
        // These don't start with $ and don't look like numbers
        if (!/^[\d$]/.test(text) && !text.startsWith('Revenue Milestone')) return;

        // Revenue Milestone text (e.g. "Revenue Milestone $5,000.00")
        if (text.startsWith('Revenue Milestone')) {
          const fakeMilestone = 5000 + Math.random() * 20000;
          span.textContent = 'Revenue Milestone $' + fakeMilestone.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return;
        }

        // Currency (e.g. "$1,234.56" or "$85.00")
        const dollarMatch = text.match(/^\$([\d,]+\.\d{2})$/);
        if (dollarMatch) {
          const num = parseFloat(dollarMatch[1].replace(/,/g, ''));
          span.textContent = fakeDollars(num);
          return;
        }

        // HH:MM hours (e.g. "123:45")
        const hhmmMatch = text.match(/^(\d+):(\d{2})$/);
        if (hhmmMatch) {
          const totalMin = parseInt(hhmmMatch[1]) * 60 + parseInt(hhmmMatch[2]);
          span.textContent = fakeHoursHHMM(totalMin);
          return;
        }

        // Decimal hours (e.g. "45.50")
        const decMatch = text.match(/^(\d+\.\d{2})$/);
        if (decMatch) {
          const num = parseFloat(decMatch[1]);
          span.textContent = fakeHoursDecimal(num);
          return;
        }
      });
    }
  }

  // ── 3. Revenue table body rows ─────────────────────────────────
  const tbody = document.querySelector('tbody');
  if (!tbody) { console.warn('No tbody found'); return; }

  tbody.querySelectorAll('tr').forEach(row => {
    const firstTd = row.querySelector('td:first-child');
    if (!firstTd) return;

    const isCompany = row.classList.contains('bg-vercel-gray-50');
    const isTask = firstTd.classList.contains('pl-16');
    const isProject = !isCompany && !isTask && firstTd.classList.contains('pl-10');

    if (isCompany) {
      // Company name — the bold span inside the first td
      const nameSpan = firstTd.querySelector('.font-semibold');
      if (nameSpan) {
        nameSpan.textContent = FAKE_CLIENTS[clientIdx % FAKE_CLIENTS.length];
        clientIdx++;
      }
    } else if (isProject) {
      // Project/Billing name — the text span (not the chevron SVG)
      const nameSpan = firstTd.querySelector('span.text-sm');
      if (nameSpan) {
        nameSpan.textContent = FAKE_PROJECTS[projectIdx % FAKE_PROJECTS.length];
        projectIdx++;
      }
    } else if (isTask) {
      // Task/Transaction name
      const nameSpan = firstTd.querySelector('span');
      if (nameSpan) {
        nameSpan.textContent = FAKE_TASKS[taskIdx % FAKE_TASKS.length];
        taskIdx++;
      }
    }

    // Replace all numeric cells in the row
    replaceCells(row.querySelectorAll('td'));
  });

  // ── 4. Footer totals ──────────────────────────────────────────
  const tfoot = document.querySelector('tfoot');
  if (tfoot) {
    replaceCells(tfoot.querySelectorAll('td'));
  }

  // ── Done ───────────────────────────────────────────────────────
  console.log('%c Demo mode (Revenue) activated! ', 'background: #E50A73; color: white; font-size: 14px; padding: 4px 8px; border-radius: 4px;');
  console.log('Replaced', clientIdx, 'clients,', projectIdx, 'projects,', taskIdx, 'tasks. Refresh to restore real data.');
})();
