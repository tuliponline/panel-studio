/* Panel Studio v9 — octilinear wires · plate busbars (brass / I-din / copper) */
(() => {
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const C = window.PANEL_CATALOG;
  const MODULE = C.MODULE_MM;
  const STORAGE = 'panel-studio-v1';
  const DESIGNS_KEY = 'panel-studio-designs-v1';
  const SESSION_KEY = 'panel-studio-session-v1';
  const VERSION = 9;
  const LONG_PRESS_MS = 380;
  const MOVE_THRESH = 8;
  const CORNER_HOLD_MS = 400;
  const RDP_MIGRATE_EPS = 8;
  const GRID = 2.5;
  const TERM_SNAP = 22;
  const ROUTES = ['free', 'vhv', 'hvh', 'straight'];
  const DEG45 = Math.PI / 4;
  /** Plate-mounted busbar profiles (mm) */
  const BAR_STYLES = {
    brass: {
      minHoles: 4,
      maxHoles: 12,
      presets: [4, 6, 8, 10, 12],
      sections: {
        '6x9': { sectionW: 6, sectionH: 9, pitch: 8.5, height: 25, footW: 14, footLen: 20, endInset: 5, stripW: 22 },
        '8x12': { sectionW: 8, sectionH: 12, pitch: 11, height: 32, footW: 18, footLen: 24, endInset: 6, stripW: 28 }
      }
    },
    idin: {
      minHoles: 3,
      maxHoles: 13,
      presets: [3, 5, 7, 9, 11],
      sections: {
        default: { sectionW: 12, sectionH: 3.5, pitch: 10, height: 18, footW: 16, footLen: 14, endInset: 8, tabLen: 12, stripW: 16 }
      },
      mixedEnds: true
    },
    copper: {
      minHoles: 4,
      maxHoles: 12,
      presets: [4, 5, 6, 8, 10],
      ratingAmps: 110,
      sections: {
        default: { sectionW: 20, sectionH: 5, pitch: 18, height: 40, footW: 30, footLen: 30, endInset: 12, standoffR: 15, stripW: 32 }
      }
    }
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
  /** Display stroke width → conductor cross-section (mm²) */
  const WIRE_MM2 = {
    2: 1.5,
    2.5: 2.5,
    3.5: 4,
    5: 6,
    6.5: 10
  };
  const CAT_ORDER = ['protection', 'control', 'hmi', 'connect', 'busbar', 'automation'];
  const DEFAULT_WIRE_SLACK_MM = 100;

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
    settings: { wireSlackMm: DEFAULT_WIRE_SLACK_MM },
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
  function barStyleOf(t) {
    const s = (t && t.barStyle) || 'brass';
    return BAR_STYLES[s] ? s : 'brass';
  }
  function barProfile(t, d) {
    const style = barStyleOf(t);
    const cfg = BAR_STYLES[style];
    let secKey = 'default';
    if (style === 'brass') {
      secKey = (d && d.section) || (t && t.sectionDefault) || '6x9';
      if (!cfg.sections[secKey]) secKey = '6x9';
    }
    const sec = cfg.sections[secKey];
    let baseStyle = 'block';
    if (style === 'brass') {
      const b = (d && d.baseStyle) || (t && t.baseDefault) || 'block';
      baseStyle = b === 'wing' ? 'wing' : 'block';
    }
    return { style, cfg, sec, secKey, baseStyle };
  }
  function barRole(d, t) {
    const r = (d && d.role) || (t && t.roleDefault) || 'N';
    return r === 'PE' || r === 'generic' ? r : 'N';
  }
  function barOrient(d) {
    return d && d.orient === 'v' ? 'v' : 'h';
  }
  function barHoleLimits(t, d) {
    const { cfg } = barProfile(t, d);
    return { min: cfg.minHoles, max: cfg.maxHoles, presets: cfg.presets };
  }
  function barHoles(d, t) {
    const { min, max } = barHoleLimits(t, d);
    const n = Number(d && d.holes != null ? d.holes : t && t.holesDefault);
    if (!Number.isFinite(n)) return Math.min(max, Math.max(min, 8));
    return Math.max(min, Math.min(max, Math.round(n)));
  }
  function barLenFromHoles(n, t, d) {
    const { cfg, sec, style, baseStyle } = barProfile(t, d);
    const holes = Math.max(cfg.minHoles, Math.min(cfg.maxHoles, n | 0));
    const metal = (holes - 1) * sec.pitch + 2 * sec.endInset;
    if (style === 'idin') return Math.round(2 * sec.tabLen + metal);
    if (style === 'copper') return Math.round(2 * sec.footLen * 0.55 + metal);
    const wingExtra = baseStyle === 'wing' ? 8 : 0;
    return Math.round(2 * sec.footLen + metal - 10 + wingExtra);
  }
  function holesFromBarLen(len, t, d) {
    const { cfg, sec, style } = barProfile(t, d);
    const L = Math.max(40, Number(len) || 40);
    const overhead = style === 'idin' ? 2 * sec.tabLen : style === 'copper' ? sec.footLen * 1.1 : 2 * sec.footLen - 10;
    const metal = Math.max(sec.pitch, L - overhead);
    const n = Math.round((metal - 2 * sec.endInset) / sec.pitch) + 1;
    return Math.max(cfg.minHoles, Math.min(cfg.maxHoles, n));
  }
  function terminalBarGeom(d, t) {
    t = t || (d && spec(d.type));
    const { style, cfg, sec, secKey, baseStyle } = barProfile(t, d);
    const holes = barHoles(d, t);
    let lengthMm = Number(d && d.lengthMm);
    if (!Number.isFinite(lengthMm) || lengthMm < 40) lengthMm = barLenFromHoles(holes, t, d);
    const maxLen = barLenFromHoles(cfg.maxHoles, t, d) + 40;
    lengthMm = Math.max(barLenFromHoles(cfg.minHoles, t, d), Math.min(maxLen, Math.round(lengthMm)));
    const orient = barOrient(d);
    const role = barRole(d, t);
    let footprint = sec.height;
    if (style === 'brass' && baseStyle === 'wing') footprint = Math.max(footprint, sec.stripW);
    if (style === 'copper') footprint = Math.max(sec.height, sec.stripW);
    if (style === 'idin') footprint = Math.max(sec.height, sec.stripW);
    const w = orient === 'v' ? footprint : lengthMm;
    const h = orient === 'v' ? lengthMm : footprint;
    return {
      style,
      holes,
      lengthMm,
      orient,
      role,
      w,
      h,
      pitch: sec.pitch,
      sectionW: sec.sectionW,
      sectionH: sec.sectionH,
      sec,
      secKey,
      baseStyle,
      mixedEnds: !!cfg.mixedEnds,
      ratingAmps: cfg.ratingAmps || t.ratingAmps || 0,
      presets: cfg.presets,
      minHoles: cfg.minHoles,
      maxHoles: cfg.maxHoles
    };
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
    if (typeof e.id === 'string' && Number.isInteger(e.i) && e.i >= 0 && e.i < 16 && devices.some((x) => x.id === e.id)) {
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
    const slack = Number(raw.settings && raw.settings.wireSlackMm);
    const out = {
      version: VERSION,
      settings: {
        wireSlackMm: Number.isFinite(slack) ? Math.max(0, Math.min(500, Math.round(slack))) : DEFAULT_WIRE_SLACK_MM
      },
      AC: null,
      DC: null
    };
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
          nd.lengthMm = Number.isFinite(Number(d.lengthMm)) ? Math.round(Number(d.lengthMm)) : barLenFromHoles(nd.holes, t, d);
          nd.orient = d.orient === 'v' ? 'v' : 'h';
          nd.role = barRole(d, t);
          if (barStyleOf(t) === 'brass') {
            nd.section = d.section === '8x12' ? '8x12' : '6x9';
            nd.baseStyle = d.baseStyle === 'wing' ? 'wing' : 'block';
          }
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
  /* —— Named designs library —— */
  let designSession = { id: null, name: 'แบบใหม่', savedJson: null };

  function emptyProject() {
    return {
      version: VERSION,
      settings: { wireSlackMm: getWireSlackMm() },
      AC: { devices: [], wires: [], cabinet: DEFAULT_CAB('AC') },
      DC: { devices: [], wires: [], cabinet: DEFAULT_CAB('DC') }
    };
  }
  function getWireSlackMm() {
    const n = Number(data.settings && data.settings.wireSlackMm);
    if (Number.isFinite(n)) return Math.max(0, Math.min(500, Math.round(n)));
    return DEFAULT_WIRE_SLACK_MM;
  }
  function setWireSlackMm(v) {
    if (!data.settings) data.settings = {};
    data.settings.wireSlackMm = Math.max(0, Math.min(500, Math.round(Number(v) || 0)));
  }
  function cloneData(src) {
    return JSON.parse(JSON.stringify(src));
  }
  function readDesignLibrary() {
    try {
      const raw = JSON.parse(localStorage.getItem(DESIGNS_KEY));
      if (!raw || typeof raw !== 'object') return { version: 1, designs: [] };
      const designs = Array.isArray(raw.designs)
        ? raw.designs
            .filter((d) => d && typeof d.id === 'string' && typeof d.name === 'string' && d.data)
            .map((d) => ({
              id: d.id,
              name: String(d.name).slice(0, 80),
              createdAt: Number(d.createdAt) || Date.now(),
              updatedAt: Number(d.updatedAt) || Date.now(),
              data: d.data
            }))
        : [];
      designs.sort((a, b) => b.updatedAt - a.updatedAt);
      return { version: 1, designs };
    } catch (_) {
      return { version: 1, designs: [] };
    }
  }
  function writeDesignLibrary(lib) {
    try {
      localStorage.setItem(DESIGNS_KEY, JSON.stringify(lib));
      return true;
    } catch (_) {
      $('status').textContent = 'พื้นที่บันทึกเต็ม — ลบบางแบบหรือส่งออกเป็นไฟล์';
      return false;
    }
  }
  function formatSavedAt(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString('th-TH', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    } catch (_) {
      return new Date(ts).toLocaleString();
    }
  }
  function isDesignDirty() {
    if (designSession.savedJson == null) return true;
    return JSON.stringify(data) !== designSession.savedJson;
  }
  function markDesignSaved(id, name) {
    designSession.id = id || null;
    designSession.name = (name || 'แบบใหม่').slice(0, 80);
    designSession.savedJson = JSON.stringify(data);
    persistSession();
    updateDesignChrome();
  }
  function persistSession() {
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          id: designSession.id,
          name: designSession.name,
          savedJson: designSession.savedJson
        })
      );
    } catch (_) {}
  }
  function loadSessionMeta() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (!s || typeof s !== 'object') return;
      if (typeof s.name === 'string' && s.name.trim()) designSession.name = s.name.slice(0, 80);
      if (typeof s.id === 'string') designSession.id = s.id;
      if (typeof s.savedJson === 'string') designSession.savedJson = s.savedJson;
    } catch (_) {}
  }
  function updateDesignChrome() {
    const dirty = isDesignDirty();
    const badge = $('design-badge');
    const nameEl = $('design-name');
    if (nameEl) nameEl.textContent = designSession.name || 'แบบใหม่';
    if (badge) badge.classList.toggle('dirty', dirty);
    const meta = $('design-sheet-meta');
    if (meta) {
      const lib = designSession.id ? readDesignLibrary().designs.find((d) => d.id === designSession.id) : null;
      meta.textContent = dirty
        ? `「${designSession.name}」 · มีการแก้ไขที่ยังไม่บันทึก`
        : `「${designSession.name}」 · บันทึกล่าสุด ${formatSavedAt(lib?.updatedAt || Date.now())}`;
    }
    document.title = `${dirty ? '• ' : ''}${designSession.name} · Panel Studio`;
  }
  function askDesignName(prefill) {
    const base = (prefill || designSession.name || 'แบบใหม่').slice(0, 80);
    const name = window.prompt('ชื่อแบบที่ต้องการบันทึก', base);
    if (name == null) return null;
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) {
      $('status').textContent = 'ต้องระบุชื่อแบบ';
      return null;
    }
    return trimmed;
  }
  function saveCurrentDesign() {
    const name = askDesignName(designSession.name);
    if (!name) return false;
    const lib = readDesignLibrary();
    const now = Date.now();
    const payload = cloneData(data);
    let entry = designSession.id ? lib.designs.find((d) => d.id === designSession.id) : null;
    if (entry) {
      entry.name = name;
      entry.updatedAt = now;
      entry.data = payload;
    } else {
      entry = {
        id: crypto.randomUUID(),
        name,
        createdAt: now,
        updatedAt: now,
        data: payload
      };
      lib.designs.unshift(entry);
    }
    if (!writeDesignLibrary(lib)) return false;
    markDesignSaved(entry.id, name);
    $('status').textContent = `บันทึก「${name}」แล้ว`;
    renderDesignList();
    return true;
  }
  function loadDesignById(id, opts) {
    const lib = readDesignLibrary();
    const entry = lib.designs.find((d) => d.id === id);
    if (!entry) {
      $('status').textContent = 'ไม่พบแบบที่เลือก';
      return false;
    }
    const m = migrate(entry.data);
    if (!m) {
      $('status').textContent = 'แบบนี้เปิดไม่ได้ (ข้อมูลเสีย)';
      return false;
    }
    if (!(opts && opts.skipConfirm) && isDesignDirty()) {
      if (!confirm('มีการแก้ไขที่ยังไม่บันทึก — เปิดแบบอื่นและทิ้งการแก้ไข?')) return false;
    }
    if (!(opts && opts.skipCheckpoint)) checkpoint();
    data = m;
    mode = 'AC';
    selected = selectedWire = null;
    history = [];
    future = [];
    designSession.id = entry.id;
    designSession.name = entry.name;
    designSession.savedJson = JSON.stringify(data);
    persistSession();
    persist();
    fillPresets();
    syncCabinetForm();
    setMode('AC');
    renderCatalog();
    fitCamera();
    render();
    properties();
    updateUndoRedo();
    updateDesignChrome();
    $('status').textContent = `เปิด「${entry.name}」แล้ว`;
    return true;
  }
  function renameDesign(id) {
    const lib = readDesignLibrary();
    const entry = lib.designs.find((d) => d.id === id);
    if (!entry) return;
    const name = askDesignName(entry.name);
    if (!name) return;
    entry.name = name;
    entry.updatedAt = Date.now();
    if (!writeDesignLibrary(lib)) return;
    if (designSession.id === id) {
      designSession.name = name;
      persistSession();
    }
    renderDesignList();
    updateDesignChrome();
    $('status').textContent = `เปลี่ยนชื่อเป็น「${name}」แล้ว`;
  }
  function duplicateDesign(id) {
    const lib = readDesignLibrary();
    const entry = lib.designs.find((d) => d.id === id);
    if (!entry) return;
    const name = askDesignName(`${entry.name} (สำเนา)`);
    if (!name) return;
    const now = Date.now();
    const copy = {
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      data: cloneData(entry.data)
    };
    lib.designs.unshift(copy);
    if (!writeDesignLibrary(lib)) return;
    renderDesignList();
    $('status').textContent = `ทำสำเนา「${name}」แล้ว`;
  }
  function deleteDesign(id) {
    const lib = readDesignLibrary();
    const entry = lib.designs.find((d) => d.id === id);
    if (!entry) return;
    if (!confirm(`ลบแบบ「${entry.name}」ถาวร?`)) return;
    lib.designs = lib.designs.filter((d) => d.id !== id);
    if (!writeDesignLibrary(lib)) return;
    if (designSession.id === id) {
      designSession.id = null;
      designSession.savedJson = null;
      persistSession();
    }
    renderDesignList();
    updateDesignChrome();
    $('status').textContent = `ลบ「${entry.name}」แล้ว`;
  }
  function newDesign() {
    if (isDesignDirty()) {
      if (!confirm('มีการแก้ไขที่ยังไม่บันทึก — สร้างแบบใหม่และทิ้งการแก้ไข?')) return;
    }
    checkpoint();
    data = emptyProject();
    mode = 'AC';
    selected = selectedWire = null;
    history = [];
    future = [];
    designSession = { id: null, name: 'แบบใหม่', savedJson: JSON.stringify(data) };
    persistSession();
    persist();
    fillPresets();
    syncCabinetForm();
    setMode('AC');
    renderCatalog();
    fitCamera();
    render();
    properties();
    updateUndoRedo();
    updateDesignChrome();
    closeDesignsModal();
    $('status').textContent = 'สร้างแบบใหม่แล้ว';
  }
  function exportDesignJson() {
    const name = (designSession.name || 'panel-design').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);
    const payload = {
      format: 'panel-studio-design',
      formatVersion: 1,
      name: designSession.name,
      id: designSession.id,
      exportedAt: new Date().toISOString(),
      data: cloneData(data)
    };
    download(`${name}.json`, JSON.stringify(payload, null, 2), 'application/json');
    $('status').textContent = `ส่งออก「${designSession.name}」เป็นไฟล์แล้ว`;
  }
  function importDesignFromObject(raw) {
    let name = null;
    let payload = raw;
    if (raw && raw.format === 'panel-studio-design' && raw.data) {
      payload = raw.data;
      if (typeof raw.name === 'string') name = raw.name.slice(0, 80);
    }
    const m = migrate(payload);
    if (!m) return false;
    if (isDesignDirty() && !confirm('มีการแก้ไขที่ยังไม่บันทึก — นำเข้าแบบและทิ้งการแก้ไข?')) return false;
    checkpoint();
    data = m;
    mode = 'AC';
    selected = selectedWire = null;
    history = [];
    future = [];
    designSession.id = null;
    designSession.name = name || 'แบบนำเข้า';
    designSession.savedJson = null; // dirty until user saves into library
    persistSession();
    persist();
    fillPresets();
    syncCabinetForm();
    setMode('AC');
    renderCatalog();
    fitCamera();
    render();
    properties();
    updateUndoRedo();
    updateDesignChrome();
    $('status').textContent = `นำเข้า「${designSession.name}」แล้ว — กดบันทึกเพื่อเก็บในแบบของฉัน`;
    return true;
  }
  function renderDesignList() {
    const box = $('design-list');
    const empty = $('design-empty');
    if (!box) return;
    const lib = readDesignLibrary();
    box.replaceChildren();
    if (empty) empty.hidden = lib.designs.length > 0;
    lib.designs.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'design-item' + (entry.id === designSession.id ? ' active' : '');
      const info = document.createElement('div');
      info.innerHTML = `<strong>${escapeHtml(entry.name)}</strong><div class="meta">บันทึกล่าสุด ${escapeHtml(formatSavedAt(entry.updatedAt))}</div>`;
      const actions = document.createElement('div');
      actions.className = 'actions';
      const mkBtn = (label, cls, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (cls) b.className = cls;
        b.onclick = (e) => {
          e.stopPropagation();
          fn();
        };
        return b;
      };
      actions.append(
        mkBtn('เปิด', 'primary', () => {
          if (loadDesignById(entry.id)) closeDesignsModal();
        }),
        mkBtn('ชื่อ', null, () => renameDesign(entry.id)),
        mkBtn('สำเนา', null, () => duplicateDesign(entry.id)),
        mkBtn('ลบ', 'danger', () => deleteDesign(entry.id))
      );
      row.append(info, actions);
      row.onclick = () => {
        if (loadDesignById(entry.id)) closeDesignsModal();
      };
      box.append(row);
    });
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function openDesignsModal() {
    const modal = $('designs-modal');
    if (!modal) return;
    renderDesignList();
    modal.classList.add('show');
  }
  function closeDesignsModal() {
    const modal = $('designs-modal');
    if (modal) modal.classList.remove('show');
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
  loadSessionMeta();
  // If session points at a library entry, trust its name; sync savedJson to current draft
  if (designSession.savedJson == null) {
    // first run after upgrade: treat autosaved draft as clean under current name
    designSession.savedJson = JSON.stringify(data);
  }

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
    updateDesignChrome();
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
      const margin = g.style === 'copper' ? g.sec.footLen * 0.45 : g.style === 'idin' ? g.sec.tabLen + 2 : 12;
      const usable = Math.max(g.pitch, g.lengthMm - 2 * margin);
      const alongAxis = g.orient === 'h' ? g.h * 0.35 : g.w * 0.35;
      return Array.from({ length: g.holes }, (_, i) => {
        const along = margin + (g.holes === 1 ? usable / 2 : (i * usable) / (g.holes - 1));
        const large = g.mixedEnds && (i === 0 || i === g.holes - 1);
        if (g.orient === 'h') {
          return { x: d.x + along, y: d.y + alongAxis, label: `${base}${i + 1}`, top: true, large };
        }
        return { x: d.x + alongAxis, y: d.y + along, label: `${base}${i + 1}`, top: true, large };
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
    const { min, max } = barHoleLimits(t, d);
    n = Math.max(min, Math.min(max, Math.round(n)));
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
    if (!(opts && opts.keepLength)) d.lengthMm = barLenFromHoles(n, t, d);
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
    if (g.style === 'copper') d.rating = `${g.ratingAmps || 110}A · ${g.holes} จุด`;
    else if (g.style === 'idin') d.rating = `${role} · ${g.holes} จุด`;
    else d.rating = `${g.secKey} · ${role} · ${g.holes} ช่อง`;
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
  function polylineLengthMm(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return len;
  }
  function wireCrossSectionMm2(w) {
    const key = Number(w && w.width);
    if (WIRE_MM2[key] != null) return WIRE_MM2[key];
    // nearest known gauge
    const keys = Object.keys(WIRE_MM2).map(Number).sort((a, b) => a - b);
    let best = keys[0];
    keys.forEach((k) => {
      if (Math.abs(k - key) < Math.abs(best - key)) best = k;
    });
    return WIRE_MM2[best];
  }
  function wireColorLabel(hex) {
    const h = String(hex || '').toLowerCase();
    for (const list of Object.values(WIRE_COLORS)) {
      const hit = list.find(([c]) => c.toLowerCase() === h);
      if (hit) return hit[1];
    }
    return hex || '—';
  }
  function metresCeilFromMm(mm) {
    // round up to next 0.1 m for purchasing
    return Math.ceil(Math.max(0, mm) / 100) / 10;
  }
  function busbarStudForEnd(d, t, portIndex) {
    if (isTerminalBar(t)) {
      const g = terminalBarGeom(d, t);
      if (g.style === 'copper') return 'M6';
      if (g.style === 'idin') {
        const pt = ports(d)[portIndex];
        return pt && pt.large ? 'M5' : 'M4';
      }
      return g.secKey === '8x12' ? 'M5' : 'M4';
    }
    if (t.isBar) {
      if ((t.id || '').includes('PE') || (t.name || '').includes('PE')) return 'M5';
      return 'M4';
    }
    return 'M5';
  }
  function lugForWireEnd(end, mm2) {
    if (!end || isFreeEnd(end)) {
      return {
        key: `fork|${mm2}`,
        kind: 'fork',
        mm2,
        stud: null,
        nameTh: `หางปลาแฉก ${mm2} มม²`,
        hint: 'ปลายอิสระ / จุดเปิด'
      };
    }
    const d = state().devices.find((x) => x.id === end.id);
    const t = d && spec(d.type);
    if (!t) {
      return { key: `ferrule|${mm2}`, kind: 'ferrule', mm2, stud: null, nameTh: `หางปลาเข็ม ${mm2} มม²`, hint: 'เทอร์มินัลสกรู' };
    }
    if (isTerminalBar(t) || t.isBar) {
      const stud = busbarStudForEnd(d, t, end.i);
      return {
        key: `ring|${stud}|${mm2}`,
        kind: 'ring',
        mm2,
        stud,
        nameTh: `หางปลากลม ${stud} · ${mm2} มม²`,
        hint: t.nameTh || t.name || 'บัสบาร์'
      };
    }
    // Screw-clamp DIN devices: breakers, contactors, relays, TB, meters on DIN, etc.
    if (t.freePlace && (t.cat === 'hmi' || t.cat === 'automation')) {
      return {
        key: `fork|${mm2}`,
        kind: 'fork',
        mm2,
        stud: null,
        nameTh: `หางปลาแฉก ${mm2} มม²`,
        hint: t.nameTh || 'หน้าตู้'
      };
    }
    return {
      key: `ferrule|${mm2}`,
      kind: 'ferrule',
      mm2,
      stud: null,
      nameTh: `หางปลาเข็ม (Ferrule) ${mm2} มม²`,
      hint: 'ขั้วสกรู DIN / เบรกเกอร์ / คอนแทคเตอร์'
    };
  }
  function deviceBomLabel(d, t) {
    const name = t.nameTh || t.name || d.type;
    if (isTerminalBar(t)) {
      const g = terminalBarGeom(d, t);
      if (g.style === 'copper') return `${name} (${g.ratingAmps || 110}A · ${g.holes} จุด)`;
      if (g.style === 'idin') return `${name} (${g.holes} จุด)`;
      return `${name} (${g.secKey} · ${g.baseStyle === 'wing' ? 'ปีก' : 'มาตรฐาน'} · ${g.holes} ช่อง)`;
    }
    const bits = [name];
    if (t.brand) bits.push(t.brand + (t.model ? ' ' + t.model : ''));
    if (d.rating && d.rating !== t.ratingDefault) bits.push(d.rating);
    return bits.join(' · ');
  }
  function computeBom() {
    const slack = getWireSlackMm();
    const deviceMap = new Map();
    state().devices.forEach((d) => {
      const t = spec(d.type);
      if (!t) return;
      const label = deviceBomLabel(d, t);
      const cat = t.cat || 'other';
      const key = cat + '||' + label;
      const cur = deviceMap.get(key) || { cat, label, qty: 0, modules: t.modules || 0 };
      cur.qty += 1;
      deviceMap.set(key, cur);
    });
    const devicesByCat = {};
    deviceMap.forEach((row) => {
      if (!devicesByCat[row.cat]) devicesByCat[row.cat] = [];
      devicesByCat[row.cat].push(row);
    });
    Object.values(devicesByCat).forEach((arr) => arr.sort((a, b) => a.label.localeCompare(b.label, 'th')));

    const wireMap = new Map();
    let drawnMm = 0;
    let slackMm = 0;
    state().wires.forEach((w) => {
      const pts = wirePolyline(w);
      const geom = polylineLengthMm(pts);
      const addSlack = slack * 2;
      drawnMm += geom;
      slackMm += addSlack;
      const mm2 = wireCrossSectionMm2(w);
      const color = (w.color || '').toLowerCase();
      const key = `${mm2}|${color}`;
      const cur = wireMap.get(key) || {
        mm2,
        color: w.color,
        colorLabel: wireColorLabel(w.color),
        count: 0,
        drawnMm: 0,
        slackMm: 0
      };
      cur.count += 1;
      cur.drawnMm += geom;
      cur.slackMm += addSlack;
      wireMap.set(key, cur);
    });
    const wires = [...wireMap.values()]
      .map((row) => ({
        ...row,
        totalMm: row.drawnMm + row.slackMm,
        metres: metresCeilFromMm(row.drawnMm + row.slackMm)
      }))
      .sort((a, b) => a.mm2 - b.mm2 || a.colorLabel.localeCompare(b.colorLabel, 'th'));

    const lugMap = new Map();
    state().wires.forEach((w) => {
      const mm2 = wireCrossSectionMm2(w);
      [w.a, w.b].forEach((end) => {
        const lug = lugForWireEnd(end, mm2);
        const cur = lugMap.get(lug.key) || { ...lug, qty: 0 };
        cur.qty += 1;
        lugMap.set(lug.key, cur);
      });
    });
    const kindOrder = { ferrule: 0, ring: 1, fork: 2 };
    const lugs = [...lugMap.values()].sort(
      (a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) || a.mm2 - b.mm2 || (a.stud || '').localeCompare(b.stud || '')
    );

    const totalMm = drawnMm + slackMm;
    return {
      slack,
      devicesByCat,
      deviceCount: state().devices.length,
      wires,
      wireCount: state().wires.length,
      drawnMm,
      slackMm,
      totalMm,
      totalMetres: metresCeilFromMm(totalMm),
      lugs,
      lugCount: lugs.reduce((s, x) => s + x.qty, 0)
    };
  }
  function bomToText(bom) {
    const lines = [];
    lines.push(`สรุปรายการวัสดุ — ${designSession.name || 'แบบ'}`);
    lines.push(`โหมด ${mode} · เผื่อปลายสาย ${bom.slack} มม./ด้าน`);
    lines.push('');
    lines.push('## อุปกรณ์ (ตามหมวด)');
    const cats = [...CAT_ORDER, ...Object.keys(bom.devicesByCat).filter((c) => !CAT_ORDER.includes(c))];
    cats.forEach((cat) => {
      const rows = bom.devicesByCat[cat];
      if (!rows || !rows.length) return;
      lines.push(`### ${C.categories[cat] || cat}`);
      rows.forEach((r) => lines.push(`- ${r.label} × ${r.qty}`));
    });
    if (!bom.deviceCount) lines.push('(ไม่มีอุปกรณ์)');
    lines.push('');
    lines.push('## สายไฟ');
    lines.push(`ความยาวจากเส้นจริง ${Math.round(bom.drawnMm)} มม. + เผื่อปลาย ${Math.round(bom.slackMm)} มม. = รวม ${bom.totalMetres} ม. (ปัดขึ้น 0.1 ม.)`);
    if (bom.wires.length) {
      bom.wires.forEach((w) => {
        lines.push(`- ${w.mm2} มม² · ${w.colorLabel} · ${w.count} เส้น · ${w.metres} ม.`);
      });
    } else lines.push('(ไม่มีสาย)');
    lines.push('');
    lines.push('## หางปลา / ขั้วสาย');
    if (bom.lugs.length) {
      bom.lugs.forEach((l) => lines.push(`- ${l.nameTh} × ${l.qty}${l.hint ? ' — ' + l.hint : ''}`));
    } else lines.push('(ไม่มีหางปลา)');
    lines.push('');
    lines.push(`รวมอุปกรณ์ ${bom.deviceCount} · สาย ${bom.wireCount} · หางปลา ${bom.lugCount}`);
    return lines.join('\n');
  }
  function renderBomPanel() {
    const bom = computeBom();
    const empty = $('bom-empty');
    const devBox = $('bom-devices');
    const wireBox = $('bom-wires');
    const lugBox = $('bom-lugs');
    const totalEl = $('wire-len-total');
    if (totalEl) totalEl.textContent = bom.wireCount ? `${bom.totalMetres} ม.` : '—';
    const slackInput = $('wire-slack');
    if (slackInput && document.activeElement !== slackInput) slackInput.value = String(bom.slack);

    const hasAny = bom.deviceCount || bom.wireCount;
    if (empty) empty.hidden = hasAny;
    if (!devBox || !wireBox || !lugBox) return bom;

    if (!bom.deviceCount) {
      devBox.hidden = true;
      devBox.innerHTML = '';
    } else {
      devBox.hidden = false;
      let html = '<h3>อุปกรณ์ตามหมวด</h3><table><tbody>';
      const cats = [...CAT_ORDER, ...Object.keys(bom.devicesByCat).filter((c) => !CAT_ORDER.includes(c))];
      cats.forEach((cat) => {
        const rows = bom.devicesByCat[cat];
        if (!rows || !rows.length) return;
        html += `<tr><td class="cat" colspan="2">${C.categories[cat] || cat}</td></tr>`;
        rows.forEach((r) => {
          html += `<tr><td>${r.label}</td><td class="num">× ${r.qty}</td></tr>`;
        });
      });
      html += `</tbody></table><p class="bom-total" style="margin:8px 0 0">รวม ${bom.deviceCount} ชิ้น</p>`;
      devBox.innerHTML = html;
    }

    if (!bom.wireCount) {
      wireBox.hidden = true;
      wireBox.innerHTML = '';
    } else {
      wireBox.hidden = false;
      let html =
        '<h3>สายไฟ (ความยาวจริง + เผื่อปลาย)</h3>' +
        `<p class="muted" style="margin:0 0 8px">เส้นจริง ${Math.round(bom.drawnMm)} มม. + เผื่อ ${Math.round(bom.slackMm)} มม. (${bom.slack} มม.×2 ต่อเส้น) · แสดงเป็นเมตรปัดขึ้น 0.1</p>` +
        '<table><thead><tr><th>ขนาด</th><th>สี</th><th class="num">เส้น</th><th class="num">ยาว</th></tr></thead><tbody>';
      bom.wires.forEach((w) => {
        html += `<tr><td>${w.mm2} มม²</td><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${w.color};margin-right:4px;vertical-align:middle"></span>${w.colorLabel}</td><td class="num">${w.count}</td><td class="num">${w.metres} ม.</td></tr>`;
      });
      html += `</tbody></table><p class="bom-total" style="margin:8px 0 0">รวมสาย ${bom.totalMetres} ม. (${bom.wireCount} เส้น)</p>`;
      wireBox.innerHTML = html;
    }

    if (!bom.lugs.length) {
      lugBox.hidden = true;
      lugBox.innerHTML = '';
    } else {
      lugBox.hidden = false;
      let html =
        '<h3>หางปลา / ขั้วสาย</h3>' +
        '<table><thead><tr><th>ชนิด</th><th class="num">จำนวน</th></tr></thead><tbody>';
      bom.lugs.forEach((l) => {
        html += `<tr><td>${l.nameTh}<div class="muted" style="font-size:11px">${l.hint || ''}</div></td><td class="num">× ${l.qty}</td></tr>`;
      });
      html += `</tbody></table><p class="bom-total" style="margin:8px 0 0">รวมหางปลา ${bom.lugCount} ชิ้น</p>`;
      lugBox.innerHTML = html;
    }

    // Keep legacy hidden field for any old consumers
    const legacy = $('bom');
    if (legacy) {
      legacy.textContent = [
        ...Object.values(bom.devicesByCat).flat().map((r) => `${r.label} × ${r.qty}`),
        ...bom.wires.map((w) => `สาย ${w.mm2}มม² ${w.colorLabel} ${w.metres}ม`),
        ...bom.lugs.map((l) => `${l.nameTh} × ${l.qty}`)
      ].join(' · ');
    }
    return bom;
  }
  function exportBom() {
    const bom = computeBom();
    const name = (designSession.name || 'bom').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);
    download(`${name}-bom.txt`, bomToText(bom), 'text/plain;charset=utf-8');
    $('status').textContent = 'ส่งออก BOM แล้ว';
  }
  function printBom() {
    renderBomPanel();
    const bom = computeBom();
    const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>BOM — ${escapeHtml(designSession.name)}</title>
<style>body{font:14px/1.5 "IBM Plex Sans Thai",sans-serif;padding:24px;color:#1c2e36}
h1{font-size:18px}h2{font-size:14px;margin:18px 0 8px;color:#0a6b5c}
table{width:100%;border-collapse:collapse;margin:6px 0 12px}
th,td{border-bottom:1px solid #d4dee6;padding:6px 4px;text-align:left;font-size:13px}
.num{text-align:right} .muted{color:#6a7c86;font-size:12px}
@media print{button{display:none}}</style></head><body>
<h1>สรุปรายการวัสดุ (BOM)</h1>
<p class="muted">${escapeHtml(designSession.name)} · โหมด ${mode} · เผื่อปลายสาย ${bom.slack} มม./ด้าน</p>
${$('bom-devices').hidden ? '' : '<h2>อุปกรณ์</h2>' + $('bom-devices').innerHTML}
${$('bom-wires').hidden ? '' : '<h2>สายไฟ</h2>' + $('bom-wires').innerHTML}
${$('bom-lugs').hidden ? '' : '<h2>หางปลา</h2>' + $('bom-lugs').innerHTML}
<p class="muted">สร้างจาก Panel Studio · ความยาวสายจากเรขาคณิตที่วาดจริง ปัดขึ้น 0.1 ม.</p>
<script>window.onload=()=>window.print()</script>
</body></html>`;
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) {
      $('status').textContent = 'เปิดหน้าต่างพิมพ์ไม่ได้ — อนุญาตป๊อปอัปแล้วลองใหม่';
      return;
    }
    w.document.write(html);
    w.document.close();
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
        const sizeBits = [
          `${g.w} × ${g.h} × ${t.depthMm || g.sec.stripW || 20} มม.`,
          g.style === 'brass' ? `หน้าตัด ${g.sectionW}×${g.sectionH} มม.` : g.style === 'copper' ? `ทองแดง · ฉนวน Ø${g.sec.standoffR * 2}×35` : 'I-din นิเกิล',
          `ระยะรู ~${g.pitch} มม.`,
          'ติดแผ่น (นอก DIN)'
        ];
        if (g.ratingAmps) sizeBits.push(`${g.ratingAmps}A`);
        $('dev-size').textContent = sizeBits.join(' · ');
        if (barBox) {
          barBox.hidden = false;
          $('bar-holes').value = String(g.holes);
          $('bar-holes').min = String(g.minHoles);
          $('bar-holes').max = String(g.maxHoles);
          $('bar-length').value = String(g.lengthMm);
          $('bar-role').value = g.role;
          $('bar-orient-h').classList.toggle('active', g.orient === 'h');
          $('bar-orient-v').classList.toggle('active', g.orient === 'v');
          const secField = $('bar-section-field');
          const baseField = $('bar-base-field');
          const roleField = $('bar-role-field');
          if (secField) {
            secField.hidden = g.style !== 'brass';
            if (g.style === 'brass') $('bar-section').value = g.secKey;
          }
          if (baseField) {
            baseField.hidden = g.style !== 'brass';
            if (g.style === 'brass') $('bar-base').value = g.baseStyle;
          }
          if (roleField) {
            roleField.hidden = g.style === 'copper';
            // copper keeps red standoffs; role still stored for label/BOM
          }
          const note = $('bar-note');
          if (note) {
            if (g.style === 'idin') note.textContent = 'สกรูปลายใหญ่ 2 ตัว + สกรูเล็กกลาง · ลากปลายบาร์เพิ่ม/ลดจุด · กริด 2.5 มม.';
            else if (g.style === 'copper') note.textContent = 'บาร์ทองแดงบนฉนวนแดง · สลักหกเหลี่ยม · 110A · กริด 2.5 มม.';
            else note.textContent = 'เลือกหน้าตัด 6×9 / 8×12 และฐานมาตรฐาน/ปีก · ลากปลายบาร์ · กริด 2.5 มม.';
          }
          const presets = $('bar-presets');
          presets.replaceChildren();
          g.presets.forEach((n) => {
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

  function appendTerminalBarVisual(g, d, t, geom, isSel, hit) {
    const L = geom.lengthMm;
    const sec = geom.sec;
    const pts = ports(d);
    if (geom.style === 'copper') {
      const copper = '#b87333';
      const copperDark = '#8a4f1f';
      const red = '#e03131';
      const r = sec.standoffR;
      if (geom.orient === 'h') {
        const cy = d.y + geom.h / 2;
        const barY = cy - sec.sectionH / 2;
        const barX = d.x + r * 0.7;
        const barW = Math.max(10, L - r * 1.4);
        g.append(
          hit,
          el('circle', { cx: d.x + r, cy, r, fill: red, stroke: '#c92a2a', 'stroke-width': 0.8 }),
          el('circle', { cx: d.x + L - r, cy, r, fill: red, stroke: '#c92a2a', 'stroke-width': 0.8 }),
          el('circle', { cx: d.x + r, cy, r: r * 0.35, fill: '#ffc9c9' }),
          el('circle', { cx: d.x + L - r, cy, r: r * 0.35, fill: '#ffc9c9' }),
          el('rect', { x: barX, y: barY, width: barW, height: sec.sectionH, rx: 1, fill: copper, stroke: isSel ? '#0a6b5c' : copperDark, 'stroke-width': isSel ? 1.8 : 0.9 })
        );
        pts.forEach((pt) => {
          const s = 3.2;
          g.append(
            el('rect', { x: pt.x - s, y: barY - 1.5, width: s * 2, height: sec.sectionH + 3, rx: 0.5, fill: '#868e96', stroke: '#495057', 'stroke-width': 0.4 }),
            el('polygon', { points: `${pt.x},${barY - 2.5} ${pt.x + 2.2},${barY + 1} ${pt.x - 2.2},${barY + 1}`, fill: '#adb5bd' })
          );
        });
        g.append(el('text', { x: d.x + L / 2, y: d.y + geom.h - 2, 'text-anchor': 'middle', 'font-size': 7, fill: '#1a3038' }, (d.label || '110A').slice(0, 16)));
      } else {
        const cx = d.x + geom.w / 2;
        const barX = cx - sec.sectionH / 2;
        const barY = d.y + r * 0.7;
        const barLen = Math.max(10, L - r * 1.4);
        g.append(
          hit,
          el('circle', { cx, cy: d.y + r, r, fill: red, stroke: '#c92a2a', 'stroke-width': 0.8 }),
          el('circle', { cx, cy: d.y + L - r, r, fill: red, stroke: '#c92a2a', 'stroke-width': 0.8 }),
          el('rect', { x: barX, y: barY, width: sec.sectionH, height: barLen, rx: 1, fill: copper, stroke: isSel ? '#0a6b5c' : copperDark, 'stroke-width': isSel ? 1.8 : 0.9 })
        );
        pts.forEach((pt) => {
          const s = 3.2;
          g.append(el('rect', { x: barX - 1.5, y: pt.y - s, width: sec.sectionH + 3, height: s * 2, rx: 0.5, fill: '#868e96' }));
        });
        g.append(
          el('text', {
            x: d.x + geom.w - 1,
            y: d.y + L / 2,
            'text-anchor': 'middle',
            'font-size': 7,
            fill: '#1a3038',
            transform: `rotate(-90 ${d.x + geom.w - 1} ${d.y + L / 2})`
          }, (d.label || '110A').slice(0, 16))
        );
      }
      return;
    }

    if (geom.style === 'idin') {
      const nickel = '#ced4da';
      const nickelDark = '#868e96';
      const screw = '#e67700';
      const tab = sec.tabLen;
      if (geom.orient === 'h') {
        const barY = d.y + 5;
        const barH = Math.max(3, sec.sectionH + 2);
        const deck = L - 2 * tab;
        g.append(
          hit,
          el('path', {
            d: `M ${d.x} ${d.y + geom.h - 2} L ${d.x + tab} ${d.y + geom.h - 2} L ${d.x + tab} ${barY} L ${d.x + tab + deck} ${barY} L ${d.x + tab + deck} ${d.y + geom.h - 2} L ${d.x + L} ${d.y + geom.h - 2} L ${d.x + L} ${d.y + geom.h} L ${d.x + L - tab + 2} ${d.y + geom.h} L ${d.x + L - tab + 2} ${barY + barH} L ${d.x + tab - 2} ${barY + barH} L ${d.x + tab - 2} ${d.y + geom.h} L ${d.x} ${d.y + geom.h} Z`,
            fill: nickel,
            stroke: isSel ? '#0a6b5c' : nickelDark,
            'stroke-width': isSel ? 1.6 : 0.8
          }),
          el('ellipse', { cx: d.x + tab / 2, cy: d.y + geom.h - 3, rx: 3.5, ry: 1.6, fill: 'none', stroke: '#495057', 'stroke-width': 0.7 }),
          el('ellipse', { cx: d.x + L - tab / 2, cy: d.y + geom.h - 3, rx: 3.5, ry: 1.6, fill: 'none', stroke: '#495057', 'stroke-width': 0.7 })
        );
        pts.forEach((pt) => {
          const rad = pt.large ? 3.4 : 2.2;
          g.append(
            el('circle', { cx: pt.x, cy: barY + barH / 2, r: rad, fill: screw, stroke: '#9a5b00', 'stroke-width': 0.5 }),
            el('line', { x1: pt.x - rad * 0.55, x2: pt.x + rad * 0.55, y1: barY + barH / 2, y2: barY + barH / 2, stroke: '#343a40', 'stroke-width': 0.6 }),
            el('line', { x1: pt.x, x2: pt.x, y1: barY + barH / 2 - rad * 0.55, y2: barY + barH / 2 + rad * 0.55, stroke: '#343a40', 'stroke-width': 0.6 })
          );
        });
        g.append(el('text', { x: d.x + L / 2, y: d.y + 4, 'text-anchor': 'middle', 'font-size': 7, fill: '#1a3038' }, (d.label || '').slice(0, 14)));
      } else {
        const barX = d.x + 5;
        const barW = Math.max(3, sec.sectionH + 2);
        const deck = L - 2 * tab;
        g.append(
          hit,
          el('path', {
            d: `M ${d.x + geom.w - 2} ${d.y} L ${d.x + geom.w - 2} ${d.y + tab} L ${barX} ${d.y + tab} L ${barX} ${d.y + tab + deck} L ${d.x + geom.w - 2} ${d.y + tab + deck} L ${d.x + geom.w - 2} ${d.y + L} L ${d.x + geom.w} ${d.y + L} L ${d.x + geom.w} ${d.y + L - tab + 2} L ${barX + barW} ${d.y + L - tab + 2} L ${barX + barW} ${d.y + tab - 2} L ${d.x + geom.w} ${d.y + tab - 2} L ${d.x + geom.w} ${d.y} Z`,
            fill: nickel,
            stroke: isSel ? '#0a6b5c' : nickelDark,
            'stroke-width': isSel ? 1.6 : 0.8
          })
        );
        pts.forEach((pt) => {
          const rad = pt.large ? 3.4 : 2.2;
          g.append(el('circle', { cx: barX + barW / 2, cy: pt.y, r: rad, fill: screw, stroke: '#9a5b00', 'stroke-width': 0.5 }));
        });
        g.append(
          el('text', {
            x: d.x + geom.w - 1,
            y: d.y + L / 2,
            'text-anchor': 'middle',
            'font-size': 7,
            fill: '#1a3038',
            transform: `rotate(-90 ${d.x + geom.w - 1} ${d.y + L / 2})`
          }, (d.label || '').slice(0, 14))
        );
      }
      return;
    }

    // brass N/PE
    const footColor = geom.role === 'PE' ? '#2f9e44' : geom.role === 'N' ? '#1c7ed6' : '#868e96';
    const brass = '#c9a227';
    const brassDark = '#a8841a';
    const foot = sec.footW;
    const barH = sec.sectionH;
    const wing = geom.baseStyle === 'wing';
    if (geom.orient === 'h') {
      const barY = d.y + (geom.h - barH) / 2 - 1;
      const barX = d.x + foot - 4;
      const barW = Math.max(barH, L - 2 * foot + 8);
      const footY = d.y + geom.h - (wing ? 14 : 12);
      const footH = wing ? 14 : 12;
      const footSpread = wing ? Math.max(foot + 6, geom.h * 0.9) : foot;
      g.append(hit);
      if (wing) {
        g.append(
          el('rect', { x: d.x - 2, y: footY, width: footSpread, height: footH, rx: 2, fill: footColor }),
          el('rect', { x: d.x + L - footSpread + 2, y: footY, width: footSpread, height: footH, rx: 2, fill: footColor }),
          el('circle', { cx: d.x + 4, cy: footY + footH / 2, r: 2.2, fill: '#e9ecef', stroke: '#495057', 'stroke-width': 0.6 }),
          el('circle', { cx: d.x + L - 4, cy: footY + footH / 2, r: 2.2, fill: '#e9ecef', stroke: '#495057', 'stroke-width': 0.6 })
        );
      } else {
        g.append(
          el('rect', { x: d.x, y: footY, width: foot, height: footH, rx: 1.5, fill: footColor }),
          el('rect', { x: d.x + L - foot, y: footY, width: foot, height: footH, rx: 1.5, fill: footColor }),
          el('circle', { cx: d.x + foot / 2, cy: footY + footH / 2, r: 2.2, fill: '#e9ecef', stroke: '#495057', 'stroke-width': 0.6 }),
          el('circle', { cx: d.x + L - foot / 2, cy: footY + footH / 2, r: 2.2, fill: '#e9ecef', stroke: '#495057', 'stroke-width': 0.6 })
        );
      }
      g.append(el('rect', { x: barX, y: barY, width: barW, height: barH, rx: 1, fill: brass, stroke: isSel ? '#0a6b5c' : brassDark, 'stroke-width': isSel ? 1.8 : 0.8 }));
      pts.forEach((pt) => {
        g.append(
          el('circle', { cx: pt.x, cy: barY + barH / 2, r: 2.4, fill: '#ced4da', stroke: '#495057', 'stroke-width': 0.5 }),
          el('line', { x1: pt.x - 1.6, x2: pt.x + 1.6, y1: barY + 2, y2: barY + 2, stroke: '#343a40', 'stroke-width': 0.7 }),
          el('line', { x1: pt.x, x2: pt.x, y1: barY + 1.2, y2: barY + 3.2, stroke: '#343a40', 'stroke-width': 0.7 })
        );
      });
      g.append(el('text', { x: d.x + L / 2, y: d.y + geom.h - 1, 'text-anchor': 'middle', 'font-size': 7, fill: '#1a3038' }, (d.label || '').slice(0, 14)));
    } else {
      const barX = d.x + (geom.w - barH) / 2 - 1;
      const barY = d.y + foot - 4;
      const barLen = Math.max(barH, L - 2 * foot + 8);
      g.append(hit);
      if (wing) {
        g.append(
          el('rect', { x: d.x + geom.w - 14, y: d.y - 2, width: 14, height: foot + 6, rx: 2, fill: footColor }),
          el('rect', { x: d.x + geom.w - 14, y: d.y + L - foot - 4, width: 14, height: foot + 6, rx: 2, fill: footColor })
        );
      } else {
        g.append(
          el('rect', { x: d.x + geom.w - 12, y: d.y, width: 12, height: foot, rx: 1.5, fill: footColor }),
          el('rect', { x: d.x + geom.w - 12, y: d.y + L - foot, width: 12, height: foot, rx: 1.5, fill: footColor })
        );
      }
      g.append(el('rect', { x: barX, y: barY, width: barH, height: barLen, rx: 1, fill: brass, stroke: isSel ? '#0a6b5c' : brassDark, 'stroke-width': isSel ? 1.8 : 0.8 }));
      pts.forEach((pt) => {
        g.append(el('circle', { cx: barX + barH / 2, cy: pt.y, r: 2.4, fill: '#ced4da', stroke: '#495057', 'stroke-width': 0.5 }));
      });
      g.append(
        el('text', {
          x: d.x + geom.w - 1,
          y: d.y + L / 2,
          'text-anchor': 'middle',
          'font-size': 7,
          fill: '#1a3038',
          transform: `rotate(-90 ${d.x + geom.w - 1} ${d.y + L / 2})`
        }, (d.label || '').slice(0, 14))
      );
    }
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
        appendTerminalBarVisual(g, d, t, geom, isSel, hit);
        g.querySelectorAll('rect:not(.device-hit):not(.bar-resize), circle, line, text, path, ellipse, polygon').forEach((n) => {
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
    renderBomPanel();
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
      const style = barStyleOf(t);
      d.holes = t.holesDefault || 8;
      d.orient = 'h';
      d.role = t.roleDefault || (style === 'brass' ? 'N' : 'PE');
      if (style === 'brass') {
        d.section = t.sectionDefault === '8x12' ? '8x12' : '6x9';
        d.baseStyle = t.baseDefault === 'wing' ? 'wing' : 'block';
        d.label = d.role === 'PE' ? 'บาร์ PE' : 'บาร์ N';
      } else if (style === 'idin') {
        d.label = 'บาร์กราวด์ I-din';
      } else {
        d.label = 'บาร์ทองแดง 110A';
      }
      d.lengthMm = barLenFromHoles(d.holes, t, d);
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
      const lim = barHoleLimits(t, d);
      const delta = drag.orient === 'h' ? pt.x - drag.startX : pt.y - drag.startY;
      const nextLen = Math.max(barLenFromHoles(lim.min, t, d), Math.min(barLenFromHoles(lim.max, t, d) + 40, drag.startLen + delta));
      const nextHoles = holesFromBarLen(nextLen, t, d);
      d.holes = nextHoles;
      d.lengthMm = barLenFromHoles(nextHoles, t, d);
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
      ? {
          type: t.id,
          holes: t.holesDefault || 8,
          orient: 'h',
          role: t.roleDefault || 'N',
          section: t.sectionDefault || '6x9',
          baseStyle: t.baseDefault || 'block',
          x: 0,
          y: 0
        }
      : { x: 0, y: 0 };
    if (isTerminalBar(t)) stub.lengthMm = barLenFromHoles(stub.holes, t, stub);
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
    const t = spec(d.type);
    checkpoint();
    const lim = barHoleLimits(t, d);
    const len = Math.max(
      barLenFromHoles(lim.min, t, d),
      Math.min(barLenFromHoles(lim.max, t, d) + 40, Math.round(Number($('bar-length').value) || barLenFromHoles(d.holes, t, d)))
    );
    d.lengthMm = len;
    const pos = clampDevice(d, t);
    d.x = pos.x;
    d.y = pos.y;
    syncBarRating(d);
    rerouteConnected(d.id);
    render();
    properties();
    persist();
  };
  $('bar-section').onchange = () => {
    const d = selectedBar();
    if (!d) return;
    const t = spec(d.type);
    if (barStyleOf(t) !== 'brass') return;
    checkpoint();
    const cx = d.x + deviceWidth(t, d) / 2;
    const cy = d.y + deviceHeight(t, d) / 2;
    d.section = $('bar-section').value === '8x12' ? '8x12' : '6x9';
    d.lengthMm = barLenFromHoles(barHoles(d, t), t, d);
    d.x = cx - deviceWidth(t, d) / 2;
    d.y = cy - deviceHeight(t, d) / 2;
    const pos = clampDevice(d, t);
    d.x = pos.x;
    d.y = pos.y;
    syncBarRating(d);
    rerouteConnected(d.id);
    render();
    properties();
    persist();
  };
  $('bar-base').onchange = () => {
    const d = selectedBar();
    if (!d) return;
    const t = spec(d.type);
    if (barStyleOf(t) !== 'brass') return;
    checkpoint();
    d.baseStyle = $('bar-base').value === 'wing' ? 'wing' : 'block';
    const pos = clampDevice(d, t);
    d.x = pos.x;
    d.y = pos.y;
    syncBarRating(d);
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
    const t = spec(d.type);
    checkpoint();
    d.role = barRole({ role: $('bar-role').value }, t);
    if (barStyleOf(t) === 'brass' && (!d.label || /^(บาร์ N|บาร์ PE|บาร์เทอร์มินัล|บาร์ทองเหลือง)/.test(d.label))) {
      d.label = d.role === 'PE' ? 'บาร์ PE' : d.role === 'N' ? 'บาร์ N' : 'บาร์ทองเหลือง';
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
    $('wire-size').value = String(w.width);
    render();
    persist();
  };
  $('wire-slack').onchange = () => {
    checkpoint();
    setWireSlackMm($('wire-slack').value);
    renderBomPanel();
    persist();
    $('status').textContent = `ตั้งเผื่อปลายสาย ${getWireSlackMm()} มม./ด้าน`;
  };
  $('bom-export').onclick = () => exportBom();
  $('bom-print').onclick = () => printBom();
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveCurrentDesign();
      return;
    }
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
      if ($('designs-modal')?.classList.contains('show')) {
        closeDesignsModal();
        return;
      }
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
  $('save').onclick = () => saveCurrentDesign();
  $('export-json').onclick = () => exportDesignJson();
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
  $('design-new').onclick = () => newDesign();
  $('designs-open').onclick = () => openDesignsModal();
  $('designs-close').onclick = () => closeDesignsModal();
  $('designs-modal').addEventListener('click', (e) => {
    if (e.target === $('designs-modal')) closeDesignsModal();
  });
  $('design-new-modal').onclick = () => newDesign();
  $('save-modal').onclick = () => {
    if (saveCurrentDesign()) renderDesignList();
  };
  $('export-json-modal').onclick = () => exportDesignJson();
  $('open-modal').onclick = () => $('file').click();
  // Mobile / sheet duplicates
  $('design-new-sheet').onclick = () => newDesign();
  $('save-sheet').onclick = () => saveCurrentDesign();
  $('designs-open-sheet').onclick = () => openDesignsModal();
  $('export-json-sheet').onclick = () => exportDesignJson();
  $('open-sheet').onclick = () => $('file').click();
  $('design-badge').onclick = () => openDesignsModal();
  $('file').onchange = async () => {
    try {
      const f = $('file').files[0];
      if (!f || f.size > 2e6) throw new Error();
      const raw = JSON.parse(await f.text());
      if (!importDesignFromObject(raw)) throw new Error();
      closeDesignsModal();
    } catch (_) {
      $('status').textContent = 'ไฟล์ไม่ถูกต้อง';
    }
    $('file').value = '';
  };
  updateDesignChrome();

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
