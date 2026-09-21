/* The audience switch on /admin.

   Ops staff work across three sides of the business in one sitting: the care
   providers joining, the partner agencies signing up, and the families booking
   care. All three used to mean navigating to a different page. This turns the
   audience into a top-level switch: one shell, three panels, swapped in place.

   The provider panel is the original desk and keeps its own ids, so dashboard.js
   runs untouched. The other two are booking boards cloned from the template in
   index.html, created the first time they're opened — plain /admin never fetches
   booking chats it isn't showing.

   Loads after dashboard.js so the side's hero copy wins over the region copy
   dashboard.js sets on load. */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'pulso-admin-side';
  const DEFAULT_SIDE = 'provider';

  const SIDES = {
    provider: {
      eyebrow: 'Pulso Operations',
      title: 'Care Provider Verification Desk',
      subtitle: 'Review Meta ad leads, verify certificates, and unblock onboarding without leaving WhatsApp context.'
    },
    agency: {
      eyebrow: 'Pulso Partner Network',
      title: 'Partner Agency Desk',
      subtitle: 'Review agency registration documents, send terms, and track partner onboarding.',
      board: 'agency'
    },
    customer: {
      eyebrow: 'Pulso Customer Booking',
      title: 'Senior Care Booking Chats',
      subtitle: 'Review WhatsApp family booking conversations, booking details, test bookings, and completed request IDs.',
      board: 'customer'
    }
  };

  const switcher = document.getElementById('side-switch');
  const template = document.getElementById('booking-board-template');
  if (!switcher || !template) return;

  const eyebrow = document.getElementById('dashboard-eyebrow');
  const title = document.getElementById('dashboard-title');
  const subtitle = document.getElementById('dashboard-subtitle');
  const tabs = Array.from(switcher.querySelectorAll('[data-side]'));
  const boards = {};

  /* The region lives in the path (/admin/kerala), so the whole desk — every
     side of it — stays scoped to that region. */
  function regionFromPath() {
    const path = global.location.pathname.replace(/\/+$/, '').toLowerCase();
    if (path === '/admin/kerala') return 'kerala';
    if (path === '/admin/karnataka') return 'karnataka';
    return '';
  }

  const region = regionFromPath();

  function panelFor(side) {
    return document.getElementById(`side-${side}`);
  }

  function metricsFor(side) {
    return document.querySelector(`[data-side-metrics="${side}"]`);
  }

  /* A region desk names its region; titling every side "Care Provider
     Verification Desk" would be a lie on the agency and customer sides. */
  function titleFor(side) {
    const config = SIDES[side];
    if (!region) return config.title;
    const label = region.charAt(0).toUpperCase() + region.slice(1);
    if (side === 'provider') return `${label} provider verification desk`;
    if (side === 'agency') return `${label} partner agency desk`;
    return `${label} senior care booking chats`;
  }

  function ensureBoard(side) {
    const config = SIDES[side];
    if (!config.board || boards[side]) return;

    const panel = panelFor(side);
    if (!panel || !global.PulsoBookingBoard) return;

    panel.append(template.content.cloneNode(true));
    const board = global.PulsoBookingBoard.create({
      root: panel,
      metricsRoot: metricsFor(side),
      mode: config.board,
      region
    });
    boards[side] = board;
    board.refresh();
  }

  function showSide(side, options) {
    const config = SIDES[side];
    if (!config) return;

    if (eyebrow) eyebrow.textContent = config.eyebrow;
    if (title) title.textContent = titleFor(side);
    if (subtitle) subtitle.textContent = config.subtitle;

    tabs.forEach((tab) => {
      const selected = tab.dataset.side === side;
      tab.setAttribute('aria-selected', String(selected));
      tab.classList.toggle('active', selected);
    });

    Object.keys(SIDES).forEach((name) => {
      const panel = panelFor(name);
      if (panel) panel.hidden = name !== side;
      const metrics = metricsFor(name);
      if (metrics) metrics.hidden = name !== side;
    });

    ensureBoard(side);

    if (!options || options.push !== false) {
      rememberSide(side);
    }
  }

  function rememberSide(side) {
    try {
      global.localStorage.setItem(STORAGE_KEY, side);
    } catch (error) {
      // Private browsing or blocked storage; the URL still carries the side.
    }

    const url = new URL(global.location.href);
    if (side === DEFAULT_SIDE) {
      url.searchParams.delete('side');
    } else {
      url.searchParams.set('side', side);
    }
    global.history.replaceState({}, '', url);
  }

  function startingSide() {
    const fromUrl = new URL(global.location.href).searchParams.get('side');
    if (fromUrl && SIDES[fromUrl]) return fromUrl;
    try {
      const stored = global.localStorage.getItem(STORAGE_KEY);
      if (stored && SIDES[stored]) return stored;
    } catch (error) {
      // Nothing stored we can read; fall through to the default.
    }
    return DEFAULT_SIDE;
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => showSide(tab.dataset.side));
  });

  showSide(startingSide(), { push: false });
  // The chosen side is only in the URL once it differs from the default, so a
  // remembered side still gets written on the first paint.
  rememberSide(startingSide());
})(window);
