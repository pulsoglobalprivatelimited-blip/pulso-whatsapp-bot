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
    supply: {
      eyebrow: 'Pulso Supply',
      title: 'Agency Supply Enquiries',
      subtitle: 'Agencies that asked us for caregivers or nurses. Everything here is what they typed on WhatsApp.',
      board: 'supply'
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
  let currentSide = '';
  /* How many tab changes the phone's back can still undo on this page. Carried
     in the history state so a back that lands on a tab entry knows the count. */
  let sideDepth = 0;

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
    if (side === 'supply') return `${label} supply enquiry desk`;
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
    const changed = side !== currentSide;
    currentSide = side;

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
      rememberSide(side, changed);
    }
  }

  /* `push`: a tab change the user made, so it becomes a step the phone's back
     can undo (docs/easy_back_plan.md). The first paint and a back-step only
     rewrite the address. A tab change also clears any open chat from the
     address: it belonged to the side being left. */
  function rememberSide(side, push) {
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
    if (push) {
      url.searchParams.delete('chat');
      url.searchParams.delete('phone');
      sideDepth += 1;
      global.history.pushState({ pulsoSide: side, sideDepth }, '', url);
    } else {
      const state = Object.assign({}, global.history.state || {}, { pulsoSide: side, sideDepth });
      global.history.replaceState(state, '', url);
    }
    if (global.PulsoBack) global.PulsoBack.refresh();
  }

  function sideFromUrl() {
    const side = new URL(global.location.href).searchParams.get('side');
    return side && SIDES[side] ? side : DEFAULT_SIDE;
  }

  function startingSide() {
    const params = new URL(global.location.href).searchParams;
    const fromUrl = params.get('side');
    if (fromUrl && SIDES[fromUrl]) return fromUrl;
    // A link to a provider record (?phone=) is a link to the provider desk,
    // whatever tab this phone was last on (docs/easy_back_plan.md).
    if (params.get('phone')) return DEFAULT_SIDE;
    try {
      const stored = global.localStorage.getItem(STORAGE_KEY);
      if (stored && SIDES[stored]) return stored;
    } catch (error) {
      // Nothing stored we can read; fall through to the default.
    }
    return DEFAULT_SIDE;
  }

  /* The point of putting counts on the tabs is seeing that another desk needs
     you while you are standing on this one — which the boards themselves can't
     tell you, because a board isn't built until its side is opened. One small
     request at startup buys that, and the board still loads its own fresh copy
     when someone actually switches. */
  async function countOtherSides() {
    if (!global.PulsoDeskShell || !global.PulsoPartnerReview) return;

    try {
      const query = region ? `?region=${encodeURIComponent(region)}` : '';
      const response = await fetch(`/admin/booking-chats${query}`);
      if (!response.ok) return;

      const data = await response.json();
      const chats = data.chats || [];
      const agencies = chats.filter((chat) => global.PulsoPartnerReview.isPartner(chat));

      global.PulsoDeskShell.setTabCount(
        'agency',
        agencies.filter((chat) => String(chat.partnerStatus || '') === 'document_received').length
      );
      /* An agency that answered every question and has not been rung yet. The
         alert to the founder is switched off, so this badge is the only thing
         that says someone is waiting. */
      global.PulsoDeskShell.setTabCount(
        'supply',
        chats.filter((chat) => String(chat.enquiryType || '') === 'supply'
          && String(chat.supplyStatus || '') === 'notified'
          && !chat.supplyHandledAt).length
      );
      // Customer bookings are the family's to finish, not ours, so nothing on
      // that desk is ever waiting on a reviewer. No badge is the honest answer.
      global.PulsoDeskShell.setTabCount('customer', 0);
    } catch (error) {
      // A count is a convenience; the desk works without it.
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.side !== currentSide) showSide(tab.dataset.side);
    });
  });

  /* With nothing open on top, the phone's back and the round arrow walk the
     tabs in reverse; the arrow greys out once there is nowhere left to go. */
  if (global.PulsoBack) {
    global.PulsoBack.setRoot({
      canBack: () => sideDepth > 0,
      onPop: (state) => {
        sideDepth = Math.max(0, Number(state && state.sideDepth) || 0);
        showSide(sideFromUrl(), { push: false });
      }
    });
  }

  showSide(startingSide(), { push: false });
  // The chosen side is only in the URL once it differs from the default, so a
  // remembered side still gets written on the first paint.
  rememberSide(startingSide());
  countOtherSides();
})(window);
