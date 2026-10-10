// Picture It · P3 Maths — entry point.
// Wires the two tabs (question feed and Parent Studio), the version badge and
// printing. Each section lives in its own module; this file only connects them.

import { APP_VERSION, showToast } from './core.js';
import { initFeed, refreshFeed } from './feed.js';
import { initStudio } from './studio.js';
import { initSnap } from './snap.js';

const TABS = [
  { tab: 'tabFeed', view: 'feedView', hash: '#questions' },
  { tab: 'tabSnap', view: 'snapView', hash: '#snap' },
  { tab: 'tabStudio', view: 'studioView', hash: '#studio' },
];

let studioReady = false;
let snapReady = false;
let feedDirty = false;

function byId(id) {
  return document.getElementById(id);
}

function selectTab(tabId, options) {
  const opts = options || {};
  for (const entry of TABS) {
    const tab = byId(entry.tab);
    const view = byId(entry.view);
    if (!tab || !view) continue;
    const active = entry.tab === tabId;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    view.hidden = !active;
    if (active && opts.updateHash !== false && location.hash !== entry.hash) {
      history.replaceState(null, '', entry.hash);
    }
  }
  if (tabId === 'tabStudio' && !studioReady) {
    studioReady = true;
    initStudio(byId('studio'), {
      onChange() {
        // Rebuild the feed lazily, when the child next looks at it, so typing
        // in the studio does not churn a feed nobody is watching.
        feedDirty = true;
      },
    });
  }
  if (tabId === 'tabSnap' && !snapReady) {
    snapReady = true;
    initSnap(byId('snap'), {
      onChange() {
        feedDirty = true;
      },
    });
  }
  if (tabId === 'tabFeed' && feedDirty) {
    feedDirty = false;
    refreshFeed();
  }
  if (opts.focus) byId(tabId).focus();
}

function bindTabs() {
  TABS.forEach((entry, index) => {
    const tab = byId(entry.tab);
    if (!tab) return;
    tab.addEventListener('click', () => selectTab(entry.tab));
    tab.addEventListener('keydown', event => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const next = TABS[(index + step + TABS.length) % TABS.length];
      selectTab(next.tab, { focus: true });
    });
  });
  window.addEventListener('hashchange', () => {
    const match = TABS.find(entry => entry.hash === location.hash);
    if (match) selectTab(match.tab, { updateHash: false });
  });
}

function bindHeader() {
  const badge = byId('versionBadge');
  if (badge) badge.textContent = APP_VERSION;
  const print = byId('printButton');
  if (print) {
    print.addEventListener('click', () => {
      // Printing the studio is never useful; always print the questions.
      selectTab('tabFeed');
      setTimeout(() => window.print(), 50);
    });
  }
}

function start() {
  bindHeader();
  bindTabs();
  try {
    initFeed({
      feedEl: byId('feed'),
      sentinelEl: byId('feedSentinel'),
      chipsEl: byId('topicChips'),
      statsEl: byId('statsStrip'),
    });
  } catch (error) {
    console.error('Feed failed to start', error);
    showToast('The questions could not load. Please refresh the page.', 'error');
  }
  const initial = TABS.find(entry => entry.hash === location.hash) || TABS[0];
  selectTab(initial.tab, { updateHash: false });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
