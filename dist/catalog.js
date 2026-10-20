/**
 * Panel Studio — แคตตาล็อกอุปกรณ์ (ข้อมูลขยายได้)
 * modules = ความกว้างหน่วย DIN (1 module ≈ 18 mm)
 * heightMm / depthMm / widthMm = ขนาดจริง (มม.) เมื่อทราบจากสเปกสินค้า
 * poles = จำนวนขั้ว (สำหรับขั้วต่อสาย)
 * brand / model = แสดงใน UI ภาษาไทย
 */
window.PANEL_CATALOG = {
  MODULE_MM: 18,
  DEVICE_BODY_H: 90,

  presets: [
    {
      id: 'glink-gwc-02',
      name: 'GLINK GWC-02',
      nameTh: 'ตู้แร็คติดผนัง GLINK GWC-02',
      brand: 'GLINK',
      model: 'GWC-02',
      hint: 'เหล็ก 1 มม. · ประตูกระจก Tempered · ดำ/เทา',
      w: 500,
      h: 500,
      d: 150,
      rails: 2,
      pitch: 140,
      railLengthMm: 0,
      ductTop: 30,
      ductBottom: 30,
      marginTop: 30,
      marginBottom: 30,
      marginSide: 25,
      mode: 'AC'
    },
    { id: 'cu-250', name: 'Consumer เล็ก', w: 250, h: 350, d: 100, rails: 2, pitch: 110, ductTop: 25, ductBottom: 25, marginTop: 25, marginBottom: 25, marginSide: 20, mode: 'AC' },
    { id: 'cu-300', name: 'Consumer กลาง', w: 300, h: 400, d: 120, rails: 2, pitch: 125, ductTop: 30, ductBottom: 30, marginTop: 30, marginBottom: 30, marginSide: 22, mode: 'AC' },
    { id: 'cu-400', name: 'ตู้ฝังผนัง 400', w: 400, h: 500, d: 200, rails: 3, pitch: 130, ductTop: 35, ductBottom: 35, mode: 'AC' },
    { id: 'ind-600', name: 'ตู้ผนัง 600×800', w: 600, h: 800, d: 250, rails: 4, pitch: 150, mode: 'AC' },
    { id: 'ind-800', name: 'ตู้ผนัง 800×1000', w: 800, h: 1000, d: 300, rails: 5, pitch: 150, mode: 'AC' },
    { id: 'ind-1000', name: 'ตู้ตั้งพื้น 1000×1200', w: 1000, h: 1200, d: 300, rails: 6, pitch: 155, mode: 'AC' },
    { id: 'pv-300', name: 'Solar Combiner เล็ก', w: 300, h: 400, d: 150, rails: 2, pitch: 125, ductTop: 30, ductBottom: 30, marginTop: 30, marginBottom: 30, marginSide: 22, mode: 'DC' },
    { id: 'pv-400', name: 'Solar Combiner กลาง', w: 400, h: 500, d: 200, rails: 3, pitch: 130, mode: 'DC' },
    { id: 'pv-600', name: 'Solar Combiner ใหญ่', w: 600, h: 800, d: 250, rails: 4, pitch: 150, mode: 'DC' },
    { id: 'custom', name: 'กำหนดเอง', w: 600, h: 800, d: 250, rails: 4, pitch: 150, mode: null }
  ],

  /**
   * ราง DIN อลูมิเนียม TS35 (35 มม.) — ความยาวตัดขายจริง 5–20 ซม.
   * 12 ขนาดตามท้องตลาด: 5,6,7,8,9,10,11,12,13,14,15,20 ซม.
   */
  dinRail: {
    profile: 'TS35',
    nameTh: 'ราง DIN อลูมิเนียม 35 มม. (TS35)',
    brand: 'ทั่วไป',
    thicknessMm: 7.5,
    lengthsMm: [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 200]
  },

  /** ระยะขอบแผ่นติดตั้ง / รางสาย (มม.) */
  layoutDefaults: {
    marginTop: 35,
    marginBottom: 35,
    marginSide: 25,
    ductTop: 40,
    ductBottom: 40,
    ductSide: 0,
    railPitch: 150,
    railThickness: 8,
    railLengthMm: 0, // 0 = ใช้ความกว้างแผ่นติดตั้ง
    railOffsetRatio: 0.42
  },

  devices: [
    /* —— สินค้าจริงจากหน้างาน / มาร์เก็ตเพลส —— */
    {
      id: 'nano-ple42',
      name: 'PLE42',
      nameTh: 'Nano Plus RCBO PLE42 2P',
      brand: 'Nano Plus',
      model: 'PLE42',
      cat: 'protection',
      modes: ['AC'],
      modules: 2,
      poles: 2,
      widthMm: 35.5,
      heightMm: 77,
      depthMm: 74.5,
      icon: '◇',
      hint: '16–63A · 30mA · 10kA · IEC 61009 · มอก.909-2548',
      ratingDefault: '32A 30mA'
    },
    {
      id: 'dz47-1p',
      name: 'DZ47-63 1P',
      nameTh: 'MCB DZ47-63 1P',
      brand: 'RMCFOO',
      model: 'DZ47-63',
      cat: 'protection',
      modes: ['AC'],
      modules: 1,
      poles: 1,
      widthMm: 18,
      heightMm: 80,
      depthMm: 72,
      icon: '▦',
      hint: '1P · 3–63A · โค้ง C · AC 230/400V',
      ratingDefault: '16A C'
    },
    {
      id: 'dz47-2p',
      name: 'DZ47-63 2P',
      nameTh: 'MCB DZ47-63 2P',
      brand: 'RMCFOO',
      model: 'DZ47-63',
      cat: 'protection',
      modes: ['AC'],
      modules: 2,
      poles: 2,
      widthMm: 36,
      heightMm: 80,
      depthMm: 75,
      icon: '▦',
      hint: '2P · 3–63A · โค้ง C · AC 230/400V',
      ratingDefault: '32A C'
    },
    {
      id: 'dz47-3p',
      name: 'DZ47-63 3P',
      nameTh: 'MCB DZ47-63 3P',
      brand: 'RMCFOO',
      model: 'DZ47-63',
      cat: 'protection',
      modes: ['AC'],
      modules: 3,
      poles: 3,
      widthMm: 54,
      heightMm: 80,
      depthMm: 75,
      icon: '▦',
      hint: '3P · 3–63A · โค้ง C · AC 400V',
      ratingDefault: '32A C'
    },
    {
      id: 'dz47-4p',
      name: 'DZ47-63 4P',
      nameTh: 'MCB DZ47-63 4P',
      brand: 'RMCFOO',
      model: 'DZ47-63',
      cat: 'protection',
      modes: ['AC'],
      modules: 4,
      poles: 4,
      widthMm: 72,
      heightMm: 80,
      depthMm: 75,
      icon: '▦',
      hint: '4P · 3–63A · โค้ง C · AC 400V',
      ratingDefault: '40A C'
    },

    /* —— ป้องกัน / ตัดตอน AC (ทั่วไป) —— */
    { id: 'MCB', name: 'MCB 2P', nameTh: 'เบรกเกอร์ MCB 2P', cat: 'protection', modes: ['AC'], modules: 2, poles: 2, heightMm: 90, depthMm: 70, legacy: true, icon: '▦', hint: '2P · AC' },
    { id: 'mcb-1p', name: 'MCB 1P', nameTh: 'เบรกเกอร์ MCB 1P', cat: 'protection', modes: ['AC'], modules: 1, poles: 1, heightMm: 90, depthMm: 70, icon: '▦', hint: '1P · AC' },
    { id: 'mcb-3p', name: 'MCB 3P', nameTh: 'เบรกเกอร์ MCB 3P', cat: 'protection', modes: ['AC'], modules: 3, poles: 3, heightMm: 90, depthMm: 70, icon: '▦', hint: '3P · AC' },
    { id: 'mcb-4p', name: 'MCB 4P', nameTh: 'เบรกเกอร์ MCB 4P', cat: 'protection', modes: ['AC'], modules: 4, poles: 4, heightMm: 90, depthMm: 70, icon: '▦', hint: '4P · AC' },
    { id: 'mccb', name: 'MCCB', nameTh: 'เบรกเกอร์ MCCB', cat: 'protection', modes: ['AC'], modules: 6, poles: 3, heightMm: 130, depthMm: 110, icon: '▣', hint: '3P · เมน', widthMm: 105 },
    { id: 'main-breaker', name: 'Main', nameTh: 'เมนเบรกเกอร์', cat: 'protection', modes: ['AC'], modules: 4, poles: 2, heightMm: 100, depthMm: 80, icon: '▣', hint: 'เมนตู้' },
    { id: 'RCCB', name: 'RCCB', nameTh: 'เครื่องตัดไฟรั่ว RCCB', cat: 'protection', modes: ['AC'], modules: 2, poles: 2, heightMm: 90, depthMm: 70, legacy: true, icon: '◈', hint: '2P · AC' },
    { id: 'rccb-4p', name: 'RCCB 4P', nameTh: 'เครื่องตัดไฟรั่ว 4P', cat: 'protection', modes: ['AC'], modules: 4, poles: 4, heightMm: 90, depthMm: 70, icon: '◈', hint: '4P · AC' },
    { id: 'rcbo-1p', name: 'RCBO 1P+N', nameTh: 'RCBO 1P+N', cat: 'protection', modes: ['AC'], modules: 2, poles: 2, heightMm: 90, depthMm: 70, icon: '◇', hint: 'เบรกเกอร์+ไฟรั่ว' },
    { id: 'rcbo-2p', name: 'RCBO 2P', nameTh: 'RCBO 2P', cat: 'protection', modes: ['AC'], modules: 2, poles: 2, heightMm: 90, depthMm: 70, icon: '◇', hint: 'เบรกเกอร์+ไฟรั่ว' },
    { id: 'SPD', name: 'SPD', nameTh: 'ป้องกันไฟกระชาก', cat: 'protection', modes: ['AC'], modules: 2, poles: 2, heightMm: 90, depthMm: 70, legacy: true, icon: '⚡', hint: 'AC' },
    { id: 'spd-3p', name: 'SPD 3P+N', nameTh: 'ป้องกันไฟกระชาก 3P+N', cat: 'protection', modes: ['AC'], modules: 4, poles: 4, heightMm: 90, depthMm: 70, icon: '⚡', hint: '3P+N' },

    /* —— ควบคุม —— */
    { id: 'contactor', name: 'MC', nameTh: 'แมกเนติกคอนแทคเตอร์', cat: 'control', modes: ['AC'], modules: 3, poles: 3, heightMm: 90, depthMm: 90, icon: '⬡', hint: '3P', widthMm: 45 },
    { id: 'overload', name: 'OLR', nameTh: 'โอเวอร์โหลดรีเลย์', cat: 'control', modes: ['AC'], modules: 3, poles: 3, heightMm: 80, depthMm: 80, icon: '▽', hint: 'ต่อกับ MC' },
    { id: 'relay', name: 'Relay', nameTh: 'รีเลย์', cat: 'control', modes: ['AC', 'DC'], modules: 1, poles: 2, heightMm: 90, depthMm: 60, icon: '↻', hint: 'ควบคุม' },
    { id: 'timer', name: 'Timer', nameTh: 'ไทเมอร์', cat: 'control', modes: ['AC', 'DC'], modules: 1, poles: 2, heightMm: 90, depthMm: 60, icon: '⏱', hint: 'หน่วงเวลา' },
    { id: 'psu', name: 'PSU', nameTh: 'พาวเวอร์ซัพพลาย', cat: 'control', modes: ['AC', 'DC'], modules: 3, poles: 2, heightMm: 100, depthMm: 110, icon: '▭', hint: '24V DC' },

    /* —— หน้าตู้ / แสดงผล —— */
    { id: 'pilot-lamp', name: 'Lamp', nameTh: 'ไพล็อตแลมป์', cat: 'hmi', modes: ['AC', 'DC'], modules: 1, poles: 2, heightMm: 40, depthMm: 50, icon: '●', hint: 'Ø22', freePlace: true },
    { id: 'push-btn', name: 'PB', nameTh: 'ปุ่มกด', cat: 'hmi', modes: ['AC', 'DC'], modules: 1, poles: 2, heightMm: 40, depthMm: 50, icon: '○', hint: 'Ø22', freePlace: true },
    { id: 'selector', name: 'SS', nameTh: 'สวิตช์เลือก', cat: 'hmi', modes: ['AC', 'DC'], modules: 1, poles: 2, heightMm: 40, depthMm: 55, icon: '◉', hint: 'Ø22', freePlace: true },
    { id: 'meter-v', name: 'V-Meter', nameTh: 'โวลต์มิเตอร์', cat: 'hmi', modes: ['AC', 'DC'], modules: 4, poles: 2, heightMm: 70, depthMm: 60, icon: 'V', hint: 'แรงดัน', freePlace: true, widthMm: 72 },
    { id: 'meter-a', name: 'A-Meter', nameTh: 'แอมมิเตอร์', cat: 'hmi', modes: ['AC', 'DC'], modules: 4, poles: 2, heightMm: 70, depthMm: 60, icon: 'A', hint: 'กระแส', freePlace: true, widthMm: 72 },
    { id: 'meter-kwh', name: 'kWh', nameTh: 'มิเตอร์พลังงาน', cat: 'hmi', modes: ['AC'], modules: 4, poles: 2, heightMm: 90, depthMm: 65, icon: 'Σ', hint: 'kWh' },

    /* —— เทอร์มินัล / บัสบาร์ —— */
    { id: 'terminal', name: 'TB', nameTh: 'เทอร์มินัลบล็อก', cat: 'connect', modes: ['AC', 'DC'], modules: 1, poles: 1, heightMm: 50, depthMm: 45, icon: '≡', hint: '1 ช่อง' },
    { id: 'terminal-4', name: 'TB×4', nameTh: 'เทอร์มินัล 4 ช่อง', cat: 'connect', modes: ['AC', 'DC'], modules: 4, poles: 4, heightMm: 50, depthMm: 45, icon: '≡', hint: '4 ช่อง' },
    { id: 'N BAR', name: 'N BAR', nameTh: 'บาร์นิวทรัล', cat: 'connect', modes: ['AC'], modules: 6, poles: 4, heightMm: 40, depthMm: 20, legacy: true, icon: '═', hint: 'N', isBar: true, widthMm: 110 },
    { id: 'PE BAR', name: 'PE BAR', nameTh: 'บาร์สายดิน', cat: 'connect', modes: ['AC', 'DC'], modules: 6, poles: 4, heightMm: 40, depthMm: 20, legacy: true, icon: '═', hint: 'PE', isBar: true, widthMm: 110 },
    { id: 'busbar', name: 'Busbar', nameTh: 'บัสบาร์', cat: 'connect', modes: ['AC', 'DC'], modules: 8, poles: 4, heightMm: 30, depthMm: 20, icon: '▬', hint: 'บัส', isBar: true, widthMm: 160 },

    /* —— อัตโนมัติ / ขับเคลื่อน —— */
    { id: 'plc', name: 'PLC', nameTh: 'PLC', cat: 'automation', modes: ['AC', 'DC'], modules: 8, poles: 4, heightMm: 110, depthMm: 90, icon: '▤', hint: 'คอนโทรลเลอร์', widthMm: 140 },
    { id: 'vfd', name: 'VFD', nameTh: 'อินเวอร์เตอร์ / VFD', cat: 'automation', modes: ['AC'], modules: 8, poles: 3, heightMm: 160, depthMm: 160, icon: '▣', hint: 'ขับมอเตอร์', freePlace: true, widthMm: 140 },

    /* —— DC / Solar —— */
    { id: 'DC MCB', name: 'DC MCB', nameTh: 'เบรกเกอร์ DC', cat: 'protection', modes: ['DC'], modules: 2, poles: 2, heightMm: 90, depthMm: 70, legacy: true, icon: '▦', hint: '2P · DC' },
    { id: 'dc-mcb-1p', name: 'DC MCB 1P', nameTh: 'เบรกเกอร์ DC 1P', cat: 'protection', modes: ['DC'], modules: 1, poles: 1, heightMm: 90, depthMm: 70, icon: '▦', hint: '1P · DC' },
    { id: 'FUSE', name: 'Fuse', nameTh: 'ฟิวส์สตริง', cat: 'protection', modes: ['DC'], modules: 1, poles: 1, heightMm: 90, depthMm: 55, legacy: true, icon: '━', hint: 'DC' },
    { id: 'fuse-holder', name: 'Fuse 2P', nameTh: 'ฟิวส์โฮลเดอร์ 2P', cat: 'protection', modes: ['DC'], modules: 2, poles: 2, heightMm: 90, depthMm: 55, icon: '━', hint: 'DC' },
    { id: 'DC SPD', name: 'DC SPD', nameTh: 'ป้องกันไฟกระชาก DC', cat: 'protection', modes: ['DC'], modules: 2, poles: 2, heightMm: 90, depthMm: 70, legacy: true, icon: '⚡', hint: 'DC' },
    { id: 'ISOLATOR', name: 'Isolator', nameTh: 'สวิตช์ตัดตอน DC', cat: 'protection', modes: ['DC'], modules: 2, poles: 2, heightMm: 90, depthMm: 70, legacy: true, icon: '⏻', hint: '2P · DC' },
    { id: 'dc-isolator-4p', name: 'Isolator 4P', nameTh: 'สวิตช์ตัดตอน 4P', cat: 'protection', modes: ['DC'], modules: 4, poles: 4, heightMm: 90, depthMm: 80, icon: '⏻', hint: '4P · DC' }
  ],

  categories: {
    protection: 'ป้องกัน / ตัดตอน',
    control: 'ควบคุม',
    hmi: 'หน้าตู้ / มิเตอร์',
    connect: 'ต่อสาย / บาร์',
    automation: 'อัตโนมัติ / ขับเคลื่อน'
  }
};
