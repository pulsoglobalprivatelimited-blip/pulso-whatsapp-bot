/* The chrome of the ops desk on a phone.

   Everything the desk used to keep permanently on screen — eleven counters,
   eight navigation links, three rows of filters, a search box — still exists.
   It moved into sheets that slide up when asked for, so the queue can have the
   screen the rest of the time.

   This file owns only the shell: opening and closing sheets, the search field
   in the bar, the counts on the desk tabs, pull to refresh, and the full-screen
   document viewer. What goes in a row is desk-ui.js; what fills a list is each
   desk's own script.

   Exposes a single global: window.PulsoDeskShell */
(function (global) {
  'use strict';

  const doc = global.document;
  const body = doc.body;

  function isPhone() {
    return global.matchMedia('(max-width: 960px), (hover: none) and (pointer: coarse)').matches;
  }

  /* ---- sheets ------------------------------------------------------------ */

  let openSheet = null;

  /* Two booking boards are cloned from one template onto this page, so
     `[data-sheet="filters"]` matches more than once. A trigger means the sheet
     on its own side of the business; anything outside a side panel — the bar
     buttons — means the page-level one. */
  function sheetFor(name, trigger) {
    const panel = trigger && trigger.closest ? trigger.closest('.side-panel') : null;
    return (panel && panel.querySelector(`[data-sheet="${name}"]`)) ||
      doc.querySelector(`[data-sheet="${name}"]`);
  }

  function closeSheet() {
    if (!openSheet) return;
    openSheet.classList.remove('is-open');
    openSheet.setAttribute('aria-hidden', 'true');
    body.classList.remove('desk-sheet-open');
    openSheet = null;
  }

  function showSheet(name, trigger) {
    const sheet = sheetFor(name, trigger);
    if (!sheet) return;
    if (openSheet === sheet) {
      closeSheet();
      return;
    }
    closeSheet();
    openSheet = sheet;
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
    body.classList.add('desk-sheet-open');
  }

  /* Delegated rather than bound: the agency and customer boards are cloned
     from a template the first time each is opened, long after this runs, and
     their sheets have to work the moment they exist.

     A sheet is a detour, not a destination — choosing something in it and
     landing back on the queue is the whole point — so any chip inside one
     closes it. The apply button is that same gesture, said out loud. */
  function wireSheets() {
    doc.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-sheet-open]');
      if (trigger) {
        event.preventDefault();
        showSheet(trigger.getAttribute('data-sheet-open'), trigger);
        return;
      }

      if (event.target.closest('.desk-scrim')) {
        closeSheet();
        return;
      }

      const sheet = event.target.closest('[data-sheet]');
      if (!sheet) return;
      const chip = event.target.closest('.filter, .metric, .desk-sheet-apply, .button');
      if (!chip) return;
      // Log out posts a form; let it navigate rather than closing under it.
      if (chip.type === 'submit') return;
      closeSheet();
    });

    global.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSheet();
    });
  }

  /* ---- search in the bar -------------------------------------------------

     A search box is worth a permanent row on a desktop, where there is a row
     to spare. On a phone it is worth an icon until the moment you use it. */

  function wireSearch() {
    const toggles = doc.querySelectorAll('[data-desk-search-toggle]');
    if (!toggles.length) return;

    function setOpen(open) {
      body.classList.toggle('desk-search-open', open);
      if (!open) return;
      const field = doc.querySelector('.search-row input[type="search"]:not([hidden])');
      if (field) {
        const visible = field.closest('.side-panel');
        if (!visible || !visible.hidden) field.focus();
      }
    }

    toggles.forEach((toggle) => {
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        setOpen(!body.classList.contains('desk-search-open'));
      });
    });

    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setOpen(false);
    });

    /* Clearing the search is also finishing with it. */
    doc.addEventListener('click', (event) => {
      const clear = event.target.closest('#clear-search-button, [data-el="clear-search-button"]');
      if (clear) setOpen(false);
    });
  }

  /* ---- counts on the desk tabs -------------------------------------------

     The eleven counter chips said a lot about the desk you were already on and
     nothing about the two you were not. One number per tab says the thing a
     reviewer actually needs: where the work is. */

  function setTabCount(side, count) {
    const tab = doc.querySelector(`.side-tab[data-side="${side}"]`);
    if (!tab) return;

    let badge = tab.querySelector('.desk-tab-count');
    if (!badge) {
      badge = doc.createElement('span');
      badge.className = 'desk-tab-count';
      tab.append(badge);
    }

    const value = Number(count) || 0;
    badge.textContent = value > 0 ? String(value) : '';
    badge.hidden = value <= 0;
  }

  /* ---- the filter badge --------------------------------------------------

     Hiding a filter is only safe if you can see that it is on. */

  function setFilterCount(root, count) {
    const scope = root || doc;
    const badge = scope.querySelector('.desk-filter-count');
    if (!badge) return;
    const value = Number(count) || 0;
    badge.textContent = value > 0 ? String(value) : '';
  }

  /* ---- pull to refresh ---------------------------------------------------

     The Refresh button was a full-width pill sitting where a row could have
     been. This is the gesture every other phone app already taught them. */

  function wirePullToRefresh(handler) {
    if (typeof handler !== 'function') return;

    let startY = null;
    let pulling = false;

    const indicator = doc.createElement('div');
    indicator.className = 'desk-pull';
    indicator.textContent = 'Pull to refresh';
    indicator.hidden = true;
    body.append(indicator);

    /* Which element the finger is actually scrolling.

       The page is not always the scroller. On a phone the open detail is
       `position: fixed; inset: 0; overflow-y: auto`, and the thread inside it
       scrolls on its own too. While either is scrolling, the document behind
       stays at scrollTop 0 for ever — so testing the document said "they are at
       the top of the page" on every single touch, and any 60px drag refreshed
       the desk. Reading a long certificate did it over and over. */
    function scrollerFor(node) {
      let el = node instanceof Element ? node : null;
      while (el && el !== body) {
        const style = global.getComputedStyle(el);
        const scrolls = /(auto|scroll|overlay)/.test(style.overflowY);
        if (scrolls && el.scrollHeight > el.clientHeight + 1) return el;
        el = el.parentElement;
      }
      return doc.scrollingElement || doc.documentElement;
    }

    doc.addEventListener('touchstart', (event) => {
      if (!isPhone() || body.classList.contains('desk-sheet-open')) return;
      // An open detail is a screen of its own. Pulling down in it means
      // scrolling the certificate, never refreshing the queue behind it.
      if (doc.querySelector('.content.mobile-detail-open')) return;
      if (scrollerFor(event.target).scrollTop > 2) return;
      startY = event.touches[0].clientY;
      pulling = false;
    }, { passive: true });

    doc.addEventListener('touchmove', (event) => {
      if (startY === null) return;
      const delta = event.touches[0].clientY - startY;
      if (delta > 60 && !pulling) {
        pulling = true;
        indicator.hidden = false;
        indicator.textContent = 'Release to refresh';
      }
    }, { passive: true });

    doc.addEventListener('touchend', () => {
      if (pulling) {
        indicator.textContent = 'Refreshing…';
        Promise.resolve()
          .then(() => handler())
          .catch(() => {})
          .then(() => {
            indicator.hidden = true;
          });
      }
      startY = null;
      pulling = false;
    });
  }

  /* ---- the document viewer -----------------------------------------------

     A certificate is the one thing a reviewer is judging, and opening it used
     to mean leaving the desk for a browser tab. */

  let viewer = null;

  function ensureViewer() {
    if (viewer) return viewer;
    viewer = doc.createElement('div');
    viewer.className = 'doc-viewer';
    viewer.innerHTML =
      '<button class="doc-viewer-close" type="button" aria-label="Close">&times;</button><img alt="">';
    viewer.addEventListener('click', (event) => {
      if (event.target === viewer || event.target.closest('.doc-viewer-close')) {
        viewer.classList.remove('is-open');
      }
    });
    body.append(viewer);
    return viewer;
  }

  function openDocument(src, alt) {
    if (!src) return;
    const node = ensureViewer();
    const image = node.querySelector('img');
    image.src = src;
    image.alt = alt || 'Document';
    node.classList.add('is-open');
  }

  function wireDocumentViewer() {
    doc.addEventListener('click', (event) => {
      const image = event.target.closest('.attachment-card img');
      if (!image || !image.src) return;
      event.preventDefault();
      openDocument(image.src, image.alt);
    });

    global.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && viewer) viewer.classList.remove('is-open');
    });
  }

  /* ---- go ----------------------------------------------------------------- */

  function start() {
    wireSheets();
    wireSearch();
    wireDocumentViewer();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  global.PulsoDeskShell = {
    isPhone,
    showSheet,
    closeSheet,
    setTabCount,
    setFilterCount,
    wirePullToRefresh,
    openDocument
  };
})(window);
