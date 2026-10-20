/* Panel Studio v2 — ออกแบบตู้ไฟมาตราส่วนจริง (มม.) */
(() => {
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const C = window.PANEL_CATALOG;
  const MODULE = C.MODULE_MM;
  const STORAGE = 'panel-studio-v1';
  const VERSION = 2;

  const DEFAULT_CAB = (mode) => {
    const preferred = mode === 'AC' ? 'ind-600' : 'pv-400';
    const p = C.presets.find((x) => x.id === preferred) || C.presets.find((x) => x.mode === mode);
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
  let selected = null;
  let start = null;
  let drag = null;
  let history = [];
  let catFilter = 'all';
  let viewScale = 1;

  /* —— Catalog helpers —— */
  function devicesFor(m) {
    return C.devices.filter((d) => d.modes.includes(m));
  }
  function spec(type) {
    return C.devices.find((d) => d.id === type);
  }
  function deviceWidth(t) {
    if (t.widthMm) return t.widthMm;
    return t.modules * MODULE;
  }
  function deviceHeight(t) {
    return t.heightMm || C.DEVICE_BODY_H;
  }

  /* —— Geometry / cabinet —— */
  function cabinet() {
    return state().cabinet;
  }
  function plate() {
    const c = cabinet();
    const x = c.marginSide + c.ductSide;
    const y = c.marginTop + c.ductTop;
    const w = c.width - 2 * (c.marginSide + c.ductSide);
    const h = c.height - c.marginTop - c.marginBottom - c.ductTop - c.ductBottom;
    return { x, y, w, h };
  }
  function railOffset(t) {
    return deviceHeight(t) * (C.layoutDefaults.railOffsetRatio || 0.42);
  }
  /** จัดรางให้พอดีแผ่นติดตั้ง — ย่อระยะรางอัตโนมัติเมื่อตู้เตี้ย */
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
    const ys = Array.from({ length: n }, (_, i) => Math.round(startY + i * pitch));
    return { ys, pitch, fitted, n, headroom, footroom };
  }
  function railYs() {
    return railLayout().ys;
  }
  function railUsableWidth() {
    return plate().w - 10;
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
    let x = Math.max(p.x + 4, Math.min(p.x + p.w - w - 4, d.x));
    let y = d.y;
    if (!t.freePlace) y = snapToRail(y, t);
    // บังคับให้อยู่ในแผ่นติดตั้งหลัง snap
    y = Math.max(p.y + 2, Math.min(p.y + p.h - h - 2, y));
    x = Math.max(p.x + 4, Math.min(p.x + p.w - w - 4, x));
    return { x: Math.round(x), y: Math.round(y) };
  }

  /* —— Persistence / migration —— */
  function validDevice(d, m) {
    if (!d || typeof d.id !== 'string') return false;
    if (!spec(d.type) || !spec(d.type).modes.includes(m)) return false;
    if (typeof d.label !== 'string' || typeof d.rating !== 'string') return false;
    if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) return false;
    return true;
  }
  function validWire(w, devices) {
    if (!w || typeof w.id !== 'string') return false;
    if (!/^#[0-9a-f]{6}$/i.test(w.color)) return false;
    return [w.a, w.b].every(
      (e) =>
        e &&
        typeof e.id === 'string' &&
        Number.isInteger(e.i) &&
        e.i >= 0 &&
        e.i < 16 &&
        devices.some((x) => x.id === e.id)
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
      preset: typeof cab.preset === 'string' ? cab.preset : 'custom',
      marginTop: num(cab.marginTop, base.marginTop, 10, 120),
      marginBottom: num(cab.marginBottom, base.marginBottom, 10, 120),
      marginSide: num(cab.marginSide, base.marginSide, 10, 100),
      ductTop: num(cab.ductTop, base.ductTop, 0, 120),
      ductBottom: num(cab.ductBottom, base.ductBottom, 0, 120),
      ductSide: num(cab.ductSide, base.ductSide, 0, 80)
    };
  }
  /** แปลงพิกัดรุ่นเก่า (บอร์ด 800×560) → มม. ตามตู้ใหม่ */
  function migrateLegacyCoords(devices, cab) {
    const p = (() => {
      const x = cab.marginSide + cab.ductSide;
      const y = cab.marginTop + cab.ductTop;
      const w = cab.width - 2 * (cab.marginSide + cab.ductSide);
      const h = cab.height - cab.marginTop - cab.marginBottom - cab.ductTop - cab.ductBottom;
      return { x, y, w, h };
    })();
    const ys = (() => {
      const n = cab.rails;
      const pitch = cab.pitch;
      const usable = p.h - 20;
      const total = (n - 1) * pitch;
      const startY = p.y + Math.max(30, (usable - total) / 2);
      return Array.from({ length: n }, (_, i) => Math.round(startY + i * pitch));
    })();
    const oldRails = [80, 240, 400];
    return devices.map((d) => {
      const t = spec(d.type);
      if (!t) return d;
      // ถ้าพิกัดดูเหมือนระบบเก่า (อยู่ในกรอบ 800×560 และกว้างกว่าตู้ใหม่มาก)
      const looksLegacy = d.x <= 800 && d.y <= 560 && (cab.width < 750 || d.x > cab.width);
      if (!looksLegacy && d.x <= cab.width && d.y <= cab.height) {
        const pos = clampDevice({ x: d.x, y: d.y }, t);
        return { ...d, x: pos.x, y: pos.y };
      }
      const sx = p.x + 5 + (d.x / 800) * Math.max(40, p.w - deviceWidth(t) - 10);
      const nearestOld = oldRails.reduce((a, b) => (Math.abs(b - d.y) < Math.abs(a - d.y) ? b : a));
      const idx = Math.min(ys.length - 1, Math.max(0, oldRails.indexOf(nearestOld)));
      const y = t.freePlace ? p.y + (d.y / 560) * p.h : ys[idx] - deviceHeight(t) * 0.55;
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
        if (!validWire(w, devices)) return null;
        wires.push({ id: w.id, a: { id: w.a.id, i: w.a.i }, b: { id: w.b.id, i: w.b.i }, color: w.color });
      }
      const migrated = migrateLegacyCoords(devices, cab);
      out[m] = { devices: migrated, wires, cabinet: cab };
    }
    return out;
  }
  function valid(raw) {
    return !!migrate(raw);
  }

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE));
    const m = migrate(saved);
    if (m) data = m;
  } catch (_) {}

  function state() {
    return data[mode];
  }
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

  /* —— Ports / wiring —— */
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
      if (isBar) label = t.name.includes('PE') || t.id.includes('PE') ? 'PE' : t.name.includes('N') || t.id.includes('N') ? 'N' : 'B';
      else if (mode === 'AC') {
        if (n === 1) label = top ? 'L' : 'L';
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

  /* —— Fit warnings —— */
  function computeWarnings() {
    const msgs = [];
    const c = cabinet();
    const p = plate();
    const usable = railUsableWidth();
    const maxMods = Math.floor(usable / MODULE);
    const ys = railYs();
    const byRail = ys.map(() => 0);
    let freeArea = 0;

    for (const d of state().devices) {
      const t = spec(d.type);
      if (!t) continue;
      const w = deviceWidth(t);
      const h = deviceHeight(t);
      if (d.x < p.x || d.y < p.y || d.x + w > p.x + p.w + 1 || d.y + h > p.y + p.h + 1) {
        msgs.push(`«${d.label}» อยู่นอกแผ่นติดตั้ง`);
      }
      if (t.depthMm && t.depthMm > c.depth) {
        msgs.push(`«${d.label}» ลึก ${t.depthMm} มม. แต่ตู้ลึก ${c.depth} มม.`);
      }
      if (t.freePlace) {
        freeArea += w * h;
        continue;
      }
      // nearest rail
      const mid = d.y + h * 0.55;
      let best = 0;
      ys.forEach((ry, i) => {
        if (Math.abs(ry - mid) < Math.abs(ys[best] - mid)) best = i;
      });
      byRail[best] += t.modules;
    }

    byRail.forEach((mods, i) => {
      if (mods > maxMods) {
        msgs.push(`ราง DIN ${String(i + 1).padStart(2, '0')} ใช้ ${mods} โมดูล จากที่มีได้ ~${maxMods} (กว้างราง ${Math.round(usable)} มม.)`);
      }
    });

    const layout = railLayout();
    if (!layout.fitted) {
      const needPitch = Math.max(95, c.pitch);
      const needH =
        c.marginTop +
        c.ductTop +
        c.marginBottom +
        c.ductBottom +
        layout.headroom +
        layout.footroom +
        (c.rails - 1) * needPitch;
      msgs.push(`ระยะรางถูกย่อเหลือ ~${Math.round(layout.pitch)} มม. — ตู้สูง ${c.height} มม. แน่นสำหรับ ${c.rails} ราง (แนะนำสูง ≥ ${Math.round(needH)} มม.)`);
    }

    if (!msgs.length && state().devices.length) {
      const used = byRail.reduce((a, b) => a + b, 0);
      if (used > maxMods * c.rails * 0.9) {
        msgs.push('พื้นที่รางใกล้เต็ม — พิจารณาตู้ที่กว้างขึ้นหรือเพิ่มราง');
      }
    }
    return { msgs, byRail, maxMods };
  }

  /* —— Render —— */
  function applyViewBox() {
    const c = cabinet();
    const board = $('board');
    board.setAttribute('viewBox', `0 0 ${c.width} ${c.height}`);
    // Display size: scale so cabinet fits stage while remaining touch-friendly
    const scroll = $('stage-scroll');
    const availW = Math.max(280, scroll.clientWidth - 8);
    const availH = Math.max(240, scroll.clientHeight - 8);
    const sx = availW / c.width;
    const sy = availH / c.height;
    viewScale = Math.min(sx, sy, 1.8);
    // On very large cabinets allow scroll; min pixel size for readability
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

    // Outer enclosure
    b.append(
      el('rect', {
        x: 0,
        y: 0,
        width: c.width,
        height: c.height,
        fill: '#c5ced4',
        stroke: '#6d7e88',
        'stroke-width': 3,
        rx: 4
      })
    );
    // Door frame inset
    b.append(
      el('rect', {
        x: 6,
        y: 6,
        width: c.width - 12,
        height: c.height - 12,
        fill: 'url(#grid)',
        stroke: '#8a9aa3',
        'stroke-width': 1,
        rx: 2
      })
    );

    // Wiring ducts
    if (c.ductTop > 0) {
      b.append(
        el('rect', {
          class: 'duct',
          x: c.marginSide,
          y: c.marginTop,
          width: c.width - 2 * c.marginSide,
          height: c.ductTop,
          rx: 2
        }),
        el('text', { x: c.width / 2, y: c.marginTop + c.ductTop / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#5f717b' }, 'รางสายด้านบน')
      );
    }
    if (c.ductBottom > 0) {
      const dy = c.height - c.marginBottom - c.ductBottom;
      b.append(
        el('rect', {
          class: 'duct',
          x: c.marginSide,
          y: dy,
          width: c.width - 2 * c.marginSide,
          height: c.ductBottom,
          rx: 2
        }),
        el('text', { x: c.width / 2, y: dy + c.ductBottom / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#5f717b' }, 'รางสายด้านล่าง')
      );
    }

    // Mounting plate
    b.append(el('rect', { class: 'plate', x: p.x, y: p.y, width: p.w, height: p.h, rx: 2 }));
    b.append(
      el('text', { x: p.x + 6, y: p.y + 14, 'font-size': 10, fill: '#7a8b94' }, `แผ่นติดตั้ง ${Math.round(p.w)}×${Math.round(p.h)} มม.`)
    );

    // DIN rails
    const ys = railYs();
    ys.forEach((y, i) => {
      const rw = railUsableWidth();
      const rx = p.x + 5;
      b.append(
        el('text', { x: rx, y: y - 10, fill: '#7d8f98', 'font-size': 10 }, `DIN ${String(i + 1).padStart(2, '0')} · ${Math.floor(rw / MODULE)} โมดูล`),
        el('rect', { class: 'rail', x: rx, y: y, width: rw, height: C.layoutDefaults.railThickness, rx: 1 }),
        el('line', { x1: rx, x2: rx + rw, y1: y + 3, y2: y + 3, stroke: '#f4f8fa', 'stroke-width': 1.5 })
      );
    });

    // Dimension labels
    b.append(
      el('text', { x: c.width / 2, y: c.height - 8, 'text-anchor': 'middle', 'font-size': 10, fill: '#5c6e77' }, `กว้าง ${c.width} มม.`),
      el('text', {
        x: 12,
        y: c.height / 2,
        'text-anchor': 'middle',
        'font-size': 10,
        fill: '#5c6e77',
        transform: `rotate(-90 12 ${c.height / 2})`
      }, `สูง ${c.height} มม.`)
    );

    // Wires
    state().wires.forEach((w) => {
      const a = endpoint(w.a);
      const c2 = endpoint(w.b);
      if (!a || !c2) return;
      const offset = a.y === c2.y ? a.y - 18 : (a.y + c2.y) / 2;
      const path = el('path', {
        d: `M${a.x},${a.y} V${offset} H${c2.x} V${c2.y}`,
        fill: 'none',
        stroke: w.color,
        'stroke-width': 2.5,
        'stroke-linejoin': 'round',
        class: 'wire'
      });
      path.addEventListener('click', (e) => {
        e.stopPropagation();
        checkpoint();
        state().wires = state().wires.filter((x) => x.id !== w.id);
        render();
        persist();
      });
      b.append(path);
    });

    // Devices
    state().devices.forEach((d) => {
      const t = spec(d.type);
      if (!t) return;
      const w = deviceWidth(t);
      const h = deviceHeight(t);
      const g = el('g', { class: 'device' + (t.freePlace ? ' free' : '') });
      const stroke = selected === d.id ? '#0a6b5c' : '#8a9ba4';
      const sw = selected === d.id ? 2.5 : 1.2;
      g.append(
        el('rect', { x: d.x, y: d.y, width: w, height: h, rx: 3, fill: '#fff', stroke, 'stroke-width': sw }),
        el('rect', {
          x: d.x + 4,
          y: d.y + h * 0.35,
          width: w - 8,
          height: Math.max(12, h * 0.22),
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

      g.addEventListener('pointerdown', (e) => {
        if (tool !== 'move') return;
        e.stopPropagation();
        selected = d.id;
        const pt = point(e);
        checkpoint();
        drag = { id: d.id, dx: pt.x - d.x, dy: pt.y - d.y };
        try {
          b.setPointerCapture(e.pointerId);
        } catch (_) {}
        render();
        properties();
      });

      ports(d).forEach((pt, i) => {
        const fs = Math.max(6, Math.min(9, w / (t.poles + 2)));
        g.append(
          el(
            'text',
            {
              x: pt.x,
              y: pt.y + (pt.top ? 11 : -5),
              'text-anchor': 'middle',
              'font-size': fs,
              fill: '#6a7c86'
            },
            pt.label
          )
        );
        const circle = el('circle', {
          cx: pt.x,
          cy: pt.y,
          r: Math.max(4, Math.min(6, w / 10)),
          fill: start?.id === d.id && start.i === i ? '#e8a020' : '#dfe6ea',
          stroke: '#5a6d77',
          'stroke-width': 1.5,
          class: 'terminal'
        });
        circle.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          if (tool !== 'wire') {
            selected = d.id;
            render();
            properties();
            return;
          }
          connect({ id: d.id, i });
        });
        g.append(circle);
      });
      b.append(g);
    });

    // Stats
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
        const t = spec(k);
        return `${t ? t.name : k} × ${v}`;
      })
      .join(' · ');

    const warn = $('warnings');
    if (msgs.length) {
      warn.classList.add('show');
      warn.innerHTML = '<strong>เตือนการจัดวาง:</strong> ' + msgs.slice(0, 4).join(' · ');
    } else {
      warn.classList.remove('show');
      warn.textContent = '';
    }
  }

  function properties() {
    const d = state().devices.find((x) => x.id === selected);
    $('props').hidden = !d;
    $('empty').hidden = !!d;
    if (d) {
      const t = spec(d.type);
      $('label').value = d.label;
      $('rating').value = d.rating;
      $('dev-size').textContent = t
        ? `${deviceWidth(t)} × ${deviceHeight(t)} มม. · ${t.modules} โมดูล · ลึก ~${t.depthMm || '—'} มม.`
        : '—';
    }
  }

  function connect(p) {
    if (!start) {
      start = p;
      $('status').textContent = 'เลือกขั้วปลายทาง';
      render();
      return;
    }
    if (start.id === p.id) {
      $('status').textContent = 'เลือกขั้วของอุปกรณ์อีกตัว';
      return;
    }
    checkpoint();
    state().wires.push({ id: crypto.randomUUID(), a: start, b: p, color: $('color').value });
    start = null;
    render();
    persist();
    $('status').textContent = 'เชื่อมสายแล้ว · เลือกขั้วเพื่อเริ่มสายใหม่';
  }

  function add(type, x, y) {
    const t = spec(type);
    if (!t || !t.modes.includes(mode)) return;
    checkpoint();
    const p = plate();
    const sx = x != null ? x : p.x + 20 + (state().devices.length % 5) * (MODULE * 2 + 4);
    const sy = y != null ? y : railYs()[Math.floor(state().devices.length / 5) % railYs().length] - deviceHeight(t) * 0.55;
    const pos = clampDevice({ x: sx, y: sy }, t);
    const d = {
      id: crypto.randomUUID(),
      type,
      label: t.name,
      rating: 'ระบุพิกัด',
      x: pos.x,
      y: pos.y
    };
    state().devices.push(d);
    selected = d.id;
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
        b.draggable = true;
        b.innerHTML = `<span class="icon">${t.icon || '▥'}</span><span><strong>${t.name}</strong><small>${t.nameTh} · ${t.hint || ''} · ${deviceWidth(t)}มม.</small></span>`;
        b.onclick = () => add(t.id);
        b.ondragstart = (e) => {
          e.dataTransfer.setData('text/plain', t.id);
          e.dataTransfer.effectAllowed = 'copy';
        };
        box.append(b);
      });
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
  }

  function applyCabinetFromForm(fromPreset) {
    checkpoint();
    const c = cabinet();
    if (fromPreset) {
      const p = C.presets.find((x) => x.id === $('preset').value);
      if (p && p.id !== 'custom') {
        Object.assign(c, cabinetFromPreset(p));
        syncCabinetForm();
      } else {
        c.preset = 'custom';
      }
    } else {
      c.width = Math.max(150, Math.min(2000, +$('cab-w').value || c.width));
      c.height = Math.max(200, Math.min(2500, +$('cab-h').value || c.height));
      c.depth = Math.max(60, Math.min(800, +$('cab-d').value || c.depth));
      c.rails = Math.max(1, Math.min(12, +$('cab-rails').value || c.rails));
      c.pitch = Math.max(80, Math.min(300, +$('cab-pitch').value || c.pitch));
      c.preset = 'custom';
      $('preset').value = 'custom';
    }
    // Re-clamp existing devices into new plate
    state().devices = state().devices.map((d) => {
      const t = spec(d.type);
      if (!t) return d;
      const pos = clampDevice(d, t);
      return { ...d, x: pos.x, y: pos.y };
    });
    render();
    persist();
    $('status').textContent = `ตั้งตู้ ${c.width}×${c.height}×${c.depth} มม. · ${c.rails} ราง`;
  }

  function fillPresets() {
    const sel = $('preset');
    sel.replaceChildren();
    C.presets
      .filter((p) => !p.mode || p.mode === mode || p.id === 'custom')
      .forEach((p) => {
        const label = p.id === 'custom' ? p.name : `${p.name} (${p.w}×${p.h}×${p.d})`;
        sel.add(new Option(label, p.id));
      });
  }

  function setMode(m) {
    mode = m;
    selected = start = null;
    catFilter = 'all';
    ['AC', 'DC'].forEach((x) => $(x.toLowerCase()).classList.toggle('active', x === m));
    $('title').textContent = m === 'AC' ? 'ตู้ Consumer / Control' : 'ตู้ Solar Combiner';
    $('subtitle').textContent =
      m === 'AC' ? 'เบรกเกอร์ · คอนแทคเตอร์ · PLC · มิเตอร์' : 'DC MCB · ฟิวส์ · SPD · Isolator';
    fillPresets();
    syncCabinetForm();
    renderCatalog();
    const colors =
      m === 'AC'
        ? [
            ['#8b543c', 'L · น้ำตาล'],
            ['#2878c8', 'N · น้ำเงิน'],
            ['#47934a', 'PE · เขียว'],
            ['#c9a227', 'Y · เหลือง']
          ]
        : [
            ['#dd5353', '+ · แดง'],
            ['#303b47', '− · ดำ'],
            ['#47934a', 'PE · เขียว']
          ];
    $('color').replaceChildren();
    colors.forEach(([v, n]) => $('color').add(new Option(n, v)));
    $('legend').textContent = colors.map((x) => x[1]).join('  /  ');
    render();
    properties();
  }

  /* —— Pointer / tools —— */
  $('board').addEventListener('pointermove', (e) => {
    if (!drag) return;
    const d = state().devices.find((x) => x.id === drag.id);
    if (!d) return;
    const t = spec(d.type);
    const pt = point(e);
    const pos = clampDevice({ x: pt.x - drag.dx, y: pt.y - drag.dy }, t);
    d.x = pos.x;
    d.y = t.freePlace ? pos.y : pt.y - drag.dy; // live drag before snap
    // soft clamp during drag
    const p = plate();
    d.x = Math.max(p.x + 5, Math.min(p.x + p.w - deviceWidth(t) - 5, d.x));
    d.y = Math.max(p.y + 5, Math.min(p.y + p.h - deviceHeight(t) - 5, d.y));
    render();
  });
  function endDrag() {
    if (!drag) return;
    const d = state().devices.find((x) => x.id === drag.id);
    if (d) {
      const t = spec(d.type);
      const pos = clampDevice(d, t);
      d.x = pos.x;
      d.y = pos.y;
    }
    drag = null;
    render();
    persist();
  }
  $('board').addEventListener('pointerup', endDrag);
  $('board').addEventListener('pointercancel', endDrag);
  $('board').addEventListener('dragover', (e) => e.preventDefault());
  $('board').addEventListener('drop', (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/plain');
    const t = spec(type);
    if (!t) return;
    const pt = point(e);
    add(type, pt.x - deviceWidth(t) / 2, pt.y - deviceHeight(t) / 2);
  });

  ['move', 'wire'].forEach((t) => {
    $(t).onclick = () => {
      tool = t;
      start = null;
      ['move', 'wire'].forEach((x) => $(x).classList.toggle('active', x === t));
      $('status').textContent = t === 'wire' ? 'แตะขั้วต้นทางและปลายทางเพื่อวาดสาย' : 'ลากอุปกรณ์เพื่อจัดวาง';
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

  function remove() {
    if (!selected) return;
    checkpoint();
    state().devices = state().devices.filter((d) => d.id !== selected);
    state().wires = state().wires.filter((w) => w.a.id !== selected && w.b.id !== selected);
    selected = start = null;
    render();
    properties();
    persist();
  }
  $('remove').onclick = remove;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) remove();
    if (e.key === 'Escape') {
      start = null;
      render();
    }
  });

  $('undo').onclick = () => {
    if (!history.length) return;
    const m = migrate(JSON.parse(history.pop()));
    if (m) data = m;
    selected = start = null;
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
    selected = start = null;
    render();
    properties();
    persist();
  };

  $('preset').onchange = () => applyCabinetFromForm(true);
  ['cab-w', 'cab-h', 'cab-d', 'cab-rails', 'cab-pitch'].forEach((id) => {
    $(id).onchange = () => applyCabinetFromForm(false);
  });
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
      selected = start = null;
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

  /* —— Mobile tabs —— */
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
    render();
  });

  // Init
  setMode('AC');
})();
