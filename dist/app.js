/* Panel Studio v3 — มาตราส่วนจริง + สายมุมเลี้ยว + เลือก/ลบได้ทุกชิ้น */
(() => {
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const C = window.PANEL_CATALOG;
  const MODULE = C.MODULE_MM;
  const STORAGE = 'panel-studio-v1';
  const VERSION = 3;

  const WIRE_COLORS = {
    AC: [
      ['#8B4513', 'L1 · น้ำตาล'],
      ['#1a1a1a', 'L2 · ดำ'],
      ['#6B7280', 'L3 · เทา'],
      ['#2563EB', 'N · น้ำเงิน'],
      ['#16A34A', 'PE · เขียว'],
      ['#CA8A04', 'PE · เหลืองเขียว']
    ],
    DC: [
      ['#DC2626', '+ · แดง'],
      ['#1a1a1a', '− · ดำ'],
      ['#16A34A', 'PE · เขียว'],
      ['#2563EB', 'สัญญาณ · น้ำเงิน']
    ]
  };

  const DEFAULT_CAB = (m) => {
    const preferred = m === 'AC' ? 'ind-600' : 'pv-400';
    const p = C.presets.find((x) => x.id === preferred) || C.presets.find((x) => x.mode === m);
    return cabinetFromPreset(p);
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
      preset: p.id,
      marginTop: p.marginTop ?? L.marginTop,
      marginBottom: p.marginBottom ?? L.marginBottom,
      marginSide: p.marginSide ?? L.marginSide,
      ductTop: p.ductTop ?? L.ductTop,
      ductBottom: p.ductBottom ?? L.ductBottom,
      ductSide: p.ductSide ?? L.ductSide
    };
  }

  let data = {
    version: VERSION,
    AC: { devices: [], wires: [], cabinet: DEFAULT_CAB('AC') },
    DC: { devices: [], wires: [], cabinet: DEFAULT_CAB('DC') }
  };
  let mode = 'AC';
  let tool = 'move';
  let selected = null; // device id
  let selectedWire = null; // wire id
  let start = null;
  let drag = null; // { kind:'device'|'bend', ... }
  let history = [];
  let catFilter = 'all';
  let viewScale = 1;
  let lastBendTap = 0;

  /* —— Catalog —— */
  function devicesFor(m) {
    return C.devices.filter((d) => d.modes.includes(m));
  }
  function spec(type) {
    return C.devices.find((d) => d.id === type);
  }
  function deviceWidth(t) {
    return t.widthMm || t.modules * MODULE;
  }
  function deviceHeight(t) {
    return t.heightMm || C.DEVICE_BODY_H;
  }

  /* —— Geometry —— */
  function state() {
    return data[mode];
  }
  function cabinet() {
    return state().cabinet;
  }
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
  function railLayout() {
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
      n,
      headroom,
      footroom
    };
  }
  function railYs() {
    return railLayout().ys;
  }
  /** ความยาวรางจริง (มม.) — 0 หรือไม่ตั้ง = ใช้ความกว้างแผ่นติดตั้ง */
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
    const rw = railUsableWidth();
    return Math.round(p.x + (p.w - rw) / 2);
  }
  function snapToRail(y, t) {
    if (t.freePlace) return y;
    const ys = railYs();
    const off = railOffset(t);
    const target = y + off;
    const best = ys.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    return Math.round(best - off);
  }
  function clampDevice(d, t) {
    const p = plate();
    const w = deviceWidth(t);
    const h = deviceHeight(t);
    let xMin = p.x + 4;
    let xMax = p.x + p.w - w - 4;
    // อุปกรณ์บนรางต้องอยู่ในช่วงความยาวราง DIN จริง
    if (!t.freePlace) {
      const rx = railDrawX();
      const rw = railUsableWidth();
      xMin = Math.max(xMin, rx);
      xMax = Math.min(xMax, rx + rw - w);
    }
    if (xMax < xMin) xMax = xMin;
    let x = Math.max(xMin, Math.min(xMax, d.x));
    let y = d.y;
    if (!t.freePlace) y = snapToRail(y, t);
    y = Math.max(p.y + 2, Math.min(p.y + p.h - h - 2, y));
    return { x: Math.round(x), y: Math.round(y) };
  }

  /* —— Persistence —— */
  function normalizeWire(w, devices) {
    if (!w || typeof w.id !== 'string') return null;
    if (!/^#[0-9a-f]{6}$/i.test(w.color)) return null;
    const okEnd = (e) =>
      e &&
      typeof e.id === 'string' &&
      Number.isInteger(e.i) &&
      e.i >= 0 &&
      e.i < 16 &&
      devices.some((x) => x.id === e.id);
    if (!okEnd(w.a) || !okEnd(w.b)) return null;
    const bends = Array.isArray(w.bends)
      ? w.bends
          .filter((b) => b && Number.isFinite(b.x) && Number.isFinite(b.y))
          .slice(0, 40)
          .map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) }))
      : [];
    const width = Number(w.width);
    const route = w.route === 'hvh' ? 'hvh' : 'vhv';
    return {
      id: w.id,
      a: { id: w.a.id, i: w.a.i },
      b: { id: w.b.id, i: w.b.i },
      color: w.color,
      width: Number.isFinite(width) ? Math.max(1, Math.min(8, width)) : 2.5,
      route,
      bends
    };
  }
  function validDevice(d, m) {
    return (
      d &&
      typeof d.id === 'string' &&
      spec(d.type) &&
      spec(d.type).modes.includes(m) &&
      typeof d.label === 'string' &&
      typeof d.rating === 'string' &&
      Number.isFinite(d.x) &&
      Number.isFinite(d.y)
    );
  }
  function normalizeCabinet(cab, m) {
    const base = DEFAULT_CAB(m);
    if (!cab || typeof cab !== 'object') return base;
    const num = (v, def, min, max) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
    };
    return {
      width: num(cab.width, base.width, 150, 2000),
      height: num(cab.height, base.height, 200, 2500),
      depth: num(cab.depth, base.depth, 60, 800),
      rails: num(cab.rails, base.rails, 1, 12),
      pitch: num(cab.pitch, base.pitch, 80, 300),
      railLengthMm: num(cab.railLengthMm, base.railLengthMm || 0, 0, 2000),
      preset: typeof cab.preset === 'string' ? cab.preset : 'custom',
      marginTop: num(cab.marginTop, base.marginTop, 10, 120),
      marginBottom: num(cab.marginBottom, base.marginBottom, 10, 120),
      marginSide: num(cab.marginSide, base.marginSide, 10, 100),
      ductTop: num(cab.ductTop, base.ductTop, 0, 120),
      ductBottom: num(cab.ductBottom, base.ductBottom, 0, 120),
      ductSide: num(cab.ductSide, base.ductSide, 0, 80)
    };
  }
  function migrateLegacyCoords(devices, cab) {
    const p = {
      x: cab.marginSide + cab.ductSide,
      y: cab.marginTop + cab.ductTop,
      w: cab.width - 2 * (cab.marginSide + cab.ductSide),
      h: cab.height - cab.marginTop - cab.marginBottom - cab.ductTop - cab.ductBottom
    };
    const n = cab.rails;
    const pitch = cab.pitch;
    const usable = p.h - 20;
    const total = (n - 1) * pitch;
    const startY = p.y + Math.max(30, (usable - total) / 2);
    const ys = Array.from({ length: n }, (_, i) => Math.round(startY + i * pitch));
    const oldRails = [80, 240, 400];
    return devices.map((d) => {
      const t = spec(d.type);
      if (!t) return d;
      const looksLegacy = d.x <= 800 && d.y <= 560 && (cab.width < 750 || d.x > cab.width);
      if (!looksLegacy && d.x <= cab.width && d.y <= cab.height) {
        const pos = clampDevice({ x: d.x, y: d.y }, t);
        return { ...d, x: pos.x, y: pos.y };
      }
      const sx = p.x + 5 + (d.x / 800) * Math.max(40, p.w - deviceWidth(t) - 10);
      const nearestOld = oldRails.reduce((a, b) => (Math.abs(b - d.y) < Math.abs(a - d.y) ? b : a));
      const idx = Math.min(ys.length - 1, Math.max(0, oldRails.indexOf(nearestOld)));
      const y = t.freePlace ? p.y + (d.y / 560) * p.h : ys[idx] - deviceHeight(t) * 0.42;
      const pos = clampDevice({ x: sx, y }, t);
      return { ...d, x: pos.x, y: pos.y };
    });
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
        devices.push({
          id: d.id,
          type: d.type,
          label: String(d.label).slice(0, 40),
          rating: String(d.rating).slice(0, 40),
          x: d.x,
          y: d.y
        });
      }
      const wires = [];
      for (const w of block.wires) {
        const nw = normalizeWire(w, devices);
        if (!nw) return null;
        wires.push(nw);
      }
      out[m] = { devices: migrateLegacyCoords(devices, cab), wires, cabinet: cab };
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
    if (history.length > 60) history.shift();
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(data));
    } catch (_) {
      $('status').textContent = 'พื้นที่บันทึกเต็ม กรุณาบันทึกเป็น JSON';
    }
  }

  /* —— SVG helpers —— */
  function el(tag, attrs = {}, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function point(e) {
    const p = $('board').createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const ctm = $('board').getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return p.matrixTransform(ctm.inverse());
  }

  /* —— Ports —— */
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
      if (isBar) {
        label = t.name.includes('PE') || t.id.includes('PE') ? 'PE' : t.name.includes('N') || t.id.includes('N') ? 'N' : 'B';
      } else if (mode === 'AC') {
        if (n === 1) label = 'L';
        else if (n === 2) label = col === 0 ? 'L' : 'N';
        else if (n === 3) label = ['R', 'S', 'T'][col];
        else label = ['R', 'S', 'T', 'N'][col] || String(col + 1);
      } else {
        label = n === 1 ? '+' : col % 2 === 0 ? '+' : '−';
      }
      return { x, y, label, top };
    });
  }
  function endpoint(e) {
    const d = state().devices.find((x) => x.id === e.id);
    return d && ports(d)[e.i];
  }

  /* —— Wire geometry —— */
  function orthCorner(a, b, prefer) {
    if (a.x === b.x || a.y === b.y) return [];
    if (prefer === 'hvh') return [{ x: b.x, y: a.y }];
    return [{ x: a.x, y: b.y }];
  }
  function defaultBends(a, b, route) {
    if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) return [];
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
  /** Full orthogonal polyline including endpoints */
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
        const corners = orthCorner(prev, cur, route);
        corners.forEach((c) => {
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
    for (const d of state().devices) {
      const t = spec(d.type);
      if (!t) continue;
      const w = deviceWidth(t);
      const h = deviceHeight(t);
      if (d.x < p.x - 1 || d.y < p.y - 1 || d.x + w > p.x + p.w + 2 || d.y + h > p.y + p.h + 2) {
        msgs.push(`«${d.label}» อยู่นอกแผ่นติดตั้ง`);
      }
      if (t.depthMm && t.depthMm > c.depth) {
        msgs.push(`«${d.label}» ลึก ${t.depthMm} มม. แต่ตู้ลึก ${c.depth} มม.`);
      }
      if (t.freePlace) continue;
      if (w > usable + 0.5) {
        msgs.push(`«${d.label}» กว้าง ${w} มม. แต่รางยาวเพียง ${Math.round(usable)} มม.`);
      } else if (d.x < rx - 1 || d.x + w > rx + usable + 1) {
        msgs.push(`«${d.label}» ยื่นนอกราง DIN (ยาว ${Math.round(usable)} มม.)`);
      }
      const mid = d.y + h * 0.42;
      let best = 0;
      ys.forEach((ry, i) => {
        if (Math.abs(ry - mid) < Math.abs(ys[best] - mid)) best = i;
      });
      byRail[best] += t.modules;
    }
    byRail.forEach((mods, i) => {
      if (mods > maxMods) {
        msgs.push(
          `ราง DIN ${String(i + 1).padStart(2, '0')} ใช้ ${mods} โมดูล จากที่มีได้ ${maxMods} (ราง ${Math.round(usable)} มม.)`
        );
      }
    });
    const layout = railLayout();
    if (!layout.fitted) {
      msgs.push(`ระยะรางถูกย่อเหลือ ~${Math.round(layout.pitch)} มม. — ตู้สูง ${c.height} มม. แน่นสำหรับ ${c.rails} ราง`);
    }
    return { msgs, byRail, maxMods };
  }

  /* —— Selection UI —— */
  function clearSelection() {
    selected = null;
    selectedWire = null;
    start = null;
  }
  /** Enable/disable always-present actions + floating chip (overlay only — no layout shift) */
  function updateSelActions() {
    const d = selected && state().devices.find((x) => x.id === selected);
    const w = selectedWire && state().wires.find((x) => x.id === selectedWire);
    const has = !!(d || w);
    $('sel-delete').disabled = !has;
    $('sel-route').disabled = !w;
    $('sel-add-bend').disabled = !w;
    $('sel-clear-bends').disabled = !w;
    const chip = $('float-sel');
    chip.classList.toggle('show', has);
    if (d) {
      const t = spec(d.type);
      $('float-label').textContent = d.label + (t ? ` · ${deviceWidth(t)}×${deviceHeight(t)} มม.` : '');
    } else if (w) {
      $('float-label').textContent = `สาย · มุม ${w.bends.length} · ลากจุดเขียวจัดเส้น`;
    } else {
      $('float-label').textContent = '—';
    }
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
        ? `${deviceWidth(t)} × ${deviceHeight(t)} × ${t.depthMm || '—'} มม. (ก×ส×ล) · ${t.modules} โมดูล${
            t.brand ? ` · ${t.brand}${t.model ? ' ' + t.model : ''}` : ''
          }`
        : '—';
    }
    if (w) {
      fillColorSelect($('wprop-color'), w.color);
      $('wprop-size').value = String(w.width);
      $('wprop-route').value = w.route || 'vhv';
      $('wprop-info').textContent = `จุดเลี้ยว ${w.bends.length} · ยึดกับขั้วอุปกรณ์เมื่อย้าย`;
    }
    updateSelActions();
  }

  /* —— Render —— */
  function applyViewBox() {
    const c = cabinet();
    const board = $('board');
    board.setAttribute('viewBox', `0 0 ${c.width} ${c.height}`);
    const scroll = $('stage-scroll');
    const availW = Math.max(280, scroll.clientWidth - 8);
    const availH = Math.max(240, scroll.clientHeight - 8);
    viewScale = Math.min(availW / c.width, availH / c.height, 1.8);
    const pxW = Math.max(Math.round(c.width * viewScale), Math.min(availW, c.width));
    const pxH = Math.round((pxW / c.width) * c.height);
    board.style.width = pxW + 'px';
    board.style.height = pxH + 'px';
    $('scale-pill').textContent = `${c.width}×${c.height}×${c.depth} มม.`;
    $('rail-count').textContent = c.rails + ' แถว';
  }

  function render() {
    applyViewBox();
    const b = $('board');
    const c = cabinet();
    const p = plate();
    b.replaceChildren();

    const defs = el('defs');
    const pat = el('pattern', { id: 'grid', width: 20, height: 20, patternUnits: 'userSpaceOnUse' });
    pat.append(el('circle', { cx: 1, cy: 1, r: 1.2, fill: '#d5dee4' }));
    defs.append(pat);
    b.append(defs);

    b.append(
      el('rect', {
        x: 0,
        y: 0,
        width: c.width,
        height: c.height,
        fill: '#c5ced4',
        stroke: '#6d7e88',
        'stroke-width': 3,
        rx: 4,
        class: 'bg-hit'
      })
    );
    b.append(
      el('rect', {
        x: 6,
        y: 6,
        width: c.width - 12,
        height: c.height - 12,
        fill: 'url(#grid)',
        stroke: '#8a9aa3',
        'stroke-width': 1,
        rx: 2,
        class: 'bg-hit'
      })
    );

    if (c.ductTop > 0) {
      b.append(
        el('rect', { class: 'duct', x: c.marginSide, y: c.marginTop, width: c.width - 2 * c.marginSide, height: c.ductTop, rx: 2 }),
        el('text', { x: c.width / 2, y: c.marginTop + c.ductTop / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#5f717b' }, 'รางสายด้านบน')
      );
    }
    if (c.ductBottom > 0) {
      const dy = c.height - c.marginBottom - c.ductBottom;
      b.append(
        el('rect', { class: 'duct', x: c.marginSide, y: dy, width: c.width - 2 * c.marginSide, height: c.ductBottom, rx: 2 }),
        el('text', { x: c.width / 2, y: dy + c.ductBottom / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#5f717b' }, 'รางสายด้านล่าง')
      );
    }

    b.append(el('rect', { class: 'plate', x: p.x, y: p.y, width: p.w, height: p.h, rx: 2 }));
    b.append(el('text', { x: p.x + 6, y: p.y + 14, 'font-size': 10, fill: '#7a8b94' }, `แผ่นติดตั้ง ${Math.round(p.w)}×${Math.round(p.h)} มม.`));

    railYs().forEach((y, i) => {
      const rw = railUsableWidth();
      const rx = railDrawX();
      const mods = railModules();
      const lenLabel = cabinet().railLengthMm > 0 ? `${Math.round(rw)} มม.` : `เต็มแผ่น ${Math.round(rw)} มม.`;
      b.append(
        el(
          'text',
          { x: rx, y: y - 10, fill: '#7d8f98', 'font-size': 10 },
          `DIN TS35 ${String(i + 1).padStart(2, '0')} · ${lenLabel} · ${mods} โมดูล`
        ),
        el('rect', { class: 'rail', x: rx, y: y, width: rw, height: C.layoutDefaults.railThickness, rx: 1 }),
        el('line', { x1: rx, x2: rx + rw, y1: y + 3, y2: y + 3, stroke: '#f4f8fa', 'stroke-width': 1.5 })
      );
    });

    b.append(
      el('text', { x: c.width / 2, y: c.height - 8, 'text-anchor': 'middle', 'font-size': 10, fill: '#5c6e77' }, `กว้าง ${c.width} มม.`),
      el(
        'text',
        {
          x: 12,
          y: c.height / 2,
          'text-anchor': 'middle',
          'font-size': 10,
          fill: '#5c6e77',
          transform: `rotate(-90 12 ${c.height / 2})`
        },
        `สูง ${c.height} มม.`
      )
    );

    // Wire visuals under devices
    state().wires.forEach((w) => {
      const pts = wirePolyline(w);
      if (pts.length < 2) return;
      const d = pathD(pts);
      const active = selectedWire === w.id;
      const sw = w.width || 2.5;
      const g = el('g', { class: 'wire-visual', 'pointer-events': 'none' });
      if (active) {
        g.append(
          el('path', {
            d,
            fill: 'none',
            stroke: '#0a6b5c',
            'stroke-width': sw + 4,
            opacity: 0.35,
            'stroke-linejoin': 'round',
            class: 'wire-path'
          })
        );
      }
      g.append(
        el('path', {
          d,
          fill: 'none',
          stroke: w.color,
          'stroke-width': active ? sw + 1 : sw,
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
          class: 'wire-path'
        })
      );
      b.append(g);
    });

    // Devices. Invisible padded hit-rect for reliable selection.
    state().devices.forEach((d) => {
      const t = spec(d.type);
      if (!t) return;
      const w = deviceWidth(t);
      const h = deviceHeight(t);
      const g = el('g', { class: 'device' + (t.freePlace ? ' free' : ''), 'data-id': d.id });
      const isSel = selected === d.id;
      const stroke = isSel ? '#0a6b5c' : '#8a9ba4';
      const sw = isSel ? 2.5 : 1.2;

      // Generous hit target (min ~24mm visual feel via padding in SVG units)
      const pad = Math.max(2, Math.min(6, 24 - Math.min(w, h) / 2));
      const hit = el('rect', {
        x: d.x - pad,
        y: d.y - pad,
        width: w + pad * 2,
        height: h + pad * 2,
        fill: 'transparent',
        class: 'device-hit'
      });

      g.append(
        hit,
        el('rect', { x: d.x, y: d.y, width: w, height: h, rx: 3, fill: '#fff', stroke, 'stroke-width': sw }),
        el('rect', {
          x: d.x + 4,
          y: d.y + h * 0.35,
          width: Math.max(2, w - 8),
          height: Math.max(10, h * 0.22),
          rx: 2,
          fill: t.isBar ? '#b89a4e' : '#243842'
        }),
        el(
          'text',
          {
            x: d.x + w / 2,
            y: d.y + Math.min(14, h * 0.28),
            'text-anchor': 'middle',
            'font-size': Math.max(7, Math.min(11, w / 5)),
            fill: '#1a3038'
          },
          d.label.slice(0, 14)
        ),
        el(
          'text',
          {
            x: d.x + w / 2,
            y: d.y + h - 6,
            'text-anchor': 'middle',
            'font-size': Math.max(6, Math.min(9, w / 6)),
            fill: '#6d7f88'
          },
          d.rating.slice(0, 16)
        )
      );

      const selectDevice = (e) => {
        e.stopPropagation();
        selectedWire = null;
        selected = d.id;
        bringDeviceFront(d.id);
        start = null;
        if (tool === 'move') {
          const pt = point(e);
          if (!drag) checkpoint();
          drag = { kind: 'device', id: d.id, dx: pt.x - d.x, dy: pt.y - d.y };
          try {
            b.setPointerCapture(e.pointerId);
          } catch (_) {}
        }
        properties();
        render();
      };

      hit.addEventListener('pointerdown', selectDevice);
      // Also allow pressing body rects
      g.querySelectorAll('rect:not(.device-hit)').forEach((r) => {
        r.style.pointerEvents = 'none';
      });
      g.querySelectorAll('text').forEach((tx) => {
        tx.style.pointerEvents = 'none';
      });

      ports(d).forEach((pt) => {
        const fs = Math.max(6, Math.min(9, w / (t.poles + 2)));
        g.append(
          el(
            'text',
            {
              x: pt.x,
              y: pt.y + (pt.top ? 11 : -5),
              'text-anchor': 'middle',
              'font-size': fs,
              fill: '#6a7c86',
              style: 'pointer-events:none'
            },
            pt.label
          )
        );
      });
      b.append(g);
    });

    // Wire hit targets + bend handles ABOVE devices so exposed segments stay clickable
    state().wires.forEach((w) => {
      const pts = wirePolyline(w);
      if (pts.length < 2) return;
      const d = pathD(pts);
      const active = selectedWire === w.id;
      const sw = w.width || 2.5;
      const g = el('g', { class: 'wire-interact' });
      const hit = el('path', {
        d,
        fill: 'none',
        stroke: 'transparent',
        'stroke-width': Math.max(16, sw + 14),
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        class: 'wire-hit'
      });
      const selectWire = (e) => {
        e.stopPropagation();
        selected = null;
        selectedWire = w.id;
        start = null;
        drag = null;
        properties();
        render();
      };
      hit.addEventListener('pointerdown', (e) => {
        if (tool === 'wire' && start) return;
        selectWire(e);
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
          g.append(h);
        });
      }
      b.append(g);
    });

    // Terminals on top of wire hits so เดินสาย still works at endpoints
    state().devices.forEach((d) => {
      const t = spec(d.type);
      if (!t) return;
      ports(d).forEach((pt, i) => {
        const r = Math.max(6, Math.min(8, Math.max(deviceWidth(t), deviceHeight(t)) / 12));
        const circle = el('circle', {
          cx: pt.x,
          cy: pt.y,
          r,
          fill: start?.id === d.id && start.i === i ? '#e8a020' : '#dfe6ea',
          stroke: '#5a6d77',
          'stroke-width': 1.5,
          class: 'terminal'
        });
        circle.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          if (tool === 'wire') {
            connect({ id: d.id, i });
            return;
          }
          selectedWire = null;
          selected = d.id;
          bringDeviceFront(d.id);
          const p = point(e);
          checkpoint();
          drag = { kind: 'device', id: d.id, dx: p.x - d.x, dy: p.y - d.y };
          try {
            b.setPointerCapture(e.pointerId);
          } catch (_) {}
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
      warn.innerHTML = '<strong>เตือนการจัดวาง:</strong> ' + msgs.slice(0, 4).join(' · ');
    } else {
      warn.classList.remove('show');
      warn.textContent = '';
    }
    updateSelActions();
  }

  function addBendAtPointer(w, pt) {
    checkpoint();
    const a = endpoint(w.a);
    const b = endpoint(w.b);
    if (!a || !b) return;
    if (!w.bends.length) w.bends = defaultBends(a, b, w.route || 'vhv');

    // Project onto closest segment of the rendered orthogonal polyline
    const poly = wirePolyline(w);
    let bestSeg = 0;
    let bestT = 0.5;
    let bestDist = Infinity;
    let qx = pt.x;
    let qy = pt.y;
    for (let i = 0; i < poly.length - 1; i++) {
      const p0 = poly[i];
      const p1 = poly[i + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((pt.x - p0.x) * dx + (pt.y - p0.y) * dy) / len2;
      t = Math.max(0.15, Math.min(0.85, t));
      const x = p0.x + t * dx;
      const y = p0.y + t * dy;
      const dist = (pt.x - x) ** 2 + (pt.y - y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        bestSeg = i;
        bestT = t;
        qx = x;
        qy = y;
      }
    }
    const nx = Math.round(qx);
    const ny = Math.round(qy);
    // Map polyline vertex index → bends index (skip endpoint)
    // Store as absolute bend; avoid duplicates
    if (w.bends.some((bp) => Math.hypot(bp.x - nx, bp.y - ny) < 4)) {
      $('status').textContent = 'มีมุมเลี้ยวใกล้จุดนี้อยู่แล้ว';
      return;
    }
    // Insert ordered by distance along path
    const along = bestSeg + bestT;
    const scored = w.bends.map((bp, idx) => {
      let seg = 0;
      let t = 0;
      let best = Infinity;
      for (let i = 0; i < poly.length - 1; i++) {
        const p0 = poly[i];
        const p1 = poly[i + 1];
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const len2 = dx * dx + dy * dy || 1;
        let tt = ((bp.x - p0.x) * dx + (bp.y - p0.y) * dy) / len2;
        tt = Math.max(0, Math.min(1, tt));
        const x = p0.x + tt * dx;
        const y = p0.y + tt * dy;
        const dist = (bp.x - x) ** 2 + (bp.y - y) ** 2;
        if (dist < best) {
          best = dist;
          seg = i;
          t = tt;
        }
      }
      return { bp, idx, along: seg + t };
    });
    scored.push({ bp: { x: nx, y: ny }, idx: -1, along });
    scored.sort((u, v) => u.along - v.along);
    w.bends = scored.map((s) => s.bp);
    selectedWire = w.id;
    selected = null;
    render();
    properties();
    persist();
    $('status').textContent = 'เพิ่มมุมเลี้ยวแล้ว · ลากจุดเขียวเพื่อจัดเส้น';
  }

  function connect(p) {
    if (!start) {
      start = p;
      selected = null;
      selectedWire = null;
      $('status').textContent = 'เลือกขั้วปลายทาง · หรือ Escape เพื่อยกเลิก';
      render();
      properties();
      return;
    }
    if (start.id === p.id && start.i === p.i) {
      start = null;
      render();
      return;
    }
    if (start.id === p.id) {
      $('status').textContent = 'เลือกขั้วของอุปกรณ์อีกตัว';
      return;
    }
    checkpoint();
    const route = $('wire-route').value === 'hvh' ? 'hvh' : 'vhv';
    const width = parseFloat($('wire-size').value) || 2.5;
    state().wires.push({
      id: crypto.randomUUID(),
      a: start,
      b: p,
      color: $('color').value,
      width,
      route,
      bends: []
    });
    start = null;
    selectedWire = state().wires[state().wires.length - 1].id;
    selected = null;
    render();
    properties();
    persist();
    $('status').textContent = 'เชื่อมสายแล้ว · แตะสายเพื่อแก้มุมเลี้ยว หรือเลือกขั้วเพื่อเดินสายใหม่';
  }

  function findOpenSlot(t) {
    const p = plate();
    const w = deviceWidth(t);
    const h = deviceHeight(t);
    const ys = t.freePlace ? [p.y + 20, p.y + p.h / 2, p.y + p.h - h - 20] : railYs().map((ry) => ry - railOffset(t));
    const gap = 4;
    const x0 = t.freePlace ? p.x + 8 : railDrawX();
    const xLim = t.freePlace ? p.x + p.w - 4 : railDrawX() + railUsableWidth();
    for (const y0 of ys) {
      let x = x0;
      while (x + w <= xLim) {
        const pos = clampDevice({ x, y: y0 }, t);
        const overlap = state().devices.some((d) => {
          const dt = spec(d.type);
          if (!dt) return false;
          const dw = deviceWidth(dt);
          const dh = deviceHeight(dt);
          return !(pos.x + w + gap <= d.x || d.x + dw + gap <= pos.x || pos.y + h + gap <= d.y || d.y + dh + gap <= pos.y);
        });
        if (!overlap) return pos;
        x += MODULE;
      }
    }
    return clampDevice({ x: x0, y: ys[0] }, t);
  }

  function add(type, x, y) {
    const t = spec(type);
    if (!t || !t.modes.includes(mode)) return;
    checkpoint();
    let pos;
    if (x != null && y != null) pos = clampDevice({ x, y }, t);
    else pos = findOpenSlot(t);
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
    $('status').textContent = `เพิ่ม ${t.nameTh} แล้ว · กว้าง ${deviceWidth(t)} มม.`;
    if (window.matchMedia('(max-width:900px)').matches) setMobileTab('board');
  }

  /* —— Catalog UI —— */
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
        b.draggable = true;
        const brand = t.brand ? `${t.brand}${t.model ? ' · ' + t.model : ''} · ` : '';
        const size = `${deviceWidth(t)}×${deviceHeight(t)}×${t.depthMm || '—'} มม.`;
        b.innerHTML = `<span class="icon">${t.icon || '▥'}</span><span><strong>${t.nameTh || t.name}</strong><small>${brand}${t.hint || ''} · ${size}</small></span>`;
        b.onclick = () => add(t.id);
        b.ondragstart = (e) => {
          e.dataTransfer.setData('text/plain', t.id);
          e.dataTransfer.effectAllowed = 'copy';
        };
        box.append(b);
      });
  }

  function fillColorSelect(sel, current) {
    sel.replaceChildren();
    WIRE_COLORS[mode].forEach(([v, n]) => sel.add(new Option(n, v)));
    if (current && ![...sel.options].some((o) => o.value.toLowerCase() === current.toLowerCase())) {
      sel.add(new Option(current, current));
    }
    if (current) sel.value = [...sel.options].find((o) => o.value.toLowerCase() === current.toLowerCase())?.value || current;
  }

  function fillRailLengthSelect() {
    const sel = $('rail-length');
    const cur = cabinet().railLengthMm || 0;
    sel.replaceChildren();
    sel.add(new Option('เต็มแผ่นติดตั้ง (ไม่จำกัดความยาวราง)', '0'));
    (C.dinRail?.lengthsMm || []).forEach((mm) => {
      const cm = mm / 10;
      const mods = Math.floor(mm / MODULE);
      sel.add(new Option(`TS35 · ${cm} ซม. (${mm} มม.) · ~${mods} โมดูล`, String(mm)));
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
    const mods = railModules();
    const c = cabinet();
    const src = c.railLengthMm > 0 ? `ราง ${c.railLengthMm} มม.` : 'เต็มแผ่น';
    $('rail-mod-info').textContent = `${mods} โมดูล · ${Math.round(mm)} มม. (${src})`;
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
      const custom = Math.max(50, Math.min(2000, +$('rail-length-custom').value || c.railLengthMm || 100));
      c.railLengthMm = custom;
      $('rail-length-custom').value = custom;
    } else {
      c.railLengthMm = Math.max(0, Math.min(2000, +v || 0));
      if (c.railLengthMm > 0) $('rail-length-custom').value = c.railLengthMm;
    }
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
      c.preset = 'custom';
      $('preset').value = 'custom';
    }
    state().devices = state().devices.map((d) => {
      const t = spec(d.type);
      if (!t) return d;
      const pos = clampDevice(d, t);
      return { ...d, x: pos.x, y: pos.y };
    });
    render();
    persist();
    updateRailModInfo();
    const railTxt = c.railLengthMm > 0 ? ` · ราง ${c.railLengthMm} มม. (${railModules()} โมดูล)` : '';
    $('status').textContent = `ตั้งตู้ ${c.width}×${c.height}×${c.depth} มม. · ${c.rails} ราง${railTxt}`;
  }

  function fillPresets() {
    const sel = $('preset');
    sel.replaceChildren();
    C.presets
      .filter((p) => !p.mode || p.mode === mode || p.id === 'custom')
      .forEach((p) => {
        let label;
        if (p.id === 'custom') label = p.name;
        else if (p.brand) label = `${p.brand} ${p.model || p.name} (${p.w}×${p.d}×${p.h} · ก×ล×ส)`;
        else label = `${p.name} (${p.w}×${p.h}×${p.d})`;
        sel.add(new Option(label, p.id));
      });
  }

  function setMode(m) {
    mode = m;
    clearSelection();
    catFilter = 'all';
    ['AC', 'DC'].forEach((x) => $(x.toLowerCase()).classList.toggle('active', x === m));
    $('title').textContent = m === 'AC' ? 'ตู้ Consumer / Control' : 'ตู้ Solar Combiner';
    $('subtitle').textContent = m === 'AC' ? 'เบรกเกอร์ · คอนแทคเตอร์ · PLC · มิเตอร์' : 'DC MCB · ฟิวส์ · SPD · Isolator';
    fillPresets();
    syncCabinetForm();
    renderCatalog();
    fillColorSelect($('color'));
    fillColorSelect($('wprop-color'));
    $('legend').textContent = WIRE_COLORS[m].map((x) => x[1]).join('  /  ');
    render();
    properties();
  }

  /* —— Pointer —— */
  $('board').addEventListener('pointermove', (e) => {
    if (!drag) return;
    const pt = point(e);
    if (drag.kind === 'device') {
      const d = state().devices.find((x) => x.id === drag.id);
      if (!d) return;
      const t = spec(d.type);
      d.x = pt.x - drag.dx;
      d.y = pt.y - drag.dy;
      const p = plate();
      d.x = Math.max(p.x + 4, Math.min(p.x + p.w - deviceWidth(t) - 4, d.x));
      d.y = Math.max(p.y + 2, Math.min(p.y + p.h - deviceHeight(t) - 2, d.y));
      render();
    } else if (drag.kind === 'bend') {
      const w = state().wires.find((x) => x.id === drag.wireId);
      if (!w || !w.bends[drag.index]) return;
      let x = Math.round(pt.x);
      let y = Math.round(pt.y);
      const a = endpoint(w.a);
      const b = endpoint(w.b);
      const chain = [a, ...w.bends, b];
      const i = drag.index + 1;
      const prev = chain[i - 1];
      const next = chain[i + 1];
      // Keep orthogonal to neighbors when possible
      if (prev && next) {
        const preferH = Math.abs(x - prev.x) + Math.abs(next.x - x) <= Math.abs(y - prev.y) + Math.abs(next.y - y);
        if (w.route === 'hvh' || preferH) {
          // lock to horizontal with prev or next if close
          if (Math.abs(y - prev.y) < Math.abs(y - next.y)) y = Math.round(prev.y);
          else y = Math.round(next.y);
        } else {
          if (Math.abs(x - prev.x) < Math.abs(x - next.x)) x = Math.round(prev.x);
          else x = Math.round(next.x);
        }
      } else if (prev) {
        if (Math.abs(x - prev.x) > Math.abs(y - prev.y)) y = Math.round(prev.y);
        else x = Math.round(prev.x);
      }
      w.bends[drag.index] = { x, y };
      render();
    }
  });

  function endDrag() {
    if (!drag) return;
    if (drag.kind === 'device') {
      const d = state().devices.find((x) => x.id === drag.id);
      if (d) {
        const t = spec(d.type);
        const pos = clampDevice(d, t);
        d.x = pos.x;
        d.y = pos.y;
      }
    }
    drag = null;
    render();
    persist();
  }
  $('board').addEventListener('pointerup', endDrag);
  $('board').addEventListener('pointercancel', endDrag);
  $('board').addEventListener('pointerdown', (e) => {
    // click empty board → deselect
    if (e.target.classList?.contains('bg-hit') || e.target.classList?.contains('plate') || e.target.classList?.contains('duct') || e.target.classList?.contains('rail')) {
      clearSelection();
      properties();
      render();
    }
  });
  $('board').addEventListener('dragover', (e) => e.preventDefault());
  $('board').addEventListener('drop', (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/plain');
    const t = spec(type);
    if (!t) return;
    const pt = point(e);
    add(type, pt.x - deviceWidth(t) / 2, pt.y - deviceHeight(t) / 2);
  });

  ['move', 'wire'].forEach((tName) => {
    $(tName).onclick = () => {
      tool = tName;
      start = null;
      ['move', 'wire'].forEach((x) => $(x).classList.toggle('active', x === tName));
      $('status').textContent =
        tName === 'wire' ? 'แตะขั้วต้นทางและปลายทาง · เลือกสี/ขนาด/แนวจากแถบเครื่องมือ' : 'ลากอุปกรณ์เพื่อจัดวาง · แตะเพื่อเลือกแล้วลบได้';
      render();
    };
  });
  $('ac').onclick = () => setMode('AC');
  $('dc').onclick = () => setMode('DC');

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

  function removeSelected() {
    if (selectedWire) {
      checkpoint();
      state().wires = state().wires.filter((w) => w.id !== selectedWire);
      selectedWire = null;
      render();
      properties();
      persist();
      $('status').textContent = 'ลบสายแล้ว';
      return;
    }
    if (!selected) return;
    checkpoint();
    state().devices = state().devices.filter((d) => d.id !== selected);
    state().wires = state().wires.filter((w) => w.a.id !== selected && w.b.id !== selected);
    selected = start = null;
    render();
    properties();
    persist();
    $('status').textContent = 'ลบอุปกรณ์แล้ว';
  }
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
    if (pts.length < 2) return;
    const mid = pts[Math.floor(pts.length / 2)];
    addBendAtPointer(w, mid);
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

  $('wprop-color').onchange = () => {
    const w = state().wires.find((x) => x.id === selectedWire);
    if (!w) return;
    checkpoint();
    w.color = $('wprop-color').value;
    $('color').value = w.color;
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
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeSelected();
    }
    if (e.key === 'Escape') {
      start = null;
      clearSelection();
      properties();
      render();
    }
  });

  $('undo').onclick = () => {
    if (!history.length) return;
    const m = migrate(JSON.parse(history.pop()));
    if (m) data = m;
    clearSelection();
    syncCabinetForm();
    renderCatalog();
    render();
    properties();
    persist();
  };
  $('clear').onclick = () => {
    if (!confirm('ล้างอุปกรณ์และสายในโหมด ' + mode + '?')) return;
    checkpoint();
    const cab = cabinet();
    data[mode] = { devices: [], wires: [], cabinet: { ...cab } };
    clearSelection();
    render();
    properties();
    persist();
  };

  $('preset').onchange = () => applyCabinetFromForm(true);
  ['cab-w', 'cab-h', 'cab-d', 'cab-rails', 'cab-pitch'].forEach((id) => {
    $(id).onchange = () => applyCabinetFromForm(false);
  });
  $('rail-length').onchange = () => {
    if ($('rail-length').value === 'custom') {
      if (!$('rail-length-custom').value) $('rail-length-custom').value = '100';
      $('rail-length-custom').focus();
    }
    applyCabinetFromForm(false);
  };
  $('rail-length-custom').onchange = () => {
    $('rail-length').value = 'custom';
    applyCabinetFromForm(false);
  };
  $('zoom-fit').onclick = () => {
    render();
    $('stage-scroll').scrollTo({ top: 0, left: 0, behavior: 'smooth' });
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
    const s = $('board').cloneNode(true);
    s.setAttribute('xmlns', NS);
    s.setAttribute('width', String(c.width));
    s.setAttribute('height', String(c.height));
    s.querySelectorAll('.rail').forEach((r) => {
      r.setAttribute('fill', '#c9d4db');
      r.setAttribute('stroke', '#aebbc3');
    });
    s.querySelectorAll('.duct').forEach((r) => {
      r.setAttribute('fill', '#b9c6ce');
      r.setAttribute('stroke', '#97a7b1');
    });
    s.querySelectorAll('.plate').forEach((r) => {
      r.setAttribute('fill', '#eef2f4');
      r.setAttribute('stroke', '#8fa0aa');
    });
    s.querySelectorAll('.wire-hit, .bend-handle, .device-hit').forEach((n) => n.remove());
    download('panel-' + mode + '.svg', new XMLSerializer().serializeToString(s), 'image/svg+xml');
  };
  $('open').onclick = () => $('file').click();
  $('file').onchange = async () => {
    try {
      const f = $('file').files[0];
      if (!f) return;
      if (f.size > 2_000_000) throw new Error('big');
      const parsed = JSON.parse(await f.text());
      const m = migrate(parsed);
      if (!m) throw new Error('invalid');
      checkpoint();
      data = m;
      clearSelection();
      fillPresets();
      syncCabinetForm();
      renderCatalog();
      render();
      properties();
      persist();
      $('status').textContent = 'เปิดแบบเรียบร้อย';
    } catch (_) {
      $('status').textContent = 'ไฟล์ไม่ถูกต้อง กรุณาเลือก JSON ที่บันทึกจาก Panel Studio';
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

  window.addEventListener('resize', () => render());
  setMode('AC');
})();
