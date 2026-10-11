// Touch up: a small full-screen picture editor for a question's cleaned diagram.
//
// openTouchUp(dataUrl, { title }) -> Promise<string|null>
//   resolves to the edited picture as a PNG data URL on Apply,
//   or null on Cancel / Esc. Self-contained: no libraries, PNG out only.
//
// Tools: erase (paints white), paint, fill bucket, rectangle select (Delete
// clears it to white, Crop keeps only it), straight line, text label.
// Brush size slider with a ring cursor, zoom in / out / fit, undo / redo.

const UNDO_MAX = 30;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;

const TOOLS = [
  { id: 'erase', icon: '🧽', label: 'Erase', key: 'e' },
  { id: 'paint', icon: '🖌️', label: 'Paint', key: 'b' },
  { id: 'fill', icon: '🪣', label: 'Fill', key: 'g' },
  { id: 'select', icon: '⬚', label: 'Select', key: 'm' },
  { id: 'line', icon: '📏', label: 'Line', key: 'l' },
  { id: 'text', icon: '🔤', label: 'Text', key: 't' },
];
const RING_TOOLS = new Set(['erase', 'paint', 'line']);

function h(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c != null) n.append(c);
  return n;
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not open that picture.'));
    img.src = src;
  });
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Flood fill from (x, y) with colour [r,g,b], within tolerance (0-255). */
export function floodFill(ctx, w, h_, x, y, rgb, tol) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h_) return false;
  const img = ctx.getImageData(0, 0, w, h_);
  const px = img.data;
  const at = (y * w + x) * 4;
  const sr = px[at], sg = px[at + 1], sb = px[at + 2], sa = px[at + 3];
  if (Math.abs(sr - rgb[0]) <= 0 && Math.abs(sg - rgb[1]) <= 0 && Math.abs(sb - rgb[2]) <= 0 && sa === 255) return false;
  const seen = new Uint8Array(w * h_);
  const stack = [x + y * w];
  const near = (i) => Math.abs(px[i] - sr) <= tol && Math.abs(px[i + 1] - sg) <= tol &&
    Math.abs(px[i + 2] - sb) <= tol && Math.abs(px[i + 3] - sa) <= tol;
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!near(i)) continue;
    px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255;
    const cx = p % w, cy = (p - cx) / w;
    if (cx > 0) stack.push(p - 1);
    if (cx < w - 1) stack.push(p + 1);
    if (cy > 0) stack.push(p - w);
    if (cy < h_ - 1) stack.push(p + w);
  }
  ctx.putImageData(img, 0, 0);
  return true;
}

export function openTouchUp(dataUrl, { title = 'Touch up the picture' } = {}) {
  return new Promise((resolve) => {
    let finished = false;
    const st = {
      tool: 'erase', size: 12, color: '#d32f2f', tol: 32, zoom: 1,
      drawing: false, last: null, start: null, sel: null, undo: [], redo: [],
      ptr: null, textBox: null,
    };

    // ── DOM ──
    const canvas = h('canvas', { class: 'tu-canvas' });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const overlay = h('canvas', { class: 'tu-overlay' });
    const octx = overlay.getContext('2d');
    const ring = h('div', { class: 'tu-ring', hidden: '' });
    const stage = h('div', { class: 'tu-stage' }, [canvas, overlay]);
    const view = h('div', { class: 'tu-view', tabindex: '0' }, [stage, ring]);

    const toolBtns = TOOLS.map(t => {
      const b = h('button', { type: 'button', class: 'tu-tool', 'data-tool': t.id,
        title: t.label + ' (' + t.key.toUpperCase() + ')', 'aria-label': t.label }, [
        h('span', { class: 'tu-tool-ico', text: t.icon }), h('span', { class: 'tu-tool-txt', text: t.label })]);
      b.addEventListener('click', () => setTool(t.id));
      return b;
    });
    const sizeIn = h('input', { type: 'range', min: '1', max: '80', value: String(st.size), class: 'tu-range', 'aria-label': 'Brush size' });
    const sizeOut = h('span', { class: 'tu-val', text: st.size + ' px' });
    const colorIn = h('input', { type: 'color', value: st.color, class: 'tu-color', 'aria-label': 'Colour' });
    const tolIn = h('input', { type: 'range', min: '0', max: '160', value: String(st.tol), class: 'tu-range', 'aria-label': 'Fill tolerance' });
    const tolOut = h('span', { class: 'tu-val', text: String(st.tol) });
    const btn = (txt, tip, fn, cls = '') => {
      const b = h('button', { type: 'button', class: 'tu-btn ' + cls, title: tip, 'aria-label': tip, text: txt });
      b.addEventListener('click', fn);
      return b;
    };
    const undoBtn = btn('↶', 'Undo (Ctrl+Z)', () => undo());
    const redoBtn = btn('↷', 'Redo (Ctrl+Y)', () => redo());
    const zoomOutBtn = btn('−', 'Zoom out', () => setZoom(st.zoom / 1.25));
    const zoomInBtn = btn('+', 'Zoom in', () => setZoom(st.zoom * 1.25));
    const fitBtn = btn('Fit', 'Fit to screen', () => fit());
    const zoomOut = h('span', { class: 'tu-val', text: '100%' });
    const delBtn = btn('🧽 Clear area', 'Clear the selection to white (Delete)', () => clearSel());
    const cropBtn = btn('✂️ Crop to area', 'Keep only the selection', () => cropSel());
    const selBar = h('div', { class: 'tu-group tu-selbar', hidden: '' }, [delBtn, cropBtn]);
    const applyBtn = btn('✓ Apply', 'Keep these changes', () => finish(true), 'tu-primary');
    const cancelBtn = btn('Cancel', 'Discard changes (Esc)', () => finish(false), 'tu-quiet');

    const field = (label, kids, cls) => h('label', { class: 'tu-field ' + (cls || '') }, [h('span', { class: 'tu-lbl', text: label }), ...kids]);
    const sizeField = field('Size', [sizeIn, sizeOut], 'tu-f-size');
    const colorField = field('Colour', [colorIn], 'tu-f-color');
    const tolField = field('Tolerance', [tolIn, tolOut], 'tu-f-tol');

    const panel = h('div', { class: 'tu-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      h('header', { class: 'tu-head' }, [h('h2', { class: 'tu-title', text: title }),
        h('div', { class: 'tu-group' }, [cancelBtn, applyBtn])]),
      h('div', { class: 'tu-bar' }, [
        h('div', { class: 'tu-group tu-tools' }, toolBtns),
        h('div', { class: 'tu-group' }, [sizeField, colorField, tolField]),
        selBar,
        h('div', { class: 'tu-group' }, [undoBtn, redoBtn]),
        h('div', { class: 'tu-group' }, [zoomOutBtn, zoomOut, zoomInBtn, fitBtn]),
      ]),
      view,
      h('p', { class: 'tu-hint', text: 'Erase paints white. Select an area, then Clear or Crop. Text: click where the label goes and type, Enter to place.' }),
    ]);
    const root = h('div', { class: 'tu-root' }, [panel]);
    document.body.appendChild(root);

    // ── state helpers ──
    function snapshot() { return ctx.getImageData(0, 0, canvas.width, canvas.height); }
    function pushUndo() {
      st.undo.push(snapshot());
      if (st.undo.length > UNDO_MAX) st.undo.shift();
      st.redo = [];
      syncButtons();
    }
    function restore(img) {
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = overlay.width = img.width;
        canvas.height = overlay.height = img.height;
        setZoom(st.zoom);
      }
      ctx.putImageData(img, 0, 0);
    }
    function undo() {
      commitText();
      if (!st.undo.length) return;
      st.redo.push(snapshot());
      restore(st.undo.pop());
      setSel(null); syncButtons();
    }
    function redo() {
      if (!st.redo.length) return;
      st.undo.push(snapshot());
      restore(st.redo.pop());
      setSel(null); syncButtons();
    }
    function syncButtons() {
      undoBtn.disabled = !st.undo.length;
      redoBtn.disabled = !st.redo.length;
    }
    function setTool(id) {
      commitText();
      st.tool = id;
      toolBtns.forEach(b => b.classList.toggle('is-on', b.dataset.tool === id));
      sizeField.hidden = !(RING_TOOLS.has(id) || id === 'text');
      colorField.hidden = !(id === 'paint' || id === 'fill' || id === 'line' || id === 'text');
      tolField.hidden = id !== 'fill';
      if (id !== 'select') setSel(null);
      view.style.cursor = RING_TOOLS.has(id) ? 'none' : (id === 'text' ? 'text' : 'crosshair');
      updateRing();
    }
    function setZoom(z) {
      st.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
      const w = Math.round(canvas.width * st.zoom), hh = Math.round(canvas.height * st.zoom);
      for (const c of [canvas, overlay]) { c.style.width = w + 'px'; c.style.height = hh + 'px'; }
      stage.style.width = w + 'px'; stage.style.height = hh + 'px';
      zoomOut.textContent = Math.round(st.zoom * 100) + '%';
      updateRing();
    }
    function fit() {
      const r = view.getBoundingClientRect();
      const avW = Math.max(100, r.width - 40), avH = Math.max(100, r.height - 40);
      setZoom(Math.min(avW / canvas.width, avH / canvas.height, 4));
    }
    function toImg(ev) {
      const r = canvas.getBoundingClientRect();
      return { x: (ev.clientX - r.left) * canvas.width / r.width, y: (ev.clientY - r.top) * canvas.height / r.height };
    }
    function updateRing() {
      const p = st.ptr;
      if (!p || !RING_TOOLS.has(st.tool)) { ring.hidden = true; return; }
      const vr = view.getBoundingClientRect();
      const d = Math.max(4, st.size * st.zoom);
      ring.hidden = false;
      ring.style.width = ring.style.height = d + 'px';
      ring.style.left = (p.clientX - vr.left + view.scrollLeft - d / 2) + 'px';
      ring.style.top = (p.clientY - vr.top + view.scrollTop - d / 2) + 'px';
    }

    // ── selection ──
    function normRect(a, b) {
      const x = Math.max(0, Math.min(a.x, b.x)), y = Math.max(0, Math.min(a.y, b.y));
      const x2 = Math.min(canvas.width, Math.max(a.x, b.x)), y2 = Math.min(canvas.height, Math.max(a.y, b.y));
      return { x: Math.round(x), y: Math.round(y), w: Math.round(x2 - x), h: Math.round(y2 - y) };
    }
    function drawOverlay() {
      octx.clearRect(0, 0, overlay.width, overlay.height);
      const s = st.sel;
      if (s) {
        octx.save();
        octx.lineWidth = Math.max(1, 1.5 / st.zoom);
        octx.setLineDash([6 / st.zoom, 4 / st.zoom]);
        octx.strokeStyle = '#1565c0';
        octx.fillStyle = 'rgba(21,101,192,0.08)';
        octx.fillRect(s.x, s.y, s.w, s.h);
        octx.strokeRect(s.x + 0.5, s.y + 0.5, s.w, s.h);
        octx.restore();
      }
      if (st.tool === 'line' && st.drawing && st.start && st.last) {
        octx.save();
        octx.strokeStyle = st.color; octx.lineWidth = st.size; octx.lineCap = 'round';
        octx.beginPath(); octx.moveTo(st.start.x, st.start.y); octx.lineTo(st.last.x, st.last.y); octx.stroke();
        octx.restore();
      }
    }
    function setSel(s) {
      st.sel = s && s.w >= 2 && s.h >= 2 ? s : null;
      selBar.hidden = !st.sel;
      drawOverlay();
    }
    function clearSel() {
      if (!st.sel) return;
      pushUndo();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(st.sel.x, st.sel.y, st.sel.w, st.sel.h);
      setSel(null);
    }
    function cropSel() {
      const s = st.sel;
      if (!s) return;
      pushUndo();
      const part = ctx.getImageData(s.x, s.y, s.w, s.h);
      canvas.width = overlay.width = s.w;
      canvas.height = overlay.height = s.h;
      ctx.putImageData(part, 0, 0);
      setSel(null);
      fit();
    }

    // ── text ──
    function commitText() {
      const tb = st.textBox;
      if (!tb) return;
      st.textBox = null;
      const txt = tb.input.value.trim();
      tb.input.remove();
      if (!txt) return;
      pushUndo();
      ctx.save();
      ctx.fillStyle = tb.color;
      ctx.font = '600 ' + tb.px + 'px "Century Gothic", system-ui, sans-serif';
      ctx.textBaseline = 'top';
      txt.split('\n').forEach((line, i) => ctx.fillText(line, tb.x, tb.y + i * tb.px * 1.2));
      ctx.restore();
    }
    function startText(p, ev) {
      commitText();
      const px = Math.max(12, Math.round(st.size * 1.6));
      const input = h('input', { type: 'text', class: 'tu-text', placeholder: 'Type the label…', 'aria-label': 'Label text' });
      const vr = view.getBoundingClientRect();
      input.style.left = (ev.clientX - vr.left + view.scrollLeft) + 'px';
      input.style.top = (ev.clientY - vr.top + view.scrollTop) + 'px';
      input.style.fontSize = Math.max(12, px * st.zoom) + 'px';
      input.style.color = st.color;
      view.appendChild(input);
      st.textBox = { input, x: p.x, y: p.y, px, color: st.color };
      input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commitText(); view.focus(); }
        if (e.key === 'Escape') { e.preventDefault(); input.value = ''; commitText(); view.focus(); }
      });
      setTimeout(() => input.focus(), 0);
    }

    // ── pointer ──
    function stroke(a, b) {
      ctx.save();
      ctx.strokeStyle = st.tool === 'erase' ? '#ffffff' : st.color;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = st.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      if (a.x === b.x && a.y === b.y) { ctx.arc(a.x, a.y, st.size / 2, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      ctx.restore();
    }
    view.addEventListener('pointerdown', ev => {
      if (ev.target === view.querySelector('.tu-text')) return;
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      const p = toImg(ev);
      st.ptr = ev;
      if (st.tool === 'text') { ev.preventDefault(); startText(p, ev); return; }
      if (st.tool === 'fill') {
        pushUndo();
        if (!floodFill(ctx, canvas.width, canvas.height, p.x, p.y, hexToRgb(st.color), st.tol)) { st.undo.pop(); syncButtons(); }
        return;
      }
      ev.preventDefault();
      try { view.setPointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
      st.drawing = true; st.start = p; st.last = p;
      if (st.tool === 'erase' || st.tool === 'paint') { pushUndo(); stroke(p, p); }
      if (st.tool === 'select') setSel(null);
    });
    view.addEventListener('pointermove', ev => {
      st.ptr = ev; updateRing();
      if (!st.drawing) return;
      const p = toImg(ev);
      if (st.tool === 'erase' || st.tool === 'paint') stroke(st.last, p);
      st.last = p;
      if (st.tool === 'select') { st.sel = normRect(st.start, p); selBar.hidden = false; drawOverlay(); }
      if (st.tool === 'line') {
        if (ev.shiftKey) {
          const dx = p.x - st.start.x, dy = p.y - st.start.y;
          const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
          st.last = { x: st.start.x + Math.cos(ang) * len, y: st.start.y + Math.sin(ang) * len };
        }
        drawOverlay();
      }
    });
    const endPtr = () => {
      if (!st.drawing) return;
      st.drawing = false;
      if (st.tool === 'line' && st.start && st.last && (st.start.x !== st.last.x || st.start.y !== st.last.y)) {
        pushUndo();
        const keep = st.tool;
        st.tool = 'paint'; stroke(st.start, st.last); st.tool = keep;
      }
      if (st.tool === 'select') setSel(st.sel);
      st.start = st.last = null;
      drawOverlay();
    };
    view.addEventListener('pointerup', endPtr);
    view.addEventListener('pointercancel', endPtr);
    view.addEventListener('pointerleave', () => { if (!st.drawing) { st.ptr = null; updateRing(); } });
    view.addEventListener('wheel', ev => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      setZoom(st.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1));
    }, { passive: false });
    view.addEventListener('scroll', updateRing);

    sizeIn.addEventListener('input', () => { st.size = Number(sizeIn.value); sizeOut.textContent = st.size + ' px'; updateRing(); });
    colorIn.addEventListener('input', () => { st.color = colorIn.value; });
    tolIn.addEventListener('input', () => { st.tol = Number(tolIn.value); tolOut.textContent = String(st.tol); });

    function onKey(ev) {
      if (finished) return;
      const typing = ev.target && (ev.target.tagName === 'INPUT' && ev.target.type === 'text');
      if (typing) return;
      const mod = ev.ctrlKey || ev.metaKey;
      if (ev.key === 'Escape') { ev.preventDefault(); if (st.sel) setSel(null); else finish(false); return; }
      if (mod && ev.key.toLowerCase() === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); return; }
      if (mod && (ev.key.toLowerCase() === 'y' || (ev.key.toLowerCase() === 'z' && ev.shiftKey))) { ev.preventDefault(); redo(); return; }
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && st.sel) { ev.preventDefault(); clearSel(); return; }
      if (mod) return;
      if (ev.key === '[') { sizeIn.value = String(Math.max(1, st.size - 2)); sizeIn.dispatchEvent(new Event('input')); return; }
      if (ev.key === ']') { sizeIn.value = String(Math.min(80, st.size + 2)); sizeIn.dispatchEvent(new Event('input')); return; }
      const t = TOOLS.find(x => x.key === ev.key.toLowerCase());
      if (t && ev.target.tagName !== 'INPUT') setTool(t.id);
    }
    document.addEventListener('keydown', onKey, true);

    function finish(apply) {
      if (finished) return;
      commitText();
      finished = true;
      document.removeEventListener('keydown', onKey, true);
      let out = null;
      if (apply) { try { out = canvas.toDataURL('image/png'); } catch (_) { out = null; } }
      root.remove();
      resolve(out);
    }

    // ── load ──
    loadImg(dataUrl).then(img => {
      canvas.width = overlay.width = Math.max(1, img.naturalWidth);
      canvas.height = overlay.height = Math.max(1, img.naturalHeight);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      setTool('erase');
      syncButtons();
      requestAnimationFrame(fit);
      view.focus();
    }).catch(() => finish(false));
  });
}
