// Picture It · cloud save.
// Signing in with Google keeps the board in Firestore as well as on this device, so it
// follows the child to another computer. Everything still works signed out (and if the
// Firebase scripts cannot load): the board simply stays in localStorage.
//
// Storage, and nothing else:
//   users/{uid}/settings/visualiseBoard          = { ids: [...], updatedAt }
//   users/{uid}/settings/visualiseBlock_<id>     = { block, updatedAt }

const FB = 'https://www.gstatic.com/firebasejs/11.10.0/';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo',
  authDomain: 'mathgen--app.firebaseapp.com',
  projectId: 'mathgen--app',
  storageBucket: 'mathgen--app.firebasestorage.app',
  messagingSenderId: '165654161198',
  appId: '1:165654161198:web:16c8bd60eb3a2aa7edbcbf',
  measurementId: 'G-0MWZFG211D',
};
const RECAPTCHA_SITE_KEY = '6Le98gwtAAAAAAzkjJTZXFM5D8tpjx_P4rtRuhuH';
const SAVE_DELAY_MS = 1200;

const TEXT = {
  signIn: '☁ Sign in to save to the cloud',
  saving: 'Saving…',
  saved: '✓ Saved to the cloud',
  offline: 'Offline — saved on this device',
  denied: 'Cloud refused the save (permission) — saved on this device',
};

/** Firestore doc ids may only hold [A-Za-z0-9_-] here. */
export function safeId(id) {
  return String(id || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
}

/**
 * Merge the cloud copy with this device's copy: union by id, the newer updatedAt wins,
 * cloud order first then local-only blocks appended. Pure, so it can be tested.
 */
export function mergeBlocks(cloudIds, cloudBlocks, localBlocks) {
  const byId = new Map();
  for (const b of cloudBlocks || []) if (b && b.id) byId.set(b.id, b);
  const out = [];
  const seen = new Set();
  const localById = new Map();
  for (const b of localBlocks || []) if (b && b.id) localById.set(b.id, b);
  const pick = (id) => {
    const c = byId.get(id);
    const l = localById.get(id);
    if (c && l) return (Number(l.updatedAt) || 0) > (Number(c.updatedAt) || 0) ? l : c;
    return c || l || null;
  };
  for (const id of cloudIds || []) {
    if (seen.has(id)) continue;
    const b = pick(id);
    if (b) { out.push(b); seen.add(id); }
  }
  for (const id of byId.keys()) {
    if (!seen.has(id)) { out.push(pick(id)); seen.add(id); }
  }
  for (const b of localBlocks || []) {
    if (b && b.id && !seen.has(b.id)) { out.push(b); seen.add(b.id); }
  }
  return out;
}

function errCode(err) {
  return String((err && (err.code || err.message)) || '');
}

/**
 * initCloud({ getBlocks, setBlocks, onChange })
 *   getBlocks()  -> the current list
 *   setBlocks(list) -> replace the list (write locally + re-render)
 *   onChange(fn) -> subscribe to saves; fn(list) is called after each save
 */
export function initCloud({ getBlocks, setBlocks, onChange } = {}) {
  const host = document.getElementById('cloudStatus');
  if (!host || typeof getBlocks !== 'function') return null;

  let fb = null;          // loaded modules + instances
  let user = null;
  let timer = 0;
  let writing = false;
  let again = false;
  let lastWritten = new Map(); // id -> JSON of what is in the cloud
  let lastIds = null;          // JSON of the order doc in the cloud

  const pill = document.createElement('span');
  pill.className = 'cloud-pill';
  pill.setAttribute('role', 'status');
  pill.setAttribute('aria-live', 'polite');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cloud-btn';
  btn.textContent = TEXT.signIn;
  const out = document.createElement('button');
  out.type = 'button';
  out.className = 'cloud-signout';
  out.textContent = 'Sign out';
  out.hidden = true;
  pill.hidden = true;
  btn.hidden = true;
  host.append(btn, pill, out);

  function show(text, kind) {
    pill.textContent = text;
    pill.dataset.kind = kind || '';
    pill.hidden = false;
  }

  async function load() {
    if (fb) return fb;
    const [appM, authM, fsM] = await Promise.all([
      import(FB + 'firebase-app.js'),
      import(FB + 'firebase-auth.js'),
      import(FB + 'firebase-firestore.js'),
    ]);
    const app = appM.getApps().length ? appM.getApp() : appM.initializeApp(FIREBASE_CONFIG);
    try {
      const acM = await import(FB + 'firebase-app-check.js');
      acM.initializeAppCheck(app, {
        provider: new acM.ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      console.warn('App Check could not start; continuing without it', err);
    }
    fb = { authM, fsM, auth: authM.getAuth(app), db: fsM.getFirestore(app) };
    return fb;
  }

  const boardRef = (uid) => fb.fsM.doc(fb.db, 'users', uid, 'settings', 'visualiseBoard');
  const blockRef = (uid, id) => fb.fsM.doc(fb.db, 'users', uid, 'settings', 'visualiseBlock_' + safeId(id));

  function failed(err) {
    if (/permission/i.test(errCode(err))) {
      console.error('Cloud save refused (permission-denied)', err);
      show(TEXT.denied, 'warn');
    } else {
      console.warn('Cloud save failed', err);
      show(TEXT.offline, 'warn');
    }
  }

  async function pullAndMerge(u) {
    show(TEXT.saving, 'busy');
    try {
      const { getDoc } = fb.fsM;
      const snap = await getDoc(boardRef(u.uid));
      const ids = snap.exists() && Array.isArray(snap.data().ids) ? snap.data().ids.map(String) : [];
      const cloudBlocks = [];
      lastWritten = new Map();
      await Promise.all(ids.map(async (id) => {
        try {
          const s = await getDoc(blockRef(u.uid, id));
          if (!s.exists()) return;
          const b = s.data().block;
          if (b && b.id) {
            cloudBlocks.push(b);
            lastWritten.set(b.id, JSON.stringify(b));
          }
        } catch (err) { console.warn('Could not read a cloud block', id, err); }
      }));
      lastIds = snap.exists() ? JSON.stringify(ids) : null;
      if (user !== u) return;
      const merged = mergeBlocks(ids, cloudBlocks, getBlocks());
      if (typeof setBlocks === 'function') setBlocks(merged);
      await push();
    } catch (err) {
      failed(err);
    }
  }

  async function push() {
    if (!user || !fb) return;
    if (writing) { again = true; return; }
    writing = true;
    const u = user;
    show(TEXT.saving, 'busy');
    try {
      const { setDoc, deleteDoc } = fb.fsM;
      const list = getBlocks() || [];
      const ids = list.map((b) => b.id);
      const now = Date.now();
      const keep = new Set(ids);
      for (const b of list) {
        const json = JSON.stringify(b);
        if (lastWritten.get(b.id) === json) continue;
        await setDoc(blockRef(u.uid, b.id), { block: b, updatedAt: Number(b.updatedAt) || now });
        lastWritten.set(b.id, json);
      }
      for (const id of [...lastWritten.keys()]) {
        if (keep.has(id)) continue;
        await deleteDoc(blockRef(u.uid, id));
        lastWritten.delete(id);
      }
      const idsJson = JSON.stringify(ids);
      if (idsJson !== lastIds) {
        await setDoc(boardRef(u.uid), { ids, updatedAt: now });
        lastIds = idsJson;
      }
      if (user === u) show(TEXT.saved, 'ok');
    } catch (err) {
      failed(err);
    } finally {
      writing = false;
      if (again) { again = false; schedule(); }
    }
  }

  function schedule() {
    if (!user) return;
    clearTimeout(timer);
    show(TEXT.saving, 'busy');
    timer = setTimeout(push, SAVE_DELAY_MS);
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await load();
      const { signInWithPopup, GoogleAuthProvider, browserPopupRedirectResolver } = fb.authM;
      await signInWithPopup(fb.auth, new GoogleAuthProvider(), browserPopupRedirectResolver);
    } catch (err) {
      if (!/popup-closed|cancelled-popup/i.test(errCode(err))) {
        console.warn('Sign-in failed', err);
        show(TEXT.offline, 'warn');
      }
    } finally {
      btn.disabled = false;
    }
  });

  out.addEventListener('click', async () => {
    try { if (fb) await fb.authM.signOut(fb.auth); } catch (err) { console.warn(err); }
  });

  if (typeof onChange === 'function') onChange(() => schedule());

  (async () => {
    try {
      await load();
    } catch (err) {
      console.warn('Cloud save is unavailable (Firebase did not load)', err);
      show(TEXT.offline, 'warn');
      return;
    }
    btn.hidden = false;
    fb.authM.onAuthStateChanged(fb.auth, (u) => {
      user = u || null;
      clearTimeout(timer);
      lastWritten = new Map();
      lastIds = null;
      if (user) {
        btn.hidden = true;
        out.hidden = false;
        pullAndMerge(user);
      } else {
        btn.hidden = false;
        out.hidden = true;
        pill.hidden = true;
      }
    });
  })();

  return { push: () => push(), get user() { return user; } };
}
