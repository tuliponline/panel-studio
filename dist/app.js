/* Panel Studio v4 — full drag-drop · wire drag · pan/zoom · real-scale */
(() => {
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const C = window.PANEL_CATALOG;
  const MODULE = C.MODULE_MM;
  const STORAGE = 'panel-studio-v1';
  const VERSION = 4;
  const LONG_PRESS_MS = 380;
  const MOVE_THRESH = 8;

  const WIRE_COLORS = {
    AC: [
      ['#8B4513', 'L · น้ำตาล'],
      ['#1a1a1a', 'L · ดำ'],
      ['#2563EB', 'N · น้ำเงิน'],
      ['#16A34A', 'PE · เขียว'],
      ['#CA8A04', 'PE · เหลืองเขียว']
    ],
    DC: [
      ['#DC2626', '+ · แดง'],
      ['#1a1a1a', '− · ดำ'],
      ['#16A34A', 'PE · เขียว'],
      ['#2563EB', 'สัญญาณ']
    ]
  };

  function cabinetFromPreset(p) {
    const L = C.layoutDefaults;
    return {
      width: p.w,
      height: p.h,
      depth: p.d,
      rails: p.rails,
      pitch: p.pitch || L.railPitch,
      railLengthMm: p.railLengthMm != null ? p.railLengthMm : L.railLengthMm || 0,
      railYs: null,
      preset: p.id,
      marginTop: p.marginTop ?? L.marginTop,
      marginBottom: p.marginBottom ?? L.marginBottom,
      marginSide: p.marginSide ?? L.marginSide,
      ductTop: p.ductTop ?? L.ductTop,
      ductBottom: p.ductBottom ?? L.ductBottom,
      ductSide: p.ductSide ?? L.ductSide
    };
  }
  const DEFAULT_CAB = (m) => {
    const preferred = m === 'AC' ? 'ind-600' : 'pv-400';
    const p = C.presets.find((x) => x.id === preferred) || C.presets.find((x) => x.mode === m);
    return cabinetFromPreset(p);
  };

  let data = {
    version: VERSION,
    AC: { devices: [], wires: [], cabinet: DEFAULT_CAB('AC') },
    DC: { devices: [], wires: [], cabinet: DEFAULT_CAB('DC') }
  };
  let mode = 'AC';
  let tool = 'move';
  let selected = null;
  let selectedWire = null;
  let history = [];
  let future = [];
  let catFilter = 'all';
  let cam = { zoom: 1, x: 0, y: 0 };
  let drag = null;
  let ghostEl = null;
  let lastBendTap = 0;
  let pointers = new Map();

  /* —— Catalog helpers —— */
  const devicesFor = (m) => C.devices.filter((d) => d.modes.includes(m));
  const spec = (type) => C.devices.find((d) => d.id === type);
  const deviceWidth = (t) => t.widthMm || t.modules * MODULE;
  const deviceHeight = (t) => t.heightMm || C.DEVICE_BODY_H;
  const state = () => data[mode];
  const cabinet = () => state().cabinet;

  function plate() {
    const c = cabinet();
    return {
      x: c.marginSide + c.ductSide,
      y: c.marginTop + c.ductTop,
      w: c.width - 2 * (c.marginSide + c.ductSide),
      h: c.height - c.marginTop - c.marginBottom - c.ductTop - c.ductBottom
    };
  }
  function railOffset(t) {
    return deviceHeight(t) * (C.layoutDefaults.railOffsetRatio || 0.42);
  }
  function autoRailYs() {
    const c = cabinet();
    const p = plate();
    const n = Math.max(1, Math.min(12, c.rails | 0));
    const headroom = 50;
    const footroom = 45;
    const span = Math.max(0, p.h - headroom - footroom);
    const wanted = Math.max(95, c.pitch || C.layoutDefaults.railPitch);
    let pitch = wanted;
    let fitted = true;
    if (n > 1) {
      const maxPitch = span / (n - 1);
      if (maxPitch < wanted) {
        pitch = Math.max(80, maxPitch);
        fitted = maxPitch >= 95;
      }
    }
    const total = (n - 1) * pitch;
    const startY = p.y + headroom + Math.max(0, (span - total) / 2);
    return {
      ys: Array.from({ length: n }, (_, i) => Math.round(startY + i * pitch)),
      pitch,
      fitted,
      headroom,
      footroom
    };
  }
  function ensureRailYs() {
    const c = cabinet();
    const auto = autoRailYs();
    if (!Array.isArray(c.railYs) || c.railYs.length !== auto.ys.length) {
      c.railYs = auto.ys.slice();
    }
    return c.railYs;
  }
  function railYs() {
    return ensureRailYs();
  }
  function railLengthMm() {
    const c = cabinet();
    const plateW = Math.max(40, plate().w - 10);
    const len = Number(c.railLengthMm) || 0;
    if (len <= 0) return plateW;
    return Math.min(plateW, Math.max(50, len));
  }
  function railUsableWidth() {
    return railLengthMm();
  }
  function railModules() {
    return Math.floor(railUsableWidth() / MODULE);
  }
  function railDrawX() {
    const p = plate();
    return Math.round(p.x + (p.w - railUsableWidth()) / 2);
  }
  function snapModuleX(x, w) {
    const rx = railDrawX();
    const rw = railUsableWidth();
    const maxX = rx + Math.max(0, rw - w);
    const slots = Math.max(0, Math.floor((rw - w) / MODULE));
    const rel = x - rx;
    const slot = Math.round(rel / MODULE);
    const clamped = Math.max(0, Math.min(slots, slot));
    return Math.round(rx + clamped * MODULE);
  }
  function nearestRailIndex(y, t) {
    const ys = railYs();
    const off = t ? railOffset(t) : 0;
    const target = y + off;
    let best = 0;
    ys.forEach((ry, i) => {
      if (Math.abs(ry - target) < Math.abs(ys[best] - target)) best = i;
    });
    return best;
  }
  function snapToRailY(y, t) {
    if (t.freePlace) return y;
    const ys = railYs();
    const idx = nearestRailIndex(y, t);
    return Math.round(ys[idx] - railOffset(t));
  }
  function clampDevice(d, t) {
    const p = plate();
    const w = deviceWidth(t);
    const h = deviceHeight(t);
    let xMin = p.x + 4;
    let xMax = p.x + p.w - w - 4;
    if (!t.freePlace) {
      const rx = railDrawX();
      const rw = railUsableWidth();
      xMin = Math.max(xMin, rx);
      xMax = Math.min(xMax, rx + rw - w);
      if (xMax < xMin) xMax = xMin;
    }
    let x = Math.max(xMin, Math.min(xMax, d.x));
    if (!t.freePlace) x = snapModuleX(x, w);
    let y = t.freePlace ? d.y : snapToRailY(d.y, t);
    y = Math.max(p.y + 2, Math.min(p.y + p.h - h - 2, y));
    return { x: Math.round(x), y: Math.round(y) };
  }
  function fitsOnRail(t, railIdx, exceptId) {
    if (t.freePlace) return true;
    const w = deviceWidth(t);
    if (w > railUsableWidth() + 0.5) return false;
    if (t.depthMm && t.depthMm > cabinet().depth) return false;
    const used = modulesOnRail(railIdx, exceptId);
    return used + t.modules <= railModules();
  }
  function modulesOnRail(railIdx, exceptId) {
    const ys = railYs();
    let sum = 0;
    state().devices.forEach((d) => {
      if (exceptId && d.id === exceptId) return;
      const t = spec(d.type);
      if (!t || t.freePlace) return;
      if (nearestRailIndex(d.y, t) === railIdx) sum += t.modules;
    });
    return sum;
  }

  /* —— Persistence —— */
  function normalizeWire(w, devices) {
    if (!w || typeof w.id !== 'string' || !/^#[0-9a-f]{6}$/i.test(w.color)) return null;
    const ok = (e) =>
      e && typeof e.id === 'string' && Number.isInteger(e.i) && e.i >= 0 && e.i < 16 && devices.some((x) => x.id === e.id);
    if (!ok(w.a) || !ok(w.b)) return null;
    const bends = Array.isArray(w.bends)
      ? w.bends.filter((b) => b && Number.isFinite(b.x) && Number.isFinite(b.y)).slice(0, 40).map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) }))
      : [];
    const width = Number(w.width);
    return {
      id: w.id,
      a: { id: w.a.id, i: w.a.i },
      b: { id: w.b.id, i: w.b.i },
      color: w.color,
      width: Number.isFinite(width) ? Math.max(1, Math.min(8, width)) : 2.5,
      route: w.route === 'hvh' ? 'hvh' : 'vhv',
      bends
    };
  }
  function validDevice(d, m) {
    return d && typeof d.id === 'string' && spec(d.type) && spec(d.type).modes.includes(m) && typeof d.label === 'string' && typeof d.rating === 'string' && Number.isFinite(d.x) && Number.isFinite(d.y);
  }
  function normalizeCabinet(cab, m) {
    const base = DEFAULT_CAB(m);
    if (!cab || typeof cab !== 'object') return base;
    const num = (v, def, min, max) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
    };
    const out = {
      width: num(cab.width, base.width, 150, 2000),
      height: num(cab.height, base.height, 200, 2500),
      depth: num(cab.depth, base.depth, 60, 800),
      rails: num(cab.rails, base.rails, 1, 12),
      pitch: num(cab.pitch, base.pitch, 80, 300),
      railLengthMm: num(cab.railLengthMm, base.railLengthMm || 0, 0, 2000),
      railYs: Array.isArray(cab.railYs) ? cab.railYs.filter((y) => Number.isFinite(y)).map(Math.round) : null,
      preset: typeof cab.preset === 'string' ? cab.preset : 'custom',
      marginTop: num(cab.marginTop, base.marginTop, 10, 120),
      marginBottom: num(cab.marginBottom, base.marginBottom, 10, 120),
      marginSide: num(cab.marginSide, base.marginSide, 10, 100),
      ductTop: num(cab.ductTop, base.ductTop, 0, 120),
      ductBottom: num(cab.ductBottom, base.ductBottom, 0, 120),
      ductSide: num(cab.ductSide, base.ductSide, 0, 80)
    };
    if (out.railYs && out.railYs.length !== out.rails) out.railYs = null;
    return out;
  }
  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = { version: VERSION, AC: null, DC: null };
    for (const m of ['AC', 'DC']) {
      const block = raw[m];
      if (!block || !Array.isArray(block.devices) || !Array.isArray(block.wires)) return null;
      if (block.devices.length > 200 || block.wires.length > 600) return null;
      const cab = normalizeCabinet(block.cabinet, m);
      const devices = [];
      for (const d of block.devices) {
        if (!validDevice(d, m)) return null;
        devices.push({ id: d.id, type: d.type, label: String(d.label).slice(0, 40), rating: String(d.rating).slice(0, 40), x: d.x, y: d.y });
      }
      const wires = [];
      for (const w of block.wires) {
        const nw = normalizeWire(w, devices);
        if (!nw) return null;
        wires.push(nw);
      }
      // soft clamp into current geometry
      const migrated = devices.map((d) => {
        const t = spec(d.type);
        if (!t) return d;
        const pos = clampDevice(d, t);
        return { ...d, x: pos.x, y: pos.y };
      });
      out[m] = { devices: migrated, wires, cabinet: cab };
    }
    return out;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE));
    const m = migrate(saved);
    if (m) data = m;
  } catch (_) {}

  function checkpoint() {
    history.push(JSON.stringify(data));
    if (history.length > 80) history.shift();
    future = [];
    updateUndoRedo();
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(data));
    } catch (_) {
      $('status').textContent = 'พื้นที่บันทึกเต็ม กรุณาบันทึกเป็น JSON';
    }
  }
  function updateUndoRedo() {
    $('undo').disabled = !history.length;
    $('redo').disabled = !future.length;
  }
  function undo() {
    if (!history.length) return;
    future.push(JSON.stringify(data));
    const m = migrate(JSON.parse(history.pop()));
    if (m) data = m;
    selected = selectedWire = null;
    syncCabinetForm();
    renderCatalog();
    render();
    properties();
    persist();
    updateUndoRedo();
  }
  function redo() {
    if (!future.length) return;
    history.push(JSON.stringify(data));
    const m = migrate(JSON.parse(future.pop()));
    if (m) data = m;
    selected = selectedWire = null;
    syncCabinetForm();
    renderCatalog();
    render();
    properties();
    persist();
    updateUndoRedo();
  }

  /* —— SVG / camera —— */
  function el(tag, attrs = {}, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function applyCamera() {
    const c = cabinet();
    const board = $('board');
    const vw = c.width / cam.zoom;
    const vh = c.height / cam.zoom;
    cam.x = Math.max(-c.width * 0.2, Math.min(c.width * 0.8, cam.x));
    cam.y = Math.max(-c.height * 0.2, Math.min(c.height * 0.8, cam.y));
    board.setAttribute('viewBox', `${cam.x} ${cam.y} ${vw} ${vh}`);
    const scroll = $('stage-scroll');
    const availW = Math.max(280, scroll.clientWidth - 8);
    const availH = Math.max(240, scroll.clientHeight - 8);
    const fit = Math.min(availW / c.width, availH / c.height, 1.8);
    board.style.width = Math.round(c.width * fit) + 'px';
    board.style.height = Math.round(c.height * fit) + 'px';
    $('scale-pill').textContent = `${c.width}×${c.height}×${c.depth} มม. · ${Math.round(cam.zoom * 100)}%`;
    $('rail-count').textContent = c.rails + ' แถว';
  }
  function fitCamera() {
    cam = { zoom: 1, x: 0, y: 0 };
    applyCamera();
  }
  function zoomAt(factor, clientX, clientY) {
    const board = $('board');
    const c = cabinet();
    const before = svgPointFromClient(clientX, clientY);
    cam.zoom = Math.max(0.4, Math.min(4, cam.zoom * factor));
    applyCamera();
    const after = svgPointFromClient(clientX, clientY);
    if (before && after) {
      cam.x += before.x - after.x;
      cam.y += before.y - after.y;
      applyCamera();
    }
  }
  function svgPointFromClient(clientX, clientY) {
    const board = $('board');
    const ctm = board.getScreenCTM();
    if (!ctm) return null;
    const p = board.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    return p.matrixTransform(ctm.inverse());
  }
  function point(e) {
    return svgPointFromClient(e.clientX, e.clientY) || { x: 0, y: 0 };
  }

  /* —— Ports / wires —— */
  function ports(d) {
    const t = spec(d.type);
    if (!t) return [];
    const n = Math.max(1, t.poles | 0);
    const w = deviceWidth(t);
    const h = deviceHeight(t);
    const isBar = !!t.isBar;
    return Array.from({ length: n * 2 }, (_, i) => {
      const col = i % n;
      const top = i < n;
      const x = d.x + ((col + 1) * w) / (n + 1);
      const y = d.y + (top ? 0 : h);
      let label;
      if (isBar) label = t.id.includes('PE') || t.name.includes('PE') ? 'PE' : t.id.includes('N') || t.name.includes('N') ? 'N' : 'B';
      else if (mode === 'AC') {
        if (n === 1) label = 'L';
        else if (n === 2) label = col === 0 ? 'L' : 'N';
        else if (n === 3) label = ['R', 'S', 'T'][col];
        else label = ['R', 'S', 'T', 'N'][col] || String(col + 1);
      } else label = n === 1 ? '+' : col % 2 === 0 ? '+' : '−';
      return { x, y, label, top };
    });
  }
  function endpoint(e) {
    const d = state().devices.find((x) => x.id === e.id);
    return d && ports(d)[e.i];
  }
  function defaultBends(a, b, route) {
    if (!a || !b || Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) return [];
    if (route === 'hvh') {
      const mx = Math.round((a.x + b.x) / 2);
      return [
        { x: mx, y: a.y },
        { x: mx, y: b.y }
      ];
    }
    const my = Math.round((a.y + b.y) / 2);
    return [
      { x: a.x, y: my },
      { x: b.x, y: my }
    ];
  }
  function orthCorner(a, b, prefer) {
    if (a.x === b.x || a.y === b.y) return [];
    return prefer === 'hvh' ? [{ x: b.x, y: a.y }] : [{ x: a.x, y: b.y }];
  }
  function wirePolyline(w) {
    const a = endpoint(w.a);
    const b = endpoint(w.b);
    if (!a || !b) return [];
    const route = w.route === 'hvh' ? 'hvh' : 'vhv';
    const mids = w.bends && w.bends.length ? w.bends : defaultBends(a, b, route);
    const keys = [{ x: a.x, y: a.y }, ...mids.map((p) => ({ x: p.x, y: p.y })), { x: b.x, y: b.y }];
    const out = [keys[0]];
    for (let i = 1; i < keys.length; i++) {
      const prev = out[out.length - 1];
      const cur = keys[i];
      if (prev.x === cur.x && prev.y === cur.y) continue;
      if (prev.x !== cur.x && prev.y !== cur.y) {
        orthCorner(prev, cur, route).forEach((c) => {
          const last = out[out.length - 1];
          if (last.x !== c.x || last.y !== c.y) out.push(c);
        });
      }
      const last = out[out.length - 1];
      if (last.x !== cur.x || last.y !== cur.y) out.push(cur);
    }
    return out;
  }
  function pathD(pts) {
    if (pts.length < 2) return '';
    return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  }
  function bringDeviceFront(id) {
    const arr = state().devices;
    const i = arr.findIndex((d) => d.id === id);
    if (i < 0 || i === arr.length - 1) return;
    const [d] = arr.splice(i, 1);
    arr.push(d);
  }

  /* —— Warnings —— */
  function computeWarnings() {
    const msgs = [];
    const c = cabinet();
    const p = plate();
    const usable = railUsableWidth();
    const maxMods = railModules();
    const rx = railDrawX();
    const ys = railYs();
    const byRail = ys.map(() => 0);
    const layout = autoRailYs();
    for (const d of state().devices) {
      const t = spec(d.type);
      if (!t) continue;
      const w = deviceWidth(t);
      const h = deviceHeight(t);
      if (d.x < p.x - 1 || d.y < p.y - 1 || d.x + w > p.x + p.w + 2 || d.y + h > p.y + p.h + 2) msgs.push(`«${d.label}» อยู่นอกแผ่นติดตั้ง`);
      if (t.depthMm && t.depthMm > c.depth) msgs.push(`«${d.label}» ลึก ${t.depthMm} มม. แต่ตู้ลึก ${c.depth} มม.`);
      if (t.freePlace) continue;
      if (w > usable + 0.5) msgs.push(`«${d.label}» กว้าง ${w} มม. แต่รางยาว ${Math.round(usable)} มม.`);
      else if (d.x < rx - 1 || d.x + w > rx + usable + 1) msgs.push(`«${d.label}» ยื่นนอกราง DIN`);
      const idx = nearestRailIndex(d.y, t);
      byRail[idx] += t.modules;
    }
    byRail.forEach((mods, i) => {
      if (mods > maxMods) msgs.push(`ราง DIN ${String(i + 1).padStart(2, '0')} ใช้ ${mods}/${maxMods} โมดูล (ราง ${Math.round(usable)} มม.)`);
    });
    if (!layout.fitted) msgs.push(`ระยะรางแน่น — ตู้สูง ${c.height} มม. สำหรับ ${c.rails} ราง`);
    return { msgs, byRail, maxMods };
  }

  /* —— Selection UI —— */
  function updateSelActions() {
    const d = selected && state().devices.find((x) => x.id === selected);
    const w = selectedWire && state().wires.find((x) => x.id === selectedWire);
    const has = !!(d || w);
    $('sel-delete').disabled = !has;
    $('sel-route').disabled = !w;
    $('sel-add-bend').disabled = !w;
    $('sel-clear-bends').disabled = !w;
    const chip = $('float-sel');
    chip.classList.toggle('show', has && !(drag && (drag.kind === 'device' || drag.kind === 'catalog')));
    if (d) {
      const t = spec(d.type);
      $('float-label').textContent = d.label + (t ? ` · ${deviceWidth(t)}×${deviceHeight(t)} มม.` : '');
    } else if (w) $('float-label').textContent = `สาย · มุม ${w.bends.length}`;
    else $('float-label').textContent = '—';
  }
  function properties() {
    const d = selected && state().devices.find((x) => x.id === selected);
    const w = selectedWire && state().wires.find((x) => x.id === selectedWire);
    $('props').hidden = !d;
    $('wire-props').hidden = !w;
    $('empty').hidden = !!(d || w);
    if (d) {
      const t = spec(d.type);
      $('label').value = d.label;
      $('rating').value = d.rating;
      $('dev-size').textContent = t
        ? `${deviceWidth(t)} × ${deviceHeight(t)} × ${t.depthMm || '—'} มม. · ${t.modules} โมดูล${t.brand ? ' · ' + t.brand + (t.model ? ' ' + t.model : '') : ''}`
        : '—';
    }
    if (w) {
      fillColorSelect($('wprop-color'), w.color);
      $('wprop-size').value = String(w.width);
      $('wprop-route').value = w.route || 'vhv';
      $('wprop-info').textContent = `จุดเลี้ยว ${w.bends.length} · ลากจากขั้วเพื่อเดินสาย · ลากมุมเพื่อจัดเส้น`;
    }
    updateSelActions();
  }

  /* —— Render —— */
  function render() {
    applyCamera();
    const b = $('board');
    const c = cabinet();
    const p = plate();
    b.replaceChildren();
    const defs = el('defs');
    const pat = el('pattern', { id: 'grid', width: 20, height: 20, patternUnits: 'userSpaceOnUse' });
    pat.append(el('circle', { cx: 1, cy: 1, r: 1.2, fill: '#d5dee4' }));
    defs.append(pat);
    b.append(defs);

    b.append(el('rect', { x: 0, y: 0, width: c.width, height: c.height, fill: '#c5ced4', stroke: '#6d7e88', 'stroke-width': 3, rx: 4, class: 'bg-hit' }));
    b.append(el('rect', { x: 6, y: 6, width: c.width - 12, height: c.height - 12, fill: 'url(#grid)', stroke: '#8a9aa3', class: 'bg-hit' }));

    if (c.ductTop > 0) {
      b.append(el('rect', { class: 'duct', x: c.marginSide, y: c.marginTop, width: c.width - 2 * c.marginSide, height: c.ductTop, rx: 2 }), el('text', { x: c.width / 2, y: c.marginTop + c.ductTop / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#5f717b' }, 'รางสายด้านบน'));
    }
    if (c.ductBottom > 0) {
      const dy = c.height - c.marginBottom - c.ductBottom;
      b.append(el('rect', { class: 'duct', x: c.marginSide, y: dy, width: c.width - 2 * c.marginSide, height: c.ductBottom, rx: 2 }), el('text', { x: c.width / 2, y: dy + c.ductBottom / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#5f717b' }, 'รางสายด้านล่าง'));
    }
    b.append(el('rect', { class: 'plate', x: p.x, y: p.y, width: p.w, height: p.h, rx: 2 }));
    b.append(el('text', { x: p.x + 6, y: p.y + 14, 'font-size': 10, fill: '#7a8b94' }, `แผ่นติดตั้ง ${Math.round(p.w)}×${Math.round(p.h)} มม.`));

    const ys = railYs();
    const rw = railUsableWidth();
    const rx = railDrawX();
    const hlIdx = drag && (drag.kind === 'catalog' || drag.kind === 'device') ? drag.railIdx : -1;
    const hlBad = drag && drag.fit === false;
    ys.forEach((y, i) => {
      const mods = railModules();
      const lenLabel = c.railLengthMm > 0 ? `${Math.round(rw)} มม.` : `เต็มแผ่น ${Math.round(rw)} มม.`;
      if (hlIdx === i) {
        b.append(el('rect', { class: 'rail-hl' + (hlBad ? ' bad' : ''), x: rx - 4, y: y - 28, width: rw + 8, height: 44, rx: 4 }));
      }
      b.append(
        el('text', { x: rx, y: y - 10, fill: '#7d8f98', 'font-size': 10 }, `DIN TS35 ${String(i + 1).padStart(2, '0')} · ${lenLabel} · ${mods} โมดูล`),
        el('rect', { class: 'rail', 'data-rail': String(i), x: rx, y: y, width: rw, height: C.layoutDefaults.railThickness, rx: 1 }),
        el('line', { x1: rx, x2: rx + rw, y1: y + 3, y2: y + 3, stroke: '#f4f8fa', 'stroke-width': 1.5 })
      );
      // invisible fat hit for dragging rail
      const railHit = el('rect', { x: rx, y: y - 10, width: rw, height: 28, fill: 'transparent', class: 'rail-hit', 'data-rail': String(i) });
      railHit.style.cursor = 'ns-resize';
      railHit.addEventListener('pointerdown', (e) => {
        if (tool !== 'move') return;
        e.stopPropagation();
        checkpoint();
        drag = { kind: 'rail', index: i, startY: point(e).y, orig: ys[i] };
        try {
          b.setPointerCapture(e.pointerId);
        } catch (_) {}
      });
      b.append(railHit);
    });

    b.append(el('text', { x: c.width / 2, y: c.height - 8, 'text-anchor': 'middle', 'font-size': 10, fill: '#5c6e77' }, `กว้าง ${c.width} มม.`));

    // Wire visuals
    state().wires.forEach((w) => {
      const pts = wirePolyline(w);
      if (pts.length < 2) return;
      const d = pathD(pts);
      const active = selectedWire === w.id;
      const sw = w.width || 2.5;
      const g = el('g', { class: 'wire-visual', 'pointer-events': 'none' });
      if (active) g.append(el('path', { d, fill: 'none', stroke: '#0a6b5c', 'stroke-width': sw + 4, opacity: 0.35, class: 'wire-path' }));
      g.append(el('path', { d, fill: 'none', stroke: w.color, 'stroke-width': active ? sw + 1 : sw, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'wire-path' }));
      b.append(g);
    });

    // Live wire preview
    if (drag && drag.kind === 'wire' && drag.from) {
      const a = endpoint(drag.from);
      if (a) {
        const to = drag.hover || drag.cur || a;
        const preview = defaultBends(a, to, $('wire-route').value === 'hvh' ? 'hvh' : 'vhv');
        const pts = [{ x: a.x, y: a.y }, ...preview, { x: to.x, y: to.y }];
        // simplify path
        const d = pathD([a, ...orthCorner(a, to, $('wire-route').value), to].filter(Boolean));
        const simple = a.x === to.x || a.y === to.y ? `M${a.x},${a.y} L${to.x},${to.y}` : `M${a.x},${a.y} L${a.x},${to.y} L${to.x},${to.y}`;
        b.append(el('path', { d: simple, fill: 'none', stroke: $('color').value, 'stroke-width': 2.5, 'stroke-dasharray': '6 4', opacity: 0.85, 'pointer-events': 'none' }));
      }
    }

    // Catalog/device ghost on canvas
    if (drag && (drag.kind === 'catalog' || drag.kind === 'device') && drag.ghost) {
      const g = drag.ghost;
      const cls = drag.fit === false ? 'drop-reject' : 'rail-hl';
      b.append(el('rect', { class: cls, x: g.x, y: g.y, width: g.w, height: g.h, rx: 3, 'pointer-events': 'none' }));
    }

    // Devices
    state().devices.forEach((d) => {
      const t = spec(d.type);
      if (!t) return;
      const w = deviceWidth(t);
      const h = deviceHeight(t);
      const g = el('g', { class: 'device' + (t.freePlace ? ' free' : ''), 'data-id': d.id });
      const isSel = selected === d.id;
      const pad = Math.max(2, Math.min(6, 24 - Math.min(w, h) / 2));
      const hit = el('rect', { x: d.x - pad, y: d.y - pad, width: w + pad * 2, height: h + pad * 2, fill: 'transparent', class: 'device-hit' });
      g.append(
        hit,
        el('rect', { x: d.x, y: d.y, width: w, height: h, rx: 3, fill: '#fff', stroke: isSel ? '#0a6b5c' : '#8a9ba4', 'stroke-width': isSel ? 2.5 : 1.2 }),
        el('rect', { x: d.x + 4, y: d.y + h * 0.35, width: Math.max(2, w - 8), height: Math.max(10, h * 0.22), rx: 2, fill: t.isBar ? '#b89a4e' : '#243842' }),
        el('text', { x: d.x + w / 2, y: d.y + Math.min(14, h * 0.28), 'text-anchor': 'middle', 'font-size': Math.max(7, Math.min(11, w / 5)), fill: '#1a3038' }, d.label.slice(0, 14)),
        el('text', { x: d.x + w / 2, y: d.y + h - 6, 'text-anchor': 'middle', 'font-size': Math.max(6, Math.min(9, w / 6)), fill: '#6d7f88' }, d.rating.slice(0, 16))
      );
      g.querySelectorAll('rect:not(.device-hit), text').forEach((n) => {
        n.style.pointerEvents = 'none';
      });

      hit.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        selectedWire = null;
        selected = d.id;
        bringDeviceFront(d.id);
        const pt = point(e);
        if (tool === 'move' || e.shiftKey) {
          checkpoint();
          drag = {
            kind: 'device',
            id: d.id,
            dx: pt.x - d.x,
            dy: pt.y - d.y,
            origX: d.x,
            origY: d.y,
            railIdx: nearestRailIndex(d.y, t),
            fit: true,
            ghost: { x: d.x, y: d.y, w, h }
          };
          showTrash(true);
          try {
            b.setPointerCapture(e.pointerId);
          } catch (_) {}
        }
        properties();
        render();
      });

      ports(d).forEach((pt) => {
        g.append(el('text', { x: pt.x, y: pt.y + (pt.top ? 11 : -5), 'text-anchor': 'middle', 'font-size': Math.max(6, Math.min(9, w / (t.poles + 2))), fill: '#6a7c86', style: 'pointer-events:none' }, pt.label));
      });
      b.append(g);
    });

    // Wire hits + bends above devices
    state().wires.forEach((w) => {
      const pts = wirePolyline(w);
      if (pts.length < 2) return;
      const d = pathD(pts);
      const active = selectedWire === w.id;
      const sw = w.width || 2.5;
      const g = el('g', { class: 'wire-interact' });
      const hit = el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(16, sw + 14), 'stroke-linejoin': 'round', class: 'wire-hit' });
      hit.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        selected = null;
        selectedWire = w.id;
        properties();
        render();
      });
      hit.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        addBendAtPointer(w, point(e));
      });
      hit.addEventListener('pointerup', (e) => {
        if (selectedWire !== w.id) return;
        const now = Date.now();
        if (now - lastBendTap < 350) {
          addBendAtPointer(w, point(e));
          lastBendTap = 0;
        } else lastBendTap = now;
      });
      g.append(hit);
      if (active) {
        const handles = w.bends.length ? w.bends : defaultBends(endpoint(w.a), endpoint(w.b), w.route || 'vhv');
        handles.forEach((bp, i) => {
          const h = el('circle', { cx: bp.x, cy: bp.y, r: 8, class: 'bend-handle' });
          h.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            checkpoint();
            if (!w.bends.length) w.bends = handles.map((p) => ({ x: p.x, y: p.y }));
            drag = { kind: 'bend', wireId: w.id, index: i };
            try {
              b.setPointerCapture(e.pointerId);
            } catch (_) {}
            render();
          });
          h.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            checkpoint();
            if (!w.bends.length) return;
            w.bends.splice(i, 1);
            render();
            properties();
            persist();
          });
          g.append(h);
        });
      }
      b.append(g);
    });

    // Terminals on top (large for touch)
    state().devices.forEach((d) => {
      const t = spec(d.type);
      if (!t) return;
      ports(d).forEach((pt, i) => {
        const hot = drag && drag.kind === 'wire' && drag.hover && drag.hover.id === d.id && drag.hover.i === i;
        const r = Math.max(7, Math.min(10, Math.max(deviceWidth(t), deviceHeight(t)) / 10));
        const circle = el('circle', {
          cx: pt.x,
          cy: pt.y,
          r: hot ? r + 2 : r,
          fill: hot ? '#f0aa31' : '#dfe6ea',
          stroke: hot ? '#0a6b5c' : '#5a6d77',
          'stroke-width': 1.8,
          class: 'terminal',
          'data-dev': d.id,
          'data-port': String(i)
        });
        circle.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          checkpoint();
          selected = null;
          selectedWire = null;
          drag = { kind: 'wire', from: { id: d.id, i }, cur: { x: pt.x, y: pt.y }, hover: null };
          try {
            b.setPointerCapture(e.pointerId);
          } catch (_) {}
          $('status').textContent = 'ลากไปยังขั้วปลายทาง';
          properties();
          render();
        });
        b.append(circle);
      });
    });

    const { msgs, byRail, maxMods } = computeWarnings();
    $('count').textContent = state().devices.length;
    $('wcount').textContent = state().wires.length;
    $('mod-use').textContent = byRail.map((m) => `${m}/${maxMods}`).join(' · ') || '—';
    const counts = {};
    state().devices.forEach((d) => {
      counts[d.type] = (counts[d.type] || 0) + 1;
    });
    $('bom').textContent = Object.entries(counts)
      .map(([k, v]) => `${(spec(k) || {}).name || k} × ${v}`)
      .join(' · ');
    const warn = $('warnings');
    if (msgs.length) {
      warn.classList.add('show');
      warn.innerHTML = '<strong>เตือน:</strong> ' + msgs.slice(0, 3).join(' · ');
    } else {
      warn.classList.remove('show');
      warn.textContent = '';
    }
    updateSelActions();
    updateUndoRedo();
  }

  function findTerminalAt(pt, exclude) {
    let best = null;
    let bestDist = 16;
    state().devices.forEach((d) => {
      ports(d).forEach((p, i) => {
        if (exclude && exclude.id === d.id && exclude.i === i) return;
        const dist = Math.hypot(p.x - pt.x, p.y - pt.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = { id: d.id, i, x: p.x, y: p.y };
        }
      });
    });
    return best;
  }

  function addBendAtPointer(w, pt) {
    checkpoint();
    const a = endpoint(w.a);
    const b = endpoint(w.b);
    if (!a || !b) return;
    if (!w.bends.length) w.bends = defaultBends(a, b, w.route || 'vhv');
    const nx = Math.round(pt.x);
    const ny = Math.round(pt.y);
    if (w.bends.some((bp) => Math.hypot(bp.x - nx, bp.y - ny) < 4)) return;
    w.bends.push({ x: nx, y: ny });
    selectedWire = w.id;
    selected = null;
    render();
    properties();
    persist();
  }

  function addDevice(type, x, y, skipCheckpoint) {
    const t = spec(type);
    if (!t || !t.modes.includes(mode)) return null;
    if (!skipCheckpoint) checkpoint();
    const pos = clampDevice({ x, y }, t);
    const railIdx = nearestRailIndex(pos.y, t);
    if (!t.freePlace && !fitsOnRail(t, railIdx)) {
      // still place but warn
    }
    const d = {
      id: crypto.randomUUID(),
      type,
      label: t.nameTh || t.name,
      rating: t.ratingDefault || 'ระบุพิกัด',
      x: pos.x,
      y: pos.y
    };
    state().devices.push(d);
    selected = d.id;
    selectedWire = null;
    render();
    properties();
    persist();
    $('status').textContent = `วาง ${t.nameTh || t.name} แล้ว`;
    return d;
  }

  /* —— Ghost helpers —— */
  function ensureDomGhost(label, bad) {
    if (!ghostEl) {
      ghostEl = document.createElement('div');
      ghostEl.className = 'drag-ghost';
      document.body.appendChild(ghostEl);
    }
    ghostEl.textContent = label;
    ghostEl.classList.toggle('bad', !!bad);
    return ghostEl;
  }
  function moveDomGhost(clientX, clientY) {
    if (!ghostEl) return;
    ghostEl.style.left = clientX + 'px';
    ghostEl.style.top = clientY + 'px';
  }
  function clearDomGhost() {
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }
  }
  function showTrash(on) {
    $('trash-zone').classList.toggle('show', !!on);
    if (!on) $('trash-zone').classList.remove('hot');
  }
  function overTrash(clientX, clientY) {
    const z = $('trash-zone');
    if (!z.classList.contains('show')) return false;
    const r = z.getBoundingClientRect();
    return clientX >= r.left - 8 && clientX <= r.right + 8 && clientY >= r.top - 8 && clientY <= r.bottom + 8;
  }

  /* —— Pointer move/up (board capture) —— */
  function onBoardMove(e) {
    if (!drag) return;
    const pt = point(e);
    if (drag.kind === 'device') {
      const d = state().devices.find((x) => x.id === drag.id);
      const t = spec(d.type);
      let x = pt.x - drag.dx;
      let y = pt.y - drag.dy;
      const railIdx = nearestRailIndex(y, t);
      const preview = clampDevice({ x, y }, t);
      drag.ghost = { x: preview.x, y: preview.y, w: deviceWidth(t), h: deviceHeight(t) };
      drag.railIdx = railIdx;
      drag.fit = t.freePlace || (fitsOnRail(t, railIdx, d.id) && deviceWidth(t) <= railUsableWidth());
      // live position (revert on drop if !fit)
      d.x = preview.x;
      d.y = t.freePlace ? Math.max(plate().y + 2, Math.min(plate().y + plate().h - deviceHeight(t) - 2, y)) : preview.y;
      const trash = overTrash(e.clientX, e.clientY);
      $('trash-zone').classList.toggle('hot', trash);
      drag.toTrash = trash;
      render();
    } else if (drag.kind === 'catalog') {
      const t = spec(drag.type);
      const x = pt.x - deviceWidth(t) / 2;
      const y = pt.y - deviceHeight(t) / 2;
      const preview = clampDevice({ x, y }, t);
      const railIdx = nearestRailIndex(preview.y, t);
      drag.ghost = { x: preview.x, y: preview.y, w: deviceWidth(t), h: deviceHeight(t) };
      drag.railIdx = railIdx;
      drag.fit = t.freePlace || fitsOnRail(t, railIdx);
      drag.overBoard = pt.x >= 0 && pt.y >= 0 && pt.x <= cabinet().width && pt.y <= cabinet().height;
      moveDomGhost(e.clientX, e.clientY);
      ensureDomGhost(t.nameTh || t.name, !drag.fit);
      render();
    } else if (drag.kind === 'wire') {
      drag.cur = pt;
      drag.hover = findTerminalAt(pt, drag.from);
      render();
    } else if (drag.kind === 'bend') {
      const w = state().wires.find((x) => x.id === drag.wireId);
      if (!w || !w.bends[drag.index]) return;
      w.bends[drag.index] = { x: Math.round(pt.x), y: Math.round(pt.y) };
      // drag off far → mark remove
      drag.remove = pt.x < -20 || pt.y < -20 || pt.x > cabinet().width + 20 || pt.y > cabinet().height + 20;
      render();
    } else if (drag.kind === 'rail') {
      const ys = railYs();
      const p = plate();
      let ny = Math.round(drag.orig + (pt.y - drag.startY));
      ny = Math.max(p.y + 40, Math.min(p.y + p.h - 40, ny));
      ys[drag.index] = ny;
      // keep devices on this rail glued
      const oldY = drag.orig;
      state().devices.forEach((d) => {
        const t = spec(d.type);
        if (!t || t.freePlace) return;
        if (nearestRailIndex(d.y, t) === drag.index || Math.abs(d.y + railOffset(t) - oldY) < 20) {
          d.y = snapToRailY(ny - railOffset(t), t);
        }
      });
      drag.orig = ny;
      drag.startY = pt.y;
      render();
    } else if (drag.kind === 'pan') {
      const c = cabinet();
      const dx = (e.clientX - drag.cx) / (drag.fitPx / c.width) / cam.zoom;
      const dy = (e.clientY - drag.cy) / (drag.fitPx / c.width) / cam.zoom;
      cam.x = drag.ox - dx;
      cam.y = drag.oy - dy;
      drag.cx = e.clientX;
      drag.cy = e.clientY;
      drag.ox = cam.x;
      drag.oy = cam.y;
      applyCamera();
    }
  }

  function onBoardUp(e) {
    if (!drag) return;
    const kind = drag.kind;
    if (kind === 'device') {
      const d = state().devices.find((x) => x.id === drag.id);
      if (drag.toTrash) {
        state().devices = state().devices.filter((x) => x.id !== drag.id);
        state().wires = state().wires.filter((w) => w.a.id !== drag.id && w.b.id !== drag.id);
        selected = null;
        $('status').textContent = 'ลบอุปกรณ์แล้ว';
      } else if (d && drag.fit === false) {
        d.x = drag.origX;
        d.y = drag.origY;
        $('status').textContent = 'ย้ายไม่ได้ — รางไม่พอ';
      } else if (d) {
        const t = spec(d.type);
        const pos = clampDevice(d, t);
        d.x = pos.x;
        d.y = pos.y;
      }
      showTrash(false);
      clearDomGhost();
      drag = null;
      render();
      properties();
      persist();
    } else if (kind === 'catalog') {
      const t = spec(drag.type);
      const over = drag.overBoard;
      const fit = drag.fit;
      const g = drag.ghost;
      clearDomGhost();
      showTrash(false);
      if (over && fit && g) {
        addDevice(drag.type, g.x, g.y);
        if (window.matchMedia('(max-width:900px)').matches) setMobileTab('board');
      } else if (over && !fit) {
        $('status').textContent = 'วางไม่ได้ — รางไม่พอหรือลึกเกินตู้';
      } else {
        $('status').textContent = 'ยกเลิกการวาง';
      }
      drag = null;
      render();
    } else if (kind === 'wire') {
      const from = drag.from;
      const to = drag.hover || findTerminalAt(point(e), from);
      drag = null;
      if (to && !(to.id === from.id && to.i === from.i)) {
        if (to.id === from.id) {
          $('status').textContent = 'เลือกขั้วของอุปกรณ์อีกตัว';
        } else {
          state().wires.push({
            id: crypto.randomUUID(),
            a: { id: from.id, i: from.i },
            b: { id: to.id, i: to.i },
            color: $('color').value,
            width: parseFloat($('wire-size').value) || 2.5,
            route: $('wire-route').value === 'hvh' ? 'hvh' : 'vhv',
            bends: []
          });
          selectedWire = state().wires[state().wires.length - 1].id;
          selected = null;
          $('status').textContent = 'เชื่อมสายแล้ว · ลากมุมเลี้ยวได้';
          persist();
        }
      } else {
        // restore checkpoint if cancelled? keep checkpoint as no-op undo of empty
        $('status').textContent = 'ยกเลิกการเดินสาย';
      }
      render();
      properties();
    } else if (kind === 'bend') {
      const w = state().wires.find((x) => x.id === drag.wireId);
      if (w && drag.remove && w.bends.length) {
        w.bends.splice(drag.index, 1);
        $('status').textContent = 'ลบมุมเลี้ยวแล้ว';
      }
      drag = null;
      render();
      properties();
      persist();
    } else if (kind === 'rail') {
      drag = null;
      render();
      persist();
    } else if (kind === 'pan') {
      drag = null;
    } else {
      drag = null;
    }
  }

  /* —— Catalog drag (pointer + long-press) —— */
  function bindCatalogPart(btn, typeId) {
    let pressTimer = null;
    let startX = 0;
    let startY = 0;
    let armed = false;
    let tracking = false;
    let pointerId = null;

    const addAtSlot = () => {
      const t = spec(typeId);
      if (!t) return;
      const pos = findOpenSlot(t);
      addDevice(typeId, pos.x, pos.y);
      if (window.matchMedia('(max-width:900px)').matches) setMobileTab('board');
    };

    const startCatalogDrag = (e) => {
      if (armed) return;
      const t = spec(typeId);
      if (!t) return;
      armed = true;
      tracking = false;
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      checkpoint();
      drag = {
        kind: 'catalog',
        type: typeId,
        fit: true,
        overBoard: false,
        railIdx: 0,
        ghost: null
      };
      ensureDomGhost(t.nameTh || t.name, false);
      moveDomGhost(e.clientX, e.clientY);
      showTrash(false);
      $('status').textContent = 'ลากลงราง DIN แล้วปล่อย · ออกนอกตู้ = ยกเลิก';
      window.addEventListener('pointermove', onCatalogWindowMove);
      window.addEventListener('pointerup', onCatalogWindowUp);
      window.addEventListener('pointercancel', onCatalogWindowUp);
    };

    const onCatalogWindowMove = (e) => {
      if (!drag || drag.kind !== 'catalog') return;
      if (pointerId != null && e.pointerId !== pointerId) return;
      moveDomGhost(e.clientX, e.clientY);
      const board = $('board');
      const rect = board.getBoundingClientRect();
      const over = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (over) {
        const pt = svgPointFromClient(e.clientX, e.clientY);
        if (pt) {
          const t = spec(drag.type);
          const x = pt.x - deviceWidth(t) / 2;
          const y = pt.y - deviceHeight(t) / 2;
          const preview = clampDevice({ x, y }, t);
          const railIdx = nearestRailIndex(preview.y, t);
          drag.ghost = { x: preview.x, y: preview.y, w: deviceWidth(t), h: deviceHeight(t) };
          drag.railIdx = railIdx;
          drag.fit = t.freePlace || fitsOnRail(t, railIdx);
          drag.overBoard = true;
          ensureDomGhost(t.nameTh || t.name, !drag.fit);
          render();
        }
      } else {
        drag.overBoard = false;
        drag.ghost = null;
        render();
      }
    };

    const onCatalogWindowUp = (e) => {
      if (pointerId != null && e.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onCatalogWindowMove);
      window.removeEventListener('pointerup', onCatalogWindowUp);
      window.removeEventListener('pointercancel', onCatalogWindowUp);
      if (drag && drag.kind === 'catalog') onBoardUp(e);
      armed = false;
      tracking = false;
      pointerId = null;
    };

    const onTrackMove = (e) => {
      if (!tracking || armed) return;
      if (pointerId != null && e.pointerId !== pointerId) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_THRESH) {
        // touch: cancel long-press if finger moves (allow scroll)
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
          tracking = false;
          window.removeEventListener('pointermove', onTrackMove);
          window.removeEventListener('pointerup', onTrackUp);
          window.removeEventListener('pointercancel', onTrackUp);
          return;
        }
        // desktop: move past threshold → start drag
        window.removeEventListener('pointermove', onTrackMove);
        window.removeEventListener('pointerup', onTrackUp);
        window.removeEventListener('pointercancel', onTrackUp);
        startCatalogDrag(e);
      }
    };

    const onTrackUp = (e) => {
      if (pointerId != null && e.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onTrackMove);
      window.removeEventListener('pointerup', onTrackUp);
      window.removeEventListener('pointercancel', onTrackUp);
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      // tap / click without drag → add at open slot
      if (!armed && tracking) addAtSlot();
      tracking = false;
      pointerId = null;
    };

    btn.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      pointerId = e.pointerId;
      armed = false;
      tracking = true;
      const isTouch = e.pointerType === 'touch';
      if (isTouch) {
        pressTimer = setTimeout(() => {
          pressTimer = null;
          startCatalogDrag(e);
        }, LONG_PRESS_MS);
      }
      window.addEventListener('pointermove', onTrackMove);
      window.addEventListener('pointerup', onTrackUp);
      window.addEventListener('pointercancel', onTrackUp);
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
    });
  }

  function findOpenSlot(t) {
    const p = plate();
    const w = deviceWidth(t);
    const h = deviceHeight(t);
    const ys = t.freePlace ? [p.y + 20, p.y + p.h / 2] : railYs().map((ry) => ry - railOffset(t));
    const x0 = t.freePlace ? p.x + 8 : railDrawX();
    const xLim = t.freePlace ? p.x + p.w - 4 : railDrawX() + railUsableWidth();
    for (const y0 of ys) {
      for (let x = x0; x + w <= xLim; x += MODULE) {
        const pos = clampDevice({ x, y: y0 }, t);
        const overlap = state().devices.some((d) => {
          const dt = spec(d.type);
          if (!dt) return false;
          const dw = deviceWidth(dt);
          const dh = deviceHeight(dt);
          return !(pos.x + w + 4 <= d.x || d.x + dw + 4 <= pos.x || pos.y + h + 4 <= d.y || d.y + dh + 4 <= pos.y);
        });
        if (!overlap) return pos;
      }
    }
    return clampDevice({ x: x0, y: ys[0] }, t);
  }

  /* —— Catalog / forms —— */
  function renderCatalog() {
    const filter = $('cat-filter');
    filter.replaceChildren();
    const cats = ['all', ...new Set(devicesFor(mode).map((d) => d.cat))];
    cats.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = c === 'all' ? 'ทั้งหมด' : C.categories[c] || c;
      b.classList.toggle('active', catFilter === c);
      b.onclick = () => {
        catFilter = c;
        renderCatalog();
      };
      filter.append(b);
    });
    const box = $('catalog');
    box.replaceChildren();
    devicesFor(mode)
      .filter((t) => catFilter === 'all' || t.cat === catFilter)
      .forEach((t) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'part';
        b.dataset.type = t.id;
        const brand = t.brand ? `${t.brand}${t.model ? ' · ' + t.model : ''} · ` : '';
        b.innerHTML = `<span class="icon">${t.icon || '▥'}</span><span><strong>${t.nameTh || t.name}</strong><small>${brand}${t.hint || ''} · ${deviceWidth(t)}×${deviceHeight(t)}×${t.depthMm || '—'} มม.</small></span>`;
        bindCatalogPart(b, t.id);
        box.append(b);
      });
  }

  function fillColorSelect(sel, current) {
    sel.replaceChildren();
    WIRE_COLORS[mode].forEach(([v, n]) => sel.add(new Option(n, v)));
    if (current && ![...sel.options].some((o) => o.value.toLowerCase() === current.toLowerCase())) sel.add(new Option(current, current));
    if (current) sel.value = [...sel.options].find((o) => o.value.toLowerCase() === current.toLowerCase())?.value || current;
  }
  function renderColorChips() {
    const box = $('color-chips');
    box.replaceChildren();
    WIRE_COLORS[mode].forEach(([v, n]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = n;
      b.style.background = v;
      b.classList.toggle('active', $('color').value === v);
      b.onclick = () => {
        $('color').value = v;
        renderColorChips();
        if (selectedWire) {
          const w = state().wires.find((x) => x.id === selectedWire);
          if (w) {
            checkpoint();
            w.color = v;
            render();
            persist();
          }
        }
      };
      box.append(b);
    });
    $('legend').textContent = WIRE_COLORS[mode].map((x) => x[1]).join('  /  ');
  }

  function fillRailLengthSelect() {
    const sel = $('rail-length');
    const cur = cabinet().railLengthMm || 0;
    sel.replaceChildren();
    sel.add(new Option('เต็มแผ่นติดตั้ง', '0'));
    (C.dinRail?.lengthsMm || []).forEach((mm) => {
      sel.add(new Option(`TS35 · ${mm / 10} ซม. (~${Math.floor(mm / MODULE)} โมดูล)`, String(mm)));
    });
    sel.add(new Option('กำหนดเอง…', 'custom'));
    const match = [...sel.options].some((o) => o.value === String(cur));
    if (cur > 0 && !match) {
      sel.value = 'custom';
      $('rail-length-custom').value = cur;
    } else {
      sel.value = String(cur);
      if (cur > 0) $('rail-length-custom').value = cur;
    }
    updateRailModInfo();
  }
  function updateRailModInfo() {
    const mm = railUsableWidth();
    $('rail-mod-info').textContent = `${railModules()} โมดูล · ${Math.round(mm)} มม.`;
  }
  function syncCabinetForm() {
    const c = cabinet();
    $('cab-w').value = c.width;
    $('cab-h').value = c.height;
    $('cab-d').value = c.depth;
    $('cab-rails').value = c.rails;
    $('cab-pitch').value = c.pitch;
    const sel = $('preset');
    sel.value = [...sel.options].some((o) => o.value === c.preset) ? c.preset : 'custom';
    fillRailLengthSelect();
  }
  function applyRailLengthFromForm() {
    const c = cabinet();
    const v = $('rail-length').value;
    if (v === 'custom') {
      c.railLengthMm = Math.max(50, Math.min(2000, +$('rail-length-custom').value || 100));
      $('rail-length-custom').value = c.railLengthMm;
    } else c.railLengthMm = Math.max(0, +v || 0);
    updateRailModInfo();
  }
  function applyCabinetFromForm(fromPreset) {
    checkpoint();
    const c = cabinet();
    if (fromPreset) {
      const p = C.presets.find((x) => x.id === $('preset').value);
      if (p && p.id !== 'custom') {
        Object.assign(c, cabinetFromPreset(p));
        syncCabinetForm();
      } else c.preset = 'custom';
    } else {
      c.width = Math.max(150, Math.min(2000, +$('cab-w').value || c.width));
      c.height = Math.max(200, Math.min(2500, +$('cab-h').value || c.height));
      c.depth = Math.max(60, Math.min(800, +$('cab-d').value || c.depth));
      c.rails = Math.max(1, Math.min(12, +$('cab-rails').value || c.rails));
      c.pitch = Math.max(80, Math.min(300, +$('cab-pitch').value || c.pitch));
      applyRailLengthFromForm();
      c.railYs = null;
      c.preset = 'custom';
      $('preset').value = 'custom';
    }
    ensureRailYs();
    state().devices = state().devices.map((d) => {
      const t = spec(d.type);
      return t ? { ...d, ...clampDevice(d, t) } : d;
    });
    fitCamera();
    render();
    persist();
    updateRailModInfo();
  }
  function fillPresets() {
    const sel = $('preset');
    sel.replaceChildren();
    C.presets
      .filter((p) => !p.mode || p.mode === mode || p.id === 'custom')
      .forEach((p) => {
        let label = p.id === 'custom' ? p.name : p.brand ? `${p.brand} ${p.model || p.name} (${p.w}×${p.d}×${p.h} · ก×ล×ส)` : `${p.name} (${p.w}×${p.h}×${p.d})`;
        sel.add(new Option(label, p.id));
      });
  }
  function setMode(m) {
    mode = m;
    selected = selectedWire = null;
    catFilter = 'all';
    ['AC', 'DC'].forEach((x) => $(x.toLowerCase()).classList.toggle('active', x === m));
    $('title').textContent = m === 'AC' ? 'ตู้ Consumer / Control' : 'ตู้ Solar Combiner';
    $('subtitle').textContent = 'ลากวางเต็มรูปแบบ · มาตราส่วน มม.';
    fillPresets();
    syncCabinetForm();
    renderCatalog();
    fillColorSelect($('color'));
    fillColorSelect($('wprop-color'));
    if (!$('color').value) $('color').value = WIRE_COLORS[m][0][0];
    renderColorChips();
    fitCamera();
    render();
    properties();
  }

  function removeSelected() {
    if (selectedWire) {
      checkpoint();
      state().wires = state().wires.filter((w) => w.id !== selectedWire);
      selectedWire = null;
    } else if (selected) {
      checkpoint();
      state().devices = state().devices.filter((d) => d.id !== selected);
      state().wires = state().wires.filter((w) => w.a.id !== selected && w.b.id !== selected);
      selected = null;
    } else return;
    render();
    properties();
    persist();
  }

  /* —— Board pan / zoom / empty click —— */
  const board = $('board');
  board.addEventListener('pointerdown', (e) => {
    if (e.target.classList?.contains('bg-hit') || e.target.classList?.contains('plate') || e.target.classList?.contains('duct')) {
      if (tool === 'move' || e.button === 1 || e.altKey) {
        const c = cabinet();
        const fitPx = parseFloat(board.style.width) || board.getBoundingClientRect().width;
        drag = { kind: 'pan', cx: e.clientX, cy: e.clientY, ox: cam.x, oy: cam.y, fitPx };
        try {
          board.setPointerCapture(e.pointerId);
        } catch (_) {}
      } else {
        selected = selectedWire = null;
        properties();
        render();
      }
    }
  });
  board.addEventListener('pointermove', onBoardMove);
  board.addEventListener('pointerup', onBoardUp);
  board.addEventListener('pointercancel', onBoardUp);
  board.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
    },
    { passive: false }
  );

  // Pinch zoom
  board.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  board.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && (!drag || drag.kind === 'pan' || drag.kind === 'pinch')) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      if (!drag || drag.kind !== 'pinch') {
        drag = { kind: 'pinch', dist, midX, midY };
      } else if (drag.dist > 0) {
        zoomAt(dist / drag.dist, midX, midY);
        drag.dist = dist;
      }
    }
  });
  board.addEventListener('pointerup', (e) => {
    pointers.delete(e.pointerId);
    if (drag && drag.kind === 'pinch' && pointers.size < 2) drag = null;
  });
  board.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId);
  });

  /* —— UI bindings —— */
  ['move', 'wire'].forEach((tName) => {
    $(tName).onclick = () => {
      tool = tName;
      ['move', 'wire'].forEach((x) => $(x).classList.toggle('active', x === tName));
      $('status').textContent = tName === 'wire' ? 'ลากจากขั้วหนึ่งไปอีกขั้ว · หรือจัดวางได้จากโหมดจัดวางเช่นกัน' : 'ลากอุปกรณ์/ราง · ลากขั้วเพื่อเดินสาย · ลากพื้นว่างเพื่อเลื่อนมุมมอง';
    };
  });
  $('ac').onclick = () => setMode('AC');
  $('dc').onclick = () => setMode('DC');
  $('undo').onclick = undo;
  $('redo').onclick = redo;
  $('remove').onclick = removeSelected;
  $('remove-wire').onclick = removeSelected;
  $('sel-delete').onclick = removeSelected;
  $('float-delete').onclick = removeSelected;
  $('sel-route').onclick = () => {
    const w = state().wires.find((x) => x.id === selectedWire);
    if (!w) return;
    checkpoint();
    w.route = w.route === 'hvh' ? 'vhv' : 'hvh';
    w.bends = [];
    render();
    properties();
    persist();
  };
  $('sel-add-bend').onclick = () => {
    const w = state().wires.find((x) => x.id === selectedWire);
    if (!w) return;
    const pts = wirePolyline(w);
    addBendAtPointer(w, pts[Math.floor(pts.length / 2)] || { x: 0, y: 0 });
  };
  $('sel-clear-bends').onclick = () => {
    const w = state().wires.find((x) => x.id === selectedWire);
    if (!w) return;
    checkpoint();
    w.bends = [];
    render();
    properties();
    persist();
  };
  ['label', 'rating'].forEach((k) => {
    $(k).onchange = () => {
      const d = state().devices.find((x) => x.id === selected);
      if (!d) return;
      checkpoint();
      d[k] = $(k).value;
      render();
      persist();
    };
  });
  $('wprop-color').onchange = () => {
    const w = state().wires.find((x) => x.id === selectedWire);
    if (!w) return;
    checkpoint();
    w.color = $('wprop-color').value;
    $('color').value = w.color;
    renderColorChips();
    render();
    persist();
  };
  $('wprop-size').onchange = () => {
    const w = state().wires.find((x) => x.id === selectedWire);
    if (!w) return;
    checkpoint();
    w.width = parseFloat($('wprop-size').value) || 2.5;
    render();
    persist();
  };
  $('wprop-route').onchange = () => {
    const w = state().wires.find((x) => x.id === selectedWire);
    if (!w) return;
    checkpoint();
    w.route = $('wprop-route').value === 'hvh' ? 'hvh' : 'vhv';
    w.bends = [];
    render();
    properties();
    persist();
  };

  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeSelected();
    }
    if (e.key === 'Escape') {
      drag = null;
      clearDomGhost();
      showTrash(false);
      selected = selectedWire = null;
      properties();
      render();
    }
  });

  $('clear').onclick = () => {
    if (!confirm('ล้างอุปกรณ์และสายในโหมด ' + mode + '?')) return;
    checkpoint();
    const cab = cabinet();
    data[mode] = { devices: [], wires: [], cabinet: { ...cab, railYs: null } };
    selected = selectedWire = null;
    render();
    properties();
    persist();
  };
  $('preset').onchange = () => applyCabinetFromForm(true);
  ['cab-w', 'cab-h', 'cab-d', 'cab-rails', 'cab-pitch'].forEach((id) => {
    $(id).onchange = () => applyCabinetFromForm(false);
  });
  $('rail-length').onchange = () => {
    if ($('rail-length').value === 'custom' && !$('rail-length-custom').value) $('rail-length-custom').value = '100';
    applyCabinetFromForm(false);
  };
  $('rail-length-custom').onchange = () => {
    $('rail-length').value = 'custom';
    applyCabinetFromForm(false);
  };
  const fit = () => {
    fitCamera();
    render();
  };
  $('zoom-fit').onclick = fit;
  $('zoom-fit2').onclick = fit;
  $('zoom-in').onclick = () => {
    const r = board.getBoundingClientRect();
    zoomAt(1.15, r.left + r.width / 2, r.top + r.height / 2);
  };
  $('zoom-out').onclick = () => {
    const r = board.getBoundingClientRect();
    zoomAt(1 / 1.15, r.left + r.width / 2, r.top + r.height / 2);
  };

  function download(name, content, type) {
    const u = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  $('save').onclick = () => download('panel-studio.json', JSON.stringify(data, null, 2), 'application/json');
  $('export').onclick = () => {
    const c = cabinet();
    const s = board.cloneNode(true);
    s.setAttribute('xmlns', NS);
    s.setAttribute('width', String(c.width));
    s.setAttribute('height', String(c.height));
    s.setAttribute('viewBox', `0 0 ${c.width} ${c.height}`);
    s.querySelectorAll('.wire-hit,.bend-handle,.device-hit,.rail-hit,.rail-hl,.drop-reject').forEach((n) => n.remove());
    download('panel-' + mode + '.svg', new XMLSerializer().serializeToString(s), 'image/svg+xml');
  };
  $('open').onclick = () => $('file').click();
  $('file').onchange = async () => {
    try {
      const f = $('file').files[0];
      if (!f || f.size > 2e6) throw new Error();
      const m = migrate(JSON.parse(await f.text()));
      if (!m) throw new Error();
      checkpoint();
      data = m;
      selected = selectedWire = null;
      fillPresets();
      syncCabinetForm();
      renderCatalog();
      fitCamera();
      render();
      properties();
      persist();
      $('status').textContent = 'เปิดแบบเรียบร้อย';
    } catch (_) {
      $('status').textContent = 'ไฟล์ไม่ถูกต้อง';
    }
    $('file').value = '';
  };

  function setMobileTab(tab) {
    document.querySelectorAll('.mobile-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('panel-catalog').classList.toggle('open', tab === 'catalog');
    $('panel-props').classList.toggle('open', tab === 'props');
    if (tab === 'board') render();
  }
  document.querySelectorAll('.mobile-tabs button').forEach((b) => {
    b.onclick = () => setMobileTab(b.dataset.tab);
  });

  window.addEventListener('resize', () => {
    applyCamera();
    render();
  });

  setMode('AC');
})();
