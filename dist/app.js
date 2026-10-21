/* Panel Studio v8 — octilinear wires · plate-mounted terminal busbar */
(() => {
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const C = window.PANEL_CATALOG;
  const MODULE = C.MODULE_MM;
  const STORAGE = 'panel-studio-v1';
  const VERSION = 8;
  const LONG_PRESS_MS = 380;
  const MOVE_THRESH = 8;
  const CORNER_HOLD_MS = 400;
  const RDP_MIGRATE_EPS = 8;
  const GRID = 2.5;
  const TERM_SNAP = 22;
  const ROUTES = ['free', 'vhv', 'hvh', 'straight'];
  const DEG45 = Math.PI / 4;
  /** Terminal busbar (plate-mounted N/PE bar) — real-ish mm */
  const TBAR = {
    pitch: 8.5,
    sectionW: 6,
    sectionH: 9,
    footW: 14,
    footLen: 20,
    height: 25,
    endInset: 5,
    minHoles: 4,
    maxHoles: 16,
    presets: [4, 6, 8, 10, 12, 14, 16]
  };

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
  let wireSketch = null; // polyline sketch: { from, corners, lastTapMs }

  /* —— Catalog helpers —— */
  const devicesFor = (m) => C.devices.filter((d) => d.modes.includes(m));
  const spec = (type) => C.devices.find((d) => d.id === type);
  const isTerminalBar = (t) => !!(t && t.isTerminalBar);
  function barRole(d, t) {
    const r = (d && d.role) || (t && t.roleDefault) || 'N';
    return r === 'PE' || r === 'generic' ? r : 'N';
  }
  function barOrient(d) {
    return d && d.orient === 'v' ? 'v' : 'h';
  }
  function barHoles(d, t) {
    const n = Number(d && d.holes != null ? d.holes : t && t.holesDefault);
    if (!Number.isFinite(n)) return 8;
    return Math.max(TBAR.minHoles, Math.min(TBAR.maxHoles, Math.round(n)));
  }
  function barLenFromHoles(n) {
    const holes = Math.max(TBAR.minHoles, Math.min(TBAR.maxHoles, n | 0));
    const metal = (holes - 1) * TBAR.pitch + 2 * TBAR.endInset;
    return Math.round(2 * TBAR.footLen + metal - 10);
  }
  function holesFromBarLen(len) {
    const L = Math.max(40, Number(len) || 40);
    const metal = Math.max(TBAR.pitch, L - (2 * TBAR.footLen - 10));
    const n = Math.round((metal - 2 * TBAR.endInset) / TBAR.pitch) + 1;
    return Math.max(TBAR.minHoles, Math.min(TBAR.maxHoles, n));
  }
  function terminalBarGeom(d, t) {
    t = t || (d && spec(d.type));
    const holes = barHoles(d, t);
    let lengthMm = Number(d && d.lengthMm);
    if (!Number.isFinite(lengthMm) || lengthMm < 40) lengthMm = barLenFromHoles(holes);
    lengthMm = Math.max(barLenFromHoles(TBAR.minHoles), Math.min(240, Math.round(lengthMm)));
    const orient = barOrient(d);
    const role = barRole(d, t);
    const w = orient === 'v' ? TBAR.height : lengthMm;
    const h = orient === 'v' ? lengthMm : TBAR.height;
    return { holes, lengthMm, orient, role, w, h, pitch: TBAR.pitch };
  }
  const deviceWidth = (t, d) => (isTerminalBar(t) ? terminalBarGeom(d, t).w : t.widthMm || t.modules * MODULE);
  const deviceHeight = (t, d) => (isTerminalBar(t) ? terminalBarGeom(d, t).h : t.heightMm || C.DEVICE_BODY_H);
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
    const w = deviceWidth(t, d);
    const h = deviceHeight(t, d);
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
    else if (isTerminalBar(t)) x = Math.round(x / GRID) * GRID;
    let y = t.freePlace ? d.y : snapToRailY(d.y, t);
    if (t.freePlace && isTerminalBar(t)) y = Math.round(y / GRID) * GRID;
    y = Math.max(p.y + 2, Math.min(p.y + p.h - h - 2, y));
    x = Math.max(xMin, Math.min(xMax, x));
    return { x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 };
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
  function normalizeRoute(r) {
    if (ROUTES.includes(r)) return r;
    if (r === 'ortho' || r === 'vh') return 'vhv';
    if (r === 'hv') return 'hvh';
    return 'free';
  }
  function normalizeEnd(e, devices) {
    if (!e || typeof e !== 'object') return null;
    if (e.free || (e.id == null && Number.isFinite(e.x) && Number.isFinite(e.y))) {
      return { free: true, x: Math.round(e.x), y: Math.round(e.y) };
    }
    if (typeof e.id === 'string' && Number.isInteger(e.i) && e.i >= 0 && e.i < TBAR.maxHoles && devices.some((x) => x.id === e.id)) {
      return { id: e.id, i: e.i };
    }
    return null;
  }
  function normalizeWire(w, devices) {
    if (!w || typeof w.id !== 'string' || !/^#[0-9a-f]{6}$/i.test(w.color)) return null;
    const a = normalizeEnd(w.a, devices);
    const b = normalizeEnd(w.b, devices);
    if (!a || !b) return null;
    // at least one end should be a terminal (orphan free–free discarded)
    if (a.free && b.free) return null;
    let bends = Array.isArray(w.bends)
      ? w.bends.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)).slice(0, 80).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
      : [];
    const route = normalizeRoute(w.route);
    // Dense freehand → corners (full migrate with endpoints happens in migrate())
    if (route === 'free' && bends.length >= 12) {
      bends = ramerDouglasPeucker(dedupePts(bends), RDP_MIGRATE_EPS);
    }
    const width = Number(w.width);
    return {
      id: w.id,
      a,
      b,
      color: w.color,
      width: Number.isFinite(width) ? Math.max(1, Math.min(8, width)) : 2.5,
      route,
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
        const t = spec(d.type);
        const nd = { id: d.id, type: d.type, label: String(d.label).slice(0, 40), rating: String(d.rating).slice(0, 40), x: d.x, y: d.y };
        if (isTerminalBar(t)) {
          nd.holes = barHoles(d, t);
          nd.lengthMm = Number.isFinite(Number(d.lengthMm)) ? Math.round(Number(d.lengthMm)) : barLenFromHoles(nd.holes);
          nd.orient = d.orient === 'v' ? 'v' : 'h';
          nd.role = barRole(d, t);
        }
        devices.push(nd);
      }
      // Drop wire ends that point past a bar's hole count
      const maxPort = (id) => {
        const d = devices.find((x) => x.id === id);
        if (!d) return 0;
        const t = spec(d.type);
        if (isTerminalBar(t)) return barHoles(d, t);
        return Math.max(1, (t && t.poles) || 1) * 2;
      };
      const wires = [];
      for (const w of block.wires) {
        const nw = normalizeWire(w, devices);
        if (!nw) return null;
        if (!nw.a.free && nw.a.i >= maxPort(nw.a.id)) continue;
        if (!nw.b.free && nw.b.i >= maxPort(nw.b.id)) continue;
        wires.push(nw);
      }
      // Collapse legacy freehand squiggles → corner polylines
      const portOf = (end) => {
        if (!end) return null;
        if (end.free) return { x: end.x, y: end.y };
        const d = devices.find((x) => x.id === end.id);
        if (!d) return null;
        const pt = ports(d)[end.i];
        return pt ? { x: pt.x, y: pt.y } : null;
      };
      wires.forEach((w) => {
        const a = portOf(w.a);
        const b = portOf(w.b);
        if (!a || !b) return;
        const r = normalizeRoute(w.route);
        if (r === 'vhv' || r === 'hvh') w.bends = defaultBends(a, b, r);
        else w.bends = migrateFreehandBends(w.bends, a, b);
      });
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
    if (m) {
      data = m;
      // rewrite storage so legacy freehand gets corner-migrated on disk
      try {
        localStorage.setItem(STORAGE, JSON.stringify(data));
      } catch (_) {}
    }
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
    if (isTerminalBar(t)) {
      const g = terminalBarGeom(d, t);
      const base = g.role === 'PE' ? 'PE' : g.role === 'N' ? 'N' : 'B';
      const margin = 12;
      const usable = Math.max(TBAR.pitch, g.lengthMm - 2 * margin);
      return Array.from({ length: g.holes }, (_, i) => {
        const along = margin + (g.holes === 1 ? usable / 2 : (i * usable) / (g.holes - 1));
        if (g.orient === 'h') {
          return { x: d.x + along, y: d.y + 7, label: `${base}${i + 1}`, top: true };
        }
        return { x: d.x + 7, y: d.y + along, label: `${base}${i + 1}`, top: true };
      });
    }
    const n = Math.max(1, t.poles | 0);
    const w = deviceWidth(t, d);
    const h = deviceHeight(t, d);
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
  function wiresOnBarPorts(devId, fromIndex) {
    return state().wires.filter((w) => {
      const aHit = w.a && !w.a.free && w.a.id === devId && w.a.i >= fromIndex;
      const bHit = w.b && !w.b.free && w.b.id === devId && w.b.i >= fromIndex;
      return aHit || bHit;
    });
  }
  function applyBarHoles(d, n, opts) {
    const t = spec(d.type);
    if (!isTerminalBar(t)) return false;
    n = Math.max(TBAR.minHoles, Math.min(TBAR.maxHoles, Math.round(n)));
    const doomed = wiresOnBarPorts(d.id, n);
    if (doomed.length) {
      const ok =
        opts && opts.force
          ? true
          : window.confirm(`มีสาย ${doomed.length} เส้นที่จุดเชื่อมต่อ ${n + 1} ขึ้นไป — ลบสายเหล่านั้นแล้วลดจำนวนช่องหรือไม่?`);
      if (!ok) return false;
      const drop = new Set(doomed.map((w) => w.id));
      state().wires = state().wires.filter((w) => !drop.has(w.id));
      if (selectedWire && drop.has(selectedWire)) selectedWire = null;
      $('status').textContent = `ลบสาย ${doomed.length} เส้นที่ช่องถูกตัดออก`;
    }
    d.holes = n;
    if (!(opts && opts.keepLength)) d.lengthMm = barLenFromHoles(n);
    const pos = clampDevice(d, t);
    d.x = pos.x;
    d.y = pos.y;
    return true;
  }
  function rotateTerminalBar(d) {
    const t = spec(d.type);
    if (!isTerminalBar(t)) return;
    const w0 = deviceWidth(t, d);
    const h0 = deviceHeight(t, d);
    const cx = d.x + w0 / 2;
    const cy = d.y + h0 / 2;
    d.orient = barOrient(d) === 'v' ? 'h' : 'v';
    const w1 = deviceWidth(t, d);
    const h1 = deviceHeight(t, d);
    d.x = cx - w1 / 2;
    d.y = cy - h1 / 2;
    const pos = clampDevice(d, t);
    d.x = pos.x;
    d.y = pos.y;
  }
  function syncBarRating(d) {
    const t = spec(d.type);
    if (!isTerminalBar(t)) return;
    const g = terminalBarGeom(d, t);
    const role = g.role === 'PE' ? 'PE' : g.role === 'N' ? 'N' : 'บาร์';
    d.rating = `${role} · ${g.holes} ช่อง`;
  }
  function isFreeEnd(e) {
    return !!(e && (e.free || (e.id == null && Number.isFinite(e.x) && Number.isFinite(e.y))));
  }
  function resolveEnd(e) {
    if (!e) return null;
    if (isFreeEnd(e)) return { x: e.x, y: e.y, free: true };
    const d = state().devices.find((x) => x.id === e.id);
    const p = d && ports(d)[e.i];
    return p ? { x: p.x, y: p.y, free: false, id: e.id, i: e.i } : null;
  }
  function endpoint(e) {
    return resolveEnd(e);
  }
  function currentRoute() {
    return normalizeRoute($('wire-route').value);
  }
  function defaultBends(a, b, route) {
    if (!a || !b) return [];
    const r = normalizeRoute(route);
    if (r === 'free' || r === 'straight') return [];
    if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) return [];
    if (r === 'hvh') {
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
  function dedupePts(pts) {
    const out = [];
    pts.forEach((p) => {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      const last = out[out.length - 1];
      if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.5) return;
      out.push({ x: Math.round(p.x), y: Math.round(p.y) });
    });
    return out;
  }
  function perpDist(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
    const qx = a.x + t * dx;
    const qy = a.y + t * dy;
    return Math.hypot(p.x - qx, p.y - qy);
  }
  function ramerDouglasPeucker(points, epsilon) {
    if (!points || points.length < 3) return (points || []).slice();
    let maxD = 0;
    let idx = 0;
    const end = points.length - 1;
    for (let i = 1; i < end; i++) {
      const d = perpDist(points[i], points[0], points[end]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon) {
      const left = ramerDouglasPeucker(points.slice(0, idx + 1), epsilon);
      const right = ramerDouglasPeucker(points.slice(idx), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [points[0], points[end]];
  }
  function wirePolyline(w) {
    const a = resolveEnd(w.a);
    const b = resolveEnd(w.b);
    if (!a || !b) return [];
    const route = normalizeRoute(w.route);
    if (route === 'straight' || route === 'free') {
      const mids = (w.bends || []).map((p) => ({ x: p.x, y: p.y }));
      return dedupePts([a, ...mids, b]);
    }
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
    return pts.map((p, i) => `${i ? 'L' : 'M'}${Math.round(p.x)},${Math.round(p.y)}`).join(' ');
  }
  function gridSnap(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return p;
    return { x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID };
  }
  function isOctilinear(a, b, tol = 1.5) {
    if (!a || !b) return false;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx < tol || dy < tol) return true; // H or V
    return Math.abs(dx - dy) < tol; // 45° diagonal
  }
  /** Snap `to` onto nearest 45° ray from `from` (keep approximate length). */
  function snap45From(from, to) {
    if (!from || !to) return to;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return gridSnap({ x: from.x, y: from.y });
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const snapped = Math.round(deg / 45) * 45;
    const rad = (snapped * Math.PI) / 180;
    return gridSnap({ x: from.x + Math.cos(rad) * len, y: from.y + Math.sin(rad) * len });
  }
  /** One joint so a→joint and joint→b are both 45°-aligned (octilinear stub). */
  function octilinearJoint(a, b) {
    if (!a || !b) return [];
    const ga = gridSnap(a);
    const gb = gridSnap(b);
    if (isOctilinear(ga, gb)) return [];
    const dx = gb.x - ga.x;
    const dy = gb.y - ga.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const sx = Math.sign(dx) || 1;
    const sy = Math.sign(dy) || 1;
    // Cover the excess axis with an orthogonal stub, then diagonal the rest
    if (adx > ady) return [gridSnap({ x: ga.x + sx * (adx - ady), y: ga.y })];
    return [gridSnap({ x: ga.x, y: ga.y + sy * (ady - adx) })];
  }
  /**
   * Force path a → corners → b to only use 45° segments.
   * Snaps each corner from previous; inserts a joint before the end if needed.
   */
  function octilinearizePath(a, corners, b) {
    if (!a || !b) return [];
    const start = gridSnap(a);
    const end = gridSnap(b);
    const out = [];
    let prev = start;
    (corners || []).forEach((c) => {
      const snapped = snap45From(prev, c);
      if (Math.hypot(snapped.x - prev.x, snapped.y - prev.y) < GRID) return;
      // if snap45From still not octilinear (length collapse), skip
      if (!isOctilinear(prev, snapped)) return;
      out.push(snapped);
      prev = snapped;
    });
    if (!isOctilinear(prev, end)) {
      const joints = octilinearJoint(prev, end);
      joints.forEach((j) => {
        if (Math.hypot(j.x - prev.x, j.y - prev.y) >= GRID) {
          out.push(j);
          prev = j;
        }
      });
    }
    // Drop intermediate points that are colinear with neighbors (same 45° ray)
    if (out.length < 2) return out;
    const full = [start, ...out, end];
    const kept = [full[0]];
    for (let i = 1; i < full.length - 1; i++) {
      const a = kept[kept.length - 1];
      const b = full[i];
      const c = full[i + 1];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      if (Math.abs(cross) < 1.5 && dot > 0) continue; // straight-through colinear
      kept.push(b);
    }
    kept.push(full[full.length - 1]);
    return kept.slice(1, -1);
  }
  /** Dragging a corner: keep both adjacent segments at 45° (best ray intersection near pointer). */
  function octilinearCornerAt(prev, next, prefer) {
    if (!prev || !next) return gridSnap(prefer || prev);
    const pref = prefer || { x: (prev.x + next.x) / 2, y: (prev.y + next.y) / 2 };
    const dirs = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => i * DEG45);
    let best = null;
    let bestDist = Infinity;
    for (const a of dirs) {
      const cax = Math.cos(a);
      const say = Math.sin(a);
      for (const b of dirs) {
        const cbx = Math.cos(b);
        const sby = Math.sin(b);
        const det = cax * sby - say * cbx;
        if (Math.abs(det) < 1e-8) continue;
        // prev + t*dirA = next + s*dirB
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const t = (dx * sby - dy * cbx) / det;
        const s = (dx * say - dy * cax) / det;
        if (t < GRID || s < GRID) continue;
        const ix = prev.x + t * cax;
        const iy = prev.y + t * say;
        const pt = { x: ix, y: iy };
        if (!isOctilinear(prev, pt) || !isOctilinear(pt, next)) continue;
        const dist = Math.hypot(ix - pref.x, iy - pref.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = pt;
        }
      }
    }
    if (best) return gridSnap(best);
    return snap45From(prev, pref);
  }
  function rerouteWire(w) {
    const a = resolveEnd(w.a);
    const b = resolveEnd(w.b);
    if (!a || !b) return;
    const r = normalizeRoute(w.route);
    if (r === 'vhv' || r === 'hvh') w.bends = defaultBends(a, b, r);
    else w.bends = octilinearizePath(a, w.bends || [], b);
  }
  function rerouteConnected(deviceId) {
    state().wires.forEach((w) => {
      if (wireTouchesDevice(w, deviceId)) rerouteWire(w);
    });
  }
  function lastCornerAnchor(fromEnd, corners) {
    if (corners && corners.length) return corners[corners.length - 1];
    return resolveEnd(fromEnd);
  }
  function previewPath(a, to, route, corners) {
    const r = normalizeRoute(route);
    if (r === 'vhv' || r === 'hvh') {
      const bends = defaultBends(a, to, r);
      return pathD([a, ...bends, to]);
    }
    // free + straight: octilinear preview (rubber tip already 45°-snapped by caller)
    const mids = octilinearizePath(a, corners || [], to);
    return pathD(dedupePts([a, ...mids, to]));
  }
  /** Migrate legacy paths → octilinear corners. */
  function migrateFreehandBends(bends, a, b) {
    let pts = Array.isArray(bends) ? bends.slice() : [];
    if (pts.length >= 12) {
      const all = dedupePts([a, ...pts, b]);
      let simp = ramerDouglasPeucker(all, RDP_MIGRATE_EPS);
      if (simp.length && a && Math.hypot(simp[0].x - a.x, simp[0].y - a.y) < 3) simp = simp.slice(1);
      if (simp.length && b && Math.hypot(simp[simp.length - 1].x - b.x, simp[simp.length - 1].y - b.y) < 3) simp = simp.slice(0, -1);
      pts = simp;
    }
    return octilinearizePath(a, pts, b);
  }
  function wireTouchesDevice(w, id) {
    return (w.a && w.a.id === id) || (w.b && w.b.id === id);
  }
  function termSnapRadius() {
    return window.matchMedia('(max-width:900px)').matches ? TERM_SNAP + 8 : TERM_SNAP;
  }
  function terminalRadius(t) {
    if (isTerminalBar(t)) return window.matchMedia('(max-width:900px)').matches ? 10 : 7;
    const base = Math.max(7, Math.min(11, Math.max(deviceWidth(t), deviceHeight(t)) / 10));
    return window.matchMedia('(max-width:900px)').matches ? Math.max(base, 12) : base;
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
    const list = state().devices;
    for (const d of list) {
      const t = spec(d.type);
      if (!t) continue;
      const w = deviceWidth(t, d);
      const h = deviceHeight(t, d);
      if (d.x < p.x - 1 || d.y < p.y - 1 || d.x + w > p.x + p.w + 2 || d.y + h > p.y + p.h + 2) msgs.push(`«${d.label}» อยู่นอกแผ่นติดตั้ง`);
      if (t.depthMm && t.depthMm > c.depth) msgs.push(`«${d.label}» ลึก ${t.depthMm} มม. แต่ตู้ลึก ${c.depth} มม.`);
      if (t.freePlace) continue;
      if (w > usable + 0.5) msgs.push(`«${d.label}» กว้าง ${w} มม. แต่รางยาว ${Math.round(usable)} มม.`);
      else if (d.x < rx - 1 || d.x + w > rx + usable + 1) msgs.push(`«${d.label}» ยื่นนอกราง DIN`);
      const idx = nearestRailIndex(d.y, t);
      byRail[idx] += t.modules;
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const ta = spec(a.type);
        const tb = spec(b.type);
        if (!ta || !tb) continue;
        const aw = deviceWidth(ta, a);
        const ah = deviceHeight(ta, a);
        const bw = deviceWidth(tb, b);
        const bh = deviceHeight(tb, b);
        const overlap = !(a.x + aw <= b.x + 0.5 || b.x + bw <= a.x + 0.5 || a.y + ah <= b.y + 0.5 || b.y + bh <= a.y + 0.5);
        if (overlap) msgs.push(`«${a.label}» ทับกับ «${b.label}»`);
      }
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
      $('float-label').textContent = d.label + (t ? ` · ${deviceWidth(t, d)}×${deviceHeight(t, d)} มม.` : '');
    } else if (w) {
      const r = normalizeRoute(w.route);
      const label = { free: 'อิสระ', vhv: 'V–H', hvh: 'H–V', straight: 'ตรง' }[r] || r;
      $('float-label').textContent = `สาย · ${label} · จุด ${w.bends.length}${isFreeEnd(w.a) || isFreeEnd(w.b) ? ' · ปลายอิสระ' : ''}`;
    } else $('float-label').textContent = '—';
  }
  function properties() {
    const d = selected && state().devices.find((x) => x.id === selected);
    const w = selectedWire && state().wires.find((x) => x.id === selectedWire);
    $('props').hidden = !d;
    $('wire-props').hidden = !w;
    $('empty').hidden = !!(d || w);
    const barBox = $('bar-props');
    if (barBox) barBox.hidden = true;
    if (d) {
      const t = spec(d.type);
      $('label').value = d.label;
      $('rating').value = d.rating;
      if (isTerminalBar(t)) {
        const g = terminalBarGeom(d, t);
        $('dev-size').textContent = `${g.w} × ${g.h} × ${t.depthMm || 20} มม. · บาร์ ${TBAR.sectionW}×${TBAR.sectionH} มม. · ระยะรู ~${TBAR.pitch} มม. · ติดแผ่น (นอก DIN)`;
        if (barBox) {
          barBox.hidden = false;
          $('bar-holes').value = String(g.holes);
          $('bar-length').value = String(g.lengthMm);
          $('bar-role').value = g.role;
          $('bar-orient-h').classList.toggle('active', g.orient === 'h');
          $('bar-orient-v').classList.toggle('active', g.orient === 'v');
          const presets = $('bar-presets');
          presets.replaceChildren();
          TBAR.presets.forEach((n) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = `${n}`;
            b.title = `${n} จุด`;
            b.classList.toggle('active', n === g.holes);
            b.onclick = () => {
              checkpoint();
              if (!applyBarHoles(d, n)) return;
              syncBarRating(d);
              render();
              properties();
              persist();
            };
            presets.append(b);
          });
        }
      } else {
        $('dev-size').textContent = t
          ? `${deviceWidth(t, d)} × ${deviceHeight(t, d)} × ${t.depthMm || '—'} มม. · ${t.modules} โมดูล${t.brand ? ' · ' + t.brand + (t.model ? ' ' + t.model : '') : ''}`
          : '—';
      }
    }
    if (w) {
      fillColorSelect($('wprop-color'), w.color);
      $('wprop-size').value = String(w.width);
      $('wprop-route').value = normalizeRoute(w.route);
      $('wprop-info').textContent = `แนว ${$('wprop-route').selectedOptions[0]?.text || ''} · จุด ${w.bends.length} · ลากจุด/ปลายอิสระได้`;
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

    // Live wire preview — straight rubber-band from last corner
    if (drag && drag.kind === 'wire' && drag.from) {
      const a0 = resolveEnd(drag.from);
      if (a0) {
        const corners = drag.corners || [];
        const to = drag.hover || drag.cur || a0;
        const d = previewPath(a0, to, drag.route || currentRoute(), corners);
        b.append(el('path', { d, fill: 'none', stroke: $('color').value, 'stroke-width': 2.5, 'stroke-dasharray': '5 4', opacity: 0.9, 'pointer-events': 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        corners.forEach((p) => b.append(el('circle', { cx: p.x, cy: p.y, r: 5, class: 'wire-sketch-dot' })));
        if (drag.hover) b.append(el('circle', { cx: drag.hover.x, cy: drag.hover.y, r: 10, fill: '#f0aa31', stroke: '#0a6b5c', 'stroke-width': 2, 'pointer-events': 'none' }));
      }
    }
    // Tap-by-tap / lift-and-tap sketch preview
    if (wireSketch && wireSketch.from) {
      const a = resolveEnd(wireSketch.from);
      if (a) {
        const corners = wireSketch.corners || wireSketch.points || [];
        const pts = [a, ...corners];
        if (pts.length >= 2) b.append(el('path', { d: pathD(pts), fill: 'none', stroke: $('color').value, 'stroke-width': 2.2, 'stroke-dasharray': '4 3', opacity: 0.85, 'pointer-events': 'none' }));
        pts.forEach((p, i) => b.append(el('circle', { cx: p.x, cy: p.y, r: i === 0 ? 6 : 4, class: 'wire-sketch-dot' })));
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
      const w = deviceWidth(t, d);
      const h = deviceHeight(t, d);
      const g = el('g', { class: 'device' + (t.freePlace ? ' free' : '') + (isTerminalBar(t) ? ' tbar' : ''), 'data-id': d.id });
      const isSel = selected === d.id;
      const pad = Math.max(2, Math.min(6, 24 - Math.min(w, h) / 2));
      const hit = el('rect', { x: d.x - pad, y: d.y - pad, width: w + pad * 2, height: h + pad * 2, fill: 'transparent', class: 'device-hit' });

      if (isTerminalBar(t)) {
        const geom = terminalBarGeom(d, t);
        const footColor = geom.role === 'PE' ? '#2f9e44' : geom.role === 'N' ? '#1c7ed6' : '#868e96';
        const brass = '#c9a227';
        const brassDark = '#a8841a';
        const L = geom.lengthMm;
        const foot = TBAR.footW;
        const barH = TBAR.sectionH;
        const barT = TBAR.sectionW;
        if (geom.orient === 'h') {
          const barY = d.y + 4;
          const barX = d.x + foot - 4;
          const barW = Math.max(barT, L - 2 * foot + 8);
          g.append(
            hit,
            el('rect', { x: d.x, y: d.y + h - 12, width: foot, height: 12, rx: 1.5, fill: footColor, stroke: '#14532d22', 'stroke-width': 0.5 }),
            el('rect', { x: d.x + L - foot, y: d.y + h - 12, width: foot, height: 12, rx: 1.5, fill: footColor, stroke: '#14532d22', 'stroke-width': 0.5 }),
            el('circle', { cx: d.x + foot / 2, cy: d.y + h - 6, r: 2.2, fill: '#e9ecef', stroke: '#495057', 'stroke-width': 0.6 }),
            el('circle', { cx: d.x + L - foot / 2, cy: d.y + h - 6, r: 2.2, fill: '#e9ecef', stroke: '#495057', 'stroke-width': 0.6 }),
            el('rect', { x: barX, y: barY, width: barW, height: barH, rx: 1, fill: brass, stroke: isSel ? '#0a6b5c' : brassDark, 'stroke-width': isSel ? 1.8 : 0.8 })
          );
          ports(d).forEach((pt) => {
            g.append(
              el('circle', { cx: pt.x, cy: barY + barH / 2, r: 2.4, fill: '#ced4da', stroke: '#495057', 'stroke-width': 0.5 }),
              el('line', { x1: pt.x - 1.6, x2: pt.x + 1.6, y1: barY + 2, y2: barY + 2, stroke: '#343a40', 'stroke-width': 0.7 }),
              el('line', { x1: pt.x, x2: pt.x, y1: barY + 1.2, y2: barY + 3.2, stroke: '#343a40', 'stroke-width': 0.7 })
            );
          });
          g.append(
            el('text', { x: d.x + L / 2, y: d.y + h - 1, 'text-anchor': 'middle', 'font-size': 7, fill: '#1a3038' }, (d.label || '').slice(0, 14))
          );
        } else {
          const barX = d.x + 4;
          const barY = d.y + foot - 4;
          const barLen = Math.max(barT, L - 2 * foot + 8);
          g.append(
            hit,
            el('rect', { x: d.x + w - 12, y: d.y, width: 12, height: foot, rx: 1.5, fill: footColor }),
            el('rect', { x: d.x + w - 12, y: d.y + L - foot, width: 12, height: foot, rx: 1.5, fill: footColor }),
            el('circle', { cx: d.x + w - 6, cy: d.y + foot / 2, r: 2.2, fill: '#e9ecef', stroke: '#495057', 'stroke-width': 0.6 }),
            el('circle', { cx: d.x + w - 6, cy: d.y + L - foot / 2, r: 2.2, fill: '#e9ecef', stroke: '#495057', 'stroke-width': 0.6 }),
            el('rect', { x: barX, y: barY, width: barH, height: barLen, rx: 1, fill: brass, stroke: isSel ? '#0a6b5c' : brassDark, 'stroke-width': isSel ? 1.8 : 0.8 })
          );
          ports(d).forEach((pt) => {
            g.append(
              el('circle', { cx: barX + barH / 2, cy: pt.y, r: 2.4, fill: '#ced4da', stroke: '#495057', 'stroke-width': 0.5 }),
              el('line', { x1: barX + 2, x2: barX + 2, y1: pt.y - 1.6, y2: pt.y + 1.6, stroke: '#343a40', 'stroke-width': 0.7 }),
              el('line', { x1: barX + 1.2, x2: barX + 3.2, y1: pt.y, y2: pt.y, stroke: '#343a40', 'stroke-width': 0.7 })
            );
          });
          g.append(
            el('text', {
              x: d.x + w - 1,
              y: d.y + L / 2,
              'text-anchor': 'middle',
              'font-size': 7,
              fill: '#1a3038',
              transform: `rotate(-90 ${d.x + w - 1} ${d.y + L / 2})`
            }, (d.label || '').slice(0, 14))
          );
        }
        g.querySelectorAll('rect:not(.device-hit), circle, line, text').forEach((n) => {
          n.style.pointerEvents = 'none';
        });
        if (isSel) {
          const hx = geom.orient === 'h' ? d.x + w - 3 : d.x + w / 2 - 4;
          const hy = geom.orient === 'h' ? d.y + h / 2 - 4 : d.y + h - 3;
          const hw = geom.orient === 'h' ? 6 : 8;
          const hh = geom.orient === 'h' ? 8 : 6;
          const handle = el('rect', {
            x: hx,
            y: hy,
            width: hw,
            height: hh,
            rx: 1.5,
            fill: '#0a6b5c',
            stroke: '#fff',
            'stroke-width': 1,
            class: 'bar-resize',
            style: `cursor:${geom.orient === 'h' ? 'ew-resize' : 'ns-resize'}`
          });
          handle.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            selectedWire = null;
            selected = d.id;
            checkpoint();
            drag = {
              kind: 'bar-resize',
              id: d.id,
              startLen: geom.lengthMm,
              startHoles: geom.holes,
              startX: point(e).x,
              startY: point(e).y,
              orient: geom.orient
            };
            try {
              b.setPointerCapture(e.pointerId);
            } catch (_) {}
            properties();
            render();
          });
          g.append(handle);
        }
      } else {
        const labelFs = Math.max(7, Math.min(10, w / 5.5));
        const ratingFs = Math.max(6, Math.min(8, w / 6.5));
        const labelY = d.y + Math.min(12, h * 0.32);
        const ratingY = d.y + h - Math.max(5, Math.min(8, h * 0.12));
        g.append(
          hit,
          el('rect', { x: d.x, y: d.y, width: w, height: h, rx: 3, fill: '#fff', stroke: isSel ? '#0a6b5c' : '#8a9ba4', 'stroke-width': isSel ? 2.5 : 1.2 }),
          el('rect', { x: d.x + 3, y: d.y + h * 0.38, width: Math.max(2, w - 6), height: Math.max(8, h * 0.2), rx: 2, fill: t.isBar ? '#b89a4e' : '#243842' }),
          el('text', { x: d.x + w / 2, y: labelY, 'text-anchor': 'middle', 'font-size': labelFs, fill: '#1a3038' }, (d.label || '').slice(0, w < 28 ? 4 : 10)),
          el('text', { x: d.x + w / 2, y: ratingY, 'text-anchor': 'middle', 'font-size': ratingFs, fill: '#6d7f88' }, (d.rating || '').slice(0, w < 28 ? 4 : 12))
        );
        g.querySelectorAll('rect:not(.device-hit), text').forEach((n) => {
          n.style.pointerEvents = 'none';
        });
      }

      hit.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (tool === 'wire') return; // terminals handle wiring; body ignores in wire mode
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

      // Port labels only when selected — avoids overlap with body text / terminals
      if (isSel) {
        ports(d).forEach((pt) => {
          g.append(
            el('text', {
              x: pt.x,
              y: pt.y + (pt.top ? -8 : 14),
              'text-anchor': 'middle',
              'font-size': 8,
              fill: '#0a6b5c',
              style: 'pointer-events:none'
            }, pt.label)
          );
        });
      }
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
        const route = normalizeRoute(w.route);
        let handles = w.bends.slice();
        if (!handles.length && (route === 'vhv' || route === 'hvh')) {
          handles = defaultBends(resolveEnd(w.a), resolveEnd(w.b), route);
        }
        // Mid-segment handles — tap to insert a corner (keeps adjacent segments straight)
        if (route === 'free' || route === 'straight' || handles.length) {
          const poly = pts;
          for (let si = 0; si < poly.length - 1; si++) {
            const mx = (poly[si].x + poly[si + 1].x) / 2;
            const my = (poly[si].y + poly[si + 1].y) / 2;
            const mh = el('circle', { cx: mx, cy: my, r: 6, class: 'mid-handle' });
            mh.addEventListener('pointerdown', (e) => {
              e.stopPropagation();
              checkpoint();
              if (route === 'straight') w.route = 'free';
              if (!w.bends.length && (route === 'vhv' || route === 'hvh')) w.bends = handles.map((p) => ({ x: p.x, y: p.y }));
              // insert after bend index si-1 (polyline = a + bends + b)
              const bi = Math.max(0, Math.min(w.bends.length, si));
              w.bends.splice(bi, 0, { x: Math.round(mx), y: Math.round(my) });
              drag = { kind: 'bend', wireId: w.id, index: bi };
              try {
                b.setPointerCapture(e.pointerId);
              } catch (_) {}
              render();
              properties();
            });
            g.append(mh);
          }
        }
        handles.forEach((bp, i) => {
          const h = el('circle', { cx: bp.x, cy: bp.y, r: 8, class: 'bend-handle' });
          let holdTimer = null;
          const deleteCorner = () => {
            checkpoint();
            if (!w.bends.length) {
              if (route === 'vhv' || route === 'hvh') {
                w.bends = handles.map((p) => ({ x: p.x, y: p.y }));
              } else return;
            }
            w.bends.splice(i, 1);
            render();
            properties();
            persist();
          };
          h.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            checkpoint();
            if (!w.bends.length) w.bends = handles.map((p) => ({ x: p.x, y: p.y }));
            if (route === 'straight') w.route = 'free';
            drag = { kind: 'bend', wireId: w.id, index: i, startX: e.clientX, startY: e.clientY };
            holdTimer = setTimeout(() => {
              holdTimer = null;
              if (drag && drag.kind === 'bend' && drag.wireId === w.id && !drag.moved) {
                drag = null;
                deleteCorner();
              }
            }, LONG_PRESS_MS);
            drag._holdClear = () => {
              if (holdTimer) clearTimeout(holdTimer);
              holdTimer = null;
            };
            try {
              b.setPointerCapture(e.pointerId);
            } catch (_) {}
            render();
          });
          h.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            deleteCorner();
          });
          g.append(h);
        });
        // Free endpoint handle
        [w.a, w.b].forEach((end, ei) => {
          if (!isFreeEnd(end)) return;
          const h = el('circle', { cx: end.x, cy: end.y, r: 9, class: 'free-end', 'data-end': ei === 0 ? 'a' : 'b' });
          h.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            checkpoint();
            drag = { kind: 'free-end', wireId: w.id, which: ei === 0 ? 'a' : 'b' };
            try {
              b.setPointerCapture(e.pointerId);
            } catch (_) {}
            render();
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
        const hot =
          (drag && drag.kind === 'wire' && drag.hover && drag.hover.id === d.id && drag.hover.i === i) ||
          (wireSketch && wireSketch.from && wireSketch.from.id === d.id && wireSketch.from.i === i);
        const r = terminalRadius(t);
        const circle = el('circle', {
          cx: pt.x,
          cy: pt.y,
          r: hot ? r + 3 : r,
          fill: hot ? '#f0aa31' : '#dfe6ea',
          stroke: hot ? '#0a6b5c' : '#5a6d77',
          'stroke-width': 1.8,
          class: 'terminal',
          'data-dev': d.id,
          'data-port': String(i)
        });
        // Invisible larger hit for touch
        const hitR = Math.max(r + 6, termSnapRadius() * 0.55);
        const hitC = el('circle', { cx: pt.x, cy: pt.y, r: hitR, fill: 'transparent', class: 'terminal-hit', 'data-dev': d.id, 'data-port': String(i) });
        const startWire = (e) => {
          e.stopPropagation();
          e.preventDefault();
          selected = null;
          selectedWire = null;
          const from = { id: d.id, i };
          const route = currentRoute();
          // If tap-sketch already started and this is another terminal → finish
          if (wireSketch && wireSketch.from && !(wireSketch.from.id === d.id && wireSketch.from.i === i)) {
            finishWireSketch({ id: d.id, i, x: pt.x, y: pt.y });
            return;
          }
          const resumeCorners =
            wireSketch && wireSketch.from && wireSketch.from.id === from.id && wireSketch.from.i === from.i
              ? (wireSketch.corners || []).slice()
              : [];
          wireSketch = null;
          updateWireDoneBtn();
          drag = {
            kind: 'wire',
            from,
            cur: { x: pt.x, y: pt.y },
            hover: null,
            corners: resumeCorners,
            route,
            moved: false,
            pointerType: e.pointerType,
            startClientX: e.clientX,
            startClientY: e.clientY,
            holdTimer: null,
            lastHoldPt: null
          };
          try {
            b.setPointerCapture(e.pointerId);
          } catch (_) {}
          $('status').textContent =
            route === 'vhv' || route === 'hvh'
              ? 'ลากไปยังขั้วปลายทาง หรือปล่อยว่าง'
              : 'ลากมุม 45° · ค้าง ~0.4วิ หรือปล่อยแล้วแตะเพื่อวางมุม · ปล่อยที่ขั้ว = เชื่อม';
          properties();
          render();
        };
        hitC.addEventListener('pointerdown', startWire);
        circle.addEventListener('pointerdown', startWire);
        b.append(hitC, circle);
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
      .map(([k, v]) => {
        const t = spec(k) || {};
        const name = t.nameTh || t.name || k;
        if (isTerminalBar(t)) {
          const sample = state().devices.find((d) => d.type === k);
          const holes = sample ? barHoles(sample, t) : t.holesDefault || 8;
          return `${name} (${holes} จุด) × ${v}`;
        }
        return `${name} × ${v}`;
      })
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
    let bestDist = termSnapRadius();
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
    const a = resolveEnd(w.a);
    const b = resolveEnd(w.b);
    if (!a || !b) return;
    const route = normalizeRoute(w.route);
    if (!w.bends.length && (route === 'vhv' || route === 'hvh')) w.bends = defaultBends(a, b, route);
    if (route === 'free' || route === 'straight') {
      const pts = wirePolyline(w);
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = perpDist(pt, pts[i], pts[i + 1]);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      const prev = pts[bestI];
      const next = pts[bestI + 1];
      const corner = octilinearCornerAt(prev, next, pt);
      const bi = Math.min(w.bends.length, Math.max(0, bestI));
      w.bends.splice(bi, 0, corner);
      if (route === 'straight') w.route = 'free';
      // Re-solve so neighbors stay 45°
      w.bends = octilinearizePath(a, w.bends, b);
    } else {
      w.bends.push(gridSnap(pt));
    }
    selectedWire = w.id;
    selected = null;
    render();
    properties();
    persist();
  }

  function finishWireSketch(end) {
    if (!wireSketch || !wireSketch.from) return;
    const from = wireSketch.from;
    const corners = (wireSketch.corners || wireSketch.points || []).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    const route = currentRoute();
    let b;
    let bends = [];
    if (end && end.id != null) {
      b = { id: end.id, i: end.i };
      bends = corners;
    } else if (corners.length) {
      const last = corners[corners.length - 1];
      b = { free: true, x: last.x, y: last.y };
      bends = corners.slice(0, -1);
    } else {
      wireSketch = null;
      updateWireDoneBtn();
      $('status').textContent = 'ยกเลิกการเดินสาย';
      render();
      return;
    }
    if (route === 'vhv' || route === 'hvh') bends = defaultBends(resolveEnd(from), resolveEnd(b), route);
    else bends = octilinearizePath(resolveEnd(from), bends, resolveEnd(b));
    checkpoint();
    state().wires.push({
      id: crypto.randomUUID(),
      a: { id: from.id, i: from.i },
      b,
      color: $('color').value,
      width: parseFloat($('wire-size').value) || 2.5,
      route,
      bends
    });
    selectedWire = state().wires[state().wires.length - 1].id;
    selected = null;
    wireSketch = null;
    updateWireDoneBtn();
    $('status').textContent = b.free ? 'วางสายปลายอิสระแล้ว' : 'เชื่อมสายแล้ว · มุม 45°';
    render();
    properties();
    persist();
  }

  function updateWireDoneBtn() {
    const btn = $('wire-done');
    if (!btn) return;
    const show = !!(wireSketch && wireSketch.from);
    btn.hidden = !show;
  }

  /** Create wire from drag: corners are 45° polyline bends (octilinear). */
  function createWireFromDrag(from, to, corners, route) {
    const a = resolveEnd(from);
    if (!a) return;
    const r = normalizeRoute(route);
    let b;
    let bends = [];
    if (to && to.id != null) {
      b = { id: to.id, i: to.i };
    } else if (to && (to.free || Number.isFinite(to.x))) {
      const snapped = gridSnap(to);
      b = { free: true, x: snapped.x, y: snapped.y };
    } else return;

    if (r === 'vhv' || r === 'hvh') {
      bends = defaultBends(a, resolveEnd(b), r);
    } else {
      // free + straight: always octilinear (45° only)
      bends = octilinearizePath(a, corners || [], resolveEnd(b));
    }
    checkpoint();
    state().wires.push({
      id: crypto.randomUUID(),
      a: { id: from.id, i: from.i },
      b,
      color: $('color').value,
      width: parseFloat($('wire-size').value) || 2.5,
      route: r,
      bends
    });
    selectedWire = state().wires[state().wires.length - 1].id;
    selected = null;
    wireSketch = null;
    updateWireDoneBtn();
    $('status').textContent = b.free ? 'วางสายปลายอิสระแล้ว · ลากปลาย/มุมได้' : 'เชื่อมสายแล้ว · ลากมุมได้';
  }

  function clearWireHoldTimer(d) {
    if (d && d.holdTimer) {
      clearTimeout(d.holdTimer);
      d.holdTimer = null;
    }
  }

  function dropWireCorner(d, pt) {
    if (!d || d.kind !== 'wire') return;
    const anchor = lastCornerAnchor(d.from, d.corners);
    const snapped = snap45From(anchor, pt);
    const last = d.corners[d.corners.length - 1];
    if (last && Math.hypot(last.x - snapped.x, last.y - snapped.y) < GRID * 2) return;
    const start = resolveEnd(d.from);
    if (start && !d.corners.length && Math.hypot(start.x - snapped.x, start.y - snapped.y) < GRID * 2) return;
    d.corners.push(snapped);
    d.cur = snapped;
    d.lastHoldPt = snapped;
    $('status').textContent = `มุม 45° × ${d.corners.length} · ลากต่อ / ค้างวางมุม / ปล่อยที่ขั้ว`;
  }

  function addDevice(type, x, y, skipCheckpoint) {
    const t = spec(type);
    if (!t || !t.modes.includes(mode)) return null;
    if (!skipCheckpoint) checkpoint();
    const d = {
      id: crypto.randomUUID(),
      type,
      label: t.nameTh || t.name,
      rating: t.ratingDefault || 'ระบุพิกัด',
      x,
      y
    };
    if (isTerminalBar(t)) {
      d.holes = t.holesDefault || 8;
      d.lengthMm = barLenFromHoles(d.holes);
      d.orient = 'h';
      d.role = t.roleDefault || 'N';
      d.label = d.role === 'PE' ? 'บาร์ PE' : d.role === 'N' ? 'บาร์ N' : 'บาร์เทอร์มินัล';
      syncBarRating(d);
    }
    const pos = clampDevice(d, t);
    d.x = pos.x;
    d.y = pos.y;
    const railIdx = nearestRailIndex(pos.y, t);
    if (!t.freePlace && !fitsOnRail(t, railIdx)) {
      // still place but warn
    }
    state().devices.push(d);
    selected = d.id;
    selectedWire = null;
    render();
    properties();
    persist();
    $('status').textContent = isTerminalBar(t)
      ? `วาง ${d.label} (${d.holes} จุด) บนแผ่นติดตั้งแล้ว`
      : `วาง ${t.nameTh || t.name} แล้ว`;
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
      const preview = clampDevice({ ...d, x, y }, t);
      const dw = deviceWidth(t, d);
      const dh = deviceHeight(t, d);
      drag.ghost = { x: preview.x, y: preview.y, w: dw, h: dh };
      drag.railIdx = railIdx;
      drag.fit = t.freePlace || (fitsOnRail(t, railIdx, d.id) && deviceWidth(t) <= railUsableWidth());
      // live position (revert on drop if !fit)
      d.x = preview.x;
      d.y = t.freePlace ? Math.max(plate().y + 2, Math.min(plate().y + plate().h - dh - 2, preview.y)) : preview.y;
      rerouteConnected(d.id);
      const trash = overTrash(e.clientX, e.clientY);
      $('trash-zone').classList.toggle('hot', trash);
      drag.toTrash = trash;
      render();
    } else if (drag.kind === 'bar-resize') {
      const d = state().devices.find((x) => x.id === drag.id);
      const t = d && spec(d.type);
      if (!d || !isTerminalBar(t)) return;
      const delta = drag.orient === 'h' ? pt.x - drag.startX : pt.y - drag.startY;
      const nextLen = Math.max(barLenFromHoles(TBAR.minHoles), Math.min(240, drag.startLen + delta));
      const nextHoles = holesFromBarLen(nextLen);
      d.lengthMm = barLenFromHoles(nextHoles);
      d.holes = nextHoles;
      const pos = clampDevice(d, t);
      d.x = pos.x;
      d.y = pos.y;
      syncBarRating(d);
      rerouteConnected(d.id);
      $('status').textContent = `บาร์ ${d.holes} จุด · ยาว ${d.lengthMm} มม.`;
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
      // two-finger → cancel into pinch (handled by pinch listener)
      if (pointers.size >= 2) return;
      const route = normalizeRoute(drag.route || currentRoute());
      const anchor = lastCornerAnchor(drag.from, drag.corners || []);
      drag.hover = findTerminalAt(pt, drag.from);
      let cur = pt;
      if (drag.hover) cur = { x: drag.hover.x, y: drag.hover.y };
      else if (route === 'free' || route === 'straight') cur = snap45From(anchor, pt);
      drag.cur = cur;
      if (Math.hypot(e.clientX - (drag.startClientX || 0), e.clientY - (drag.startClientY || 0)) > MOVE_THRESH) drag.moved = true;

      // Pause/hold (~400ms truly still) drops a corner, then rubber-band continues
      if ((route === 'free' || route === 'straight') && drag.moved && !drag.hover) {
        if (!drag.stillSince || Math.hypot(cur.x - drag.stillSince.x, cur.y - drag.stillSince.y) > 5) {
          drag.stillSince = { x: cur.x, y: cur.y, t: Date.now() };
          clearWireHoldTimer(drag);
          drag.holdTimer = setTimeout(() => {
            if (!drag || drag.kind !== 'wire') return;
            const s = drag.stillSince;
            const c = drag.cur;
            if (!s || !c || Math.hypot(c.x - s.x, c.y - s.y) > 5) return;
            if (Date.now() - s.t < CORNER_HOLD_MS - 20) return;
            dropWireCorner(drag, c);
            drag.stillSince = { x: c.x, y: c.y, t: Date.now() };
            render();
          }, CORNER_HOLD_MS);
        }
      }
      render();
    } else if (drag.kind === 'bend') {
      const w = state().wires.find((x) => x.id === drag.wireId);
      if (!w || !w.bends[drag.index]) return;
      if (drag._holdClear && Math.hypot(e.clientX - (drag.startX || 0), e.clientY - (drag.startY || 0)) > MOVE_THRESH) {
        drag.moved = true;
        drag._holdClear();
      }
      const prev = w.bends[drag.index - 1] || resolveEnd(w.a);
      const next = w.bends[drag.index + 1] || resolveEnd(w.b);
      let snapped;
      if (prev && next) snapped = octilinearCornerAt(prev, next, pt);
      else if (prev) snapped = snap45From(prev, pt);
      else snapped = gridSnap(pt);
      w.bends[drag.index] = snapped;
      // If still not octilinear to next, insert/update a trailing joint after this bend
      if (next && !isOctilinear(snapped, next)) {
        const joints = octilinearJoint(snapped, next);
        if (joints.length) {
          // replace any auto joint immediately after, or insert
          const j = joints[0];
          if (w.bends[drag.index + 1] && drag._autoJoint) {
            w.bends[drag.index + 1] = j;
          } else {
            w.bends.splice(drag.index + 1, 0, j);
            drag._autoJoint = true;
          }
        }
      }
      if (normalizeRoute(w.route) === 'straight') w.route = 'free';
      // drag off far → mark remove
      drag.remove = pt.x < -20 || pt.y < -20 || pt.x > cabinet().width + 20 || pt.y > cabinet().height + 20;
      render();
    } else if (drag.kind === 'free-end') {
      const w = state().wires.find((x) => x.id === drag.wireId);
      if (!w) return;
      const snap = findTerminalAt(pt);
      if (snap) {
        w[drag.which] = { id: snap.id, i: snap.i };
        drag.hover = snap;
        rerouteWire(w);
      } else {
        const other = drag.which === 'a' ? resolveEnd(w.b) : resolveEnd(w.a);
        const snapped = other ? snap45From(other, pt) : gridSnap(pt);
        w[drag.which] = { free: true, x: snapped.x, y: snapped.y };
        drag.hover = null;
        rerouteWire(w);
      }
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
    } else if (kind === 'bar-resize') {
      const d = state().devices.find((x) => x.id === drag.id);
      if (d) {
        const t = spec(d.type);
        const doomed = wiresOnBarPorts(d.id, d.holes);
        if (doomed.length) {
          // shrinking removed connected holes — confirm or restore
          const ok = window.confirm(`มีสาย ${doomed.length} เส้นที่จุดถูกตัดออก — ลบสายเหล่านั้นหรือไม่?`);
          if (!ok) {
            d.holes = drag.startHoles;
            d.lengthMm = drag.startLen;
            const pos = clampDevice(d, t);
            d.x = pos.x;
            d.y = pos.y;
            syncBarRating(d);
            $('status').textContent = 'ยกเลิกการลดช่องที่มีสาย';
          } else {
            const drop = new Set(doomed.map((w) => w.id));
            state().wires = state().wires.filter((w) => !drop.has(w.id));
            if (selectedWire && drop.has(selectedWire)) selectedWire = null;
            syncBarRating(d);
            $('status').textContent = `บาร์ ${d.holes} จุด · ลบสาย ${doomed.length} เส้น`;
          }
        } else {
          syncBarRating(d);
          $('status').textContent = `บาร์ ${d.holes} จุด · ยาว ${d.lengthMm} มม.`;
        }
        rerouteConnected(d.id);
      }
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
      clearWireHoldTimer(drag);
      const from = drag.from;
      const moved = drag.moved;
      const corners = (drag.corners || []).slice();
      const route = normalizeRoute(drag.route || currentRoute());
      const pt = point(e);
      const rubber = drag.cur || pt;
      const toTerm = drag.hover || findTerminalAt(pt, from);
      drag = null;
      if (!moved) {
        // Tap on terminal → start tap-by-tap sketch
        wireSketch = { from, corners: [], lastTapMs: Date.now() };
        updateWireDoneBtn();
        $('status').textContent = 'แตะผ้าใบวางมุม · แตะขั้วปลายทางเพื่อเชื่อม · ดับเบิลแตะ/เสร็จ = จบ';
        render();
        properties();
      } else if (toTerm && !(toTerm.id === from.id && toTerm.i === from.i)) {
        createWireFromDrag(from, toTerm, corners, route);
        persist();
        render();
        properties();
      } else if (moved && (route === 'free' || route === 'straight')) {
        // Lift-and-tap: drop 45° corner at release, continue as sketch
        const anchor = lastCornerAnchor(from, corners);
        const snapped = snap45From(anchor, rubber);
        const next = corners.slice();
        const last = next[next.length - 1];
        if (!last || Math.hypot(last.x - snapped.x, last.y - snapped.y) >= GRID * 2) next.push(snapped);
        wireSketch = { from, corners: next, lastTapMs: Date.now() };
        updateWireDoneBtn();
        $('status').textContent = `มุม 45° × ${next.length} · แตะ/ลากต่อ / แตะขั้วหรือเสร็จ`;
        render();
        properties();
      } else if (moved) {
        createWireFromDrag(from, { free: true, x: rubber.x, y: rubber.y }, corners, route);
        persist();
        render();
        properties();
      } else {
        $('status').textContent = 'ยกเลิกการเดินสาย';
        render();
        properties();
      }
    } else if (kind === 'bend') {
      if (drag._holdClear) drag._holdClear();
      const w = state().wires.find((x) => x.id === drag.wireId);
      if (w && drag.remove && w.bends.length) {
        w.bends.splice(drag.index, 1);
        $('status').textContent = 'ลบมุมแล้ว';
      }
      if (w) rerouteWire(w);
      drag = null;
      render();
      properties();
      persist();
    } else if (kind === 'free-end') {
      const w = state().wires.find((x) => x.id === drag.wireId);
      if (w) rerouteWire(w);
      drag = null;
      render();
      properties();
      persist();
    } else if (kind === 'rail') {
      // devices glued to rail already moved — re-octilinearize their wires
      state().wires.forEach((w) => rerouteWire(w));
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
    const stub = isTerminalBar(t)
      ? { type: t.id, holes: t.holesDefault || 8, lengthMm: barLenFromHoles(t.holesDefault || 8), orient: 'h', role: t.roleDefault || 'N', x: 0, y: 0 }
      : { x: 0, y: 0 };
    const w = deviceWidth(t, stub);
    const h = deviceHeight(t, stub);
    const step = t.freePlace ? Math.max(GRID * 4, 10) : MODULE;
    const ys = t.freePlace ? [p.y + 20, p.y + p.h / 2, p.y + p.h - h - 20] : railYs().map((ry) => ry - railOffset(t));
    const x0 = t.freePlace ? p.x + 8 : railDrawX();
    const xLim = t.freePlace ? p.x + p.w - 4 : railDrawX() + railUsableWidth();
    for (const y0 of ys) {
      for (let x = x0; x + w <= xLim; x += step) {
        const pos = clampDevice({ ...stub, x, y: y0 }, t);
        const overlap = state().devices.some((d) => {
          const dt = spec(d.type);
          if (!dt) return false;
          const dw = deviceWidth(dt, d);
          const dh = deviceHeight(dt, d);
          return !(pos.x + w + 4 <= d.x || d.x + dw + 4 <= pos.x || pos.y + h + 4 <= d.y || d.y + dh + 4 <= pos.y);
        });
        if (!overlap) return pos;
      }
    }
    return clampDevice({ ...stub, x: x0, y: ys[0] }, t);
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
      state().wires = state().wires.filter((w) => !wireTouchesDevice(w, selected));
      selected = null;
    } else return;
    render();
    properties();
    persist();
  }

  function setTool(tName) {
    tool = tName;
    ['move', 'wire'].forEach((x) => $(x).classList.toggle('active', x === tName));
    document.querySelector('.stage-wrap')?.classList.toggle('wire-mode', tName === 'wire');
    if (tName !== 'wire') {
      wireSketch = null;
      updateWireDoneBtn();
    }
    $('status').textContent =
      tName === 'wire'
        ? 'โหมดสาย: หักมุมได้เฉพาะ 45° · ค้าง/แตะวางมุม · สองนิ้วเลื่อน/ซูม'
        : 'ลากอุปกรณ์/ราง · ลากขั้วเพื่อเดินสาย · ลากพื้นว่างเพื่อเลื่อนมุมมอง';
  }

  /* —— Board pan / zoom / empty click —— */
  const board = $('board');
  board.addEventListener('pointerdown', (e) => {
    const empty =
      e.target.classList?.contains('bg-hit') ||
      e.target.classList?.contains('plate') ||
      e.target.classList?.contains('duct') ||
      e.target.classList?.contains('rail') ||
      e.target === board;
    if (!empty) return;

    // Tap-by-tap: add corner / double-tap finish
    if (tool === 'wire' && wireSketch && wireSketch.from && pointers.size < 2) {
      const pt = point(e);
      const term = findTerminalAt(pt, wireSketch.from);
      if (term) {
        finishWireSketch(term);
        return;
      }
      const now = Date.now();
      const corners = wireSketch.corners || (wireSketch.corners = []);
      if (now - (wireSketch.lastTapMs || 0) < 320 && corners.length) {
        finishWireSketch(null);
        return;
      }
      const anchor = lastCornerAnchor(wireSketch.from, corners);
      const snapped = snap45From(anchor, pt);
      corners.push(snapped);
      wireSketch.lastTapMs = now;
      updateWireDoneBtn();
      $('status').textContent = `มุม 45° × ${corners.length} · แตะขั้วปลาย / ดับเบิลแตะ / เสร็จ`;
      render();
      return;
    }

    if (tool === 'move' || e.button === 1 || e.altKey) {
      const c = cabinet();
      const fitPx = parseFloat(board.style.width) || board.getBoundingClientRect().width;
      drag = { kind: 'pan', cx: e.clientX, cy: e.clientY, ox: cam.x, oy: cam.y, fitPx };
      try {
        board.setPointerCapture(e.pointerId);
      } catch (_) {}
    } else if (tool === 'wire') {
      // empty click in wire mode without sketch — deselect
      selected = selectedWire = null;
      properties();
      render();
    } else {
      selected = selectedWire = null;
      properties();
      render();
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

  // Pinch zoom — two fingers pan/zoom; cancels one-finger wire draw
  board.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && drag && drag.kind === 'wire') {
      // abandon freehand draw when second finger lands
      drag = null;
      clearDomGhost();
      render();
    }
  });
  board.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && (!drag || drag.kind === 'pan' || drag.kind === 'pinch' || drag.kind === 'wire')) {
      if (drag && drag.kind === 'wire') drag = null;
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      if (!drag || drag.kind !== 'pinch') {
        const c = cabinet();
        const fitPx = parseFloat(board.style.width) || board.getBoundingClientRect().width;
        drag = { kind: 'pinch', dist, midX, midY, cx: midX, cy: midY, ox: cam.x, oy: cam.y, fitPx };
      } else if (drag.dist > 0) {
        zoomAt(dist / drag.dist, midX, midY);
        // two-finger pan
        const dx = (midX - drag.cx) / (drag.fitPx / cabinet().width) / cam.zoom;
        const dy = (midY - drag.cy) / (drag.fitPx / cabinet().width) / cam.zoom;
        cam.x = drag.ox - dx;
        cam.y = drag.oy - dy;
        drag.cx = midX;
        drag.cy = midY;
        drag.ox = cam.x;
        drag.oy = cam.y;
        drag.dist = dist;
        applyCamera();
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
    $(tName).onclick = () => setTool(tName);
  });
  $('wire-done').onclick = () => {
    if (wireSketch) finishWireSketch(null);
  };
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
    const order = ROUTES;
    const i = order.indexOf(normalizeRoute(w.route));
    w.route = order[(i + 1) % order.length];
    if (w.route === 'vhv' || w.route === 'hvh') w.bends = defaultBends(resolveEnd(w.a), resolveEnd(w.b), w.route);
    else {
      const a = resolveEnd(w.a);
      const b = resolveEnd(w.b);
      w.bends = a && b ? octilinearizePath(a, w.bends, b) : [];
    }
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
  function selectedBar() {
    const d = state().devices.find((x) => x.id === selected);
    return d && isTerminalBar(spec(d.type)) ? d : null;
  }
  $('bar-holes-minus').onclick = () => {
    const d = selectedBar();
    if (!d) return;
    checkpoint();
    if (!applyBarHoles(d, barHoles(d, spec(d.type)) - 1)) return;
    syncBarRating(d);
    render();
    properties();
    persist();
  };
  $('bar-holes-plus').onclick = () => {
    const d = selectedBar();
    if (!d) return;
    checkpoint();
    if (!applyBarHoles(d, barHoles(d, spec(d.type)) + 1)) return;
    syncBarRating(d);
    render();
    properties();
    persist();
  };
  $('bar-holes').onchange = () => {
    const d = selectedBar();
    if (!d) return;
    checkpoint();
    if (!applyBarHoles(d, parseInt($('bar-holes').value, 10))) {
      properties();
      return;
    }
    syncBarRating(d);
    render();
    properties();
    persist();
  };
  $('bar-length').onchange = () => {
    const d = selectedBar();
    if (!d) return;
    checkpoint();
    const len = Math.max(40, Math.min(240, Math.round(Number($('bar-length').value) || barLenFromHoles(d.holes))));
    d.lengthMm = len;
    const pos = clampDevice(d, spec(d.type));
    d.x = pos.x;
    d.y = pos.y;
    syncBarRating(d);
    rerouteConnected(d.id);
    render();
    properties();
    persist();
  };
  $('bar-orient-h').onclick = () => {
    const d = selectedBar();
    if (!d || barOrient(d) === 'h') return;
    checkpoint();
    rotateTerminalBar(d);
    rerouteConnected(d.id);
    render();
    properties();
    persist();
  };
  $('bar-orient-v').onclick = () => {
    const d = selectedBar();
    if (!d || barOrient(d) === 'v') return;
    checkpoint();
    rotateTerminalBar(d);
    rerouteConnected(d.id);
    render();
    properties();
    persist();
  };
  $('bar-rotate').onclick = () => {
    const d = selectedBar();
    if (!d) return;
    checkpoint();
    rotateTerminalBar(d);
    rerouteConnected(d.id);
    render();
    properties();
    persist();
  };
  $('bar-role').onchange = () => {
    const d = selectedBar();
    if (!d) return;
    checkpoint();
    d.role = barRole({ role: $('bar-role').value }, spec(d.type));
    if (!d.label || /^(บาร์ N|บาร์ PE|บาร์เทอร์มินัล|บาร์เทอร์มินัล N\/PE)$/.test(d.label)) {
      d.label = d.role === 'PE' ? 'บาร์ PE' : d.role === 'N' ? 'บาร์ N' : 'บาร์เทอร์มินัล';
    }
    syncBarRating(d);
    render();
    properties();
    persist();
  };
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
    w.route = normalizeRoute($('wprop-route').value);
    if (w.route === 'vhv' || w.route === 'hvh') w.bends = defaultBends(resolveEnd(w.a), resolveEnd(w.b), w.route);
    else {
      const a = resolveEnd(w.a);
      const b = resolveEnd(w.b);
      w.bends = a && b ? octilinearizePath(a, w.route === 'straight' ? [] : w.bends, b) : [];
    }
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
      wireSketch = null;
      updateWireDoneBtn();
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
