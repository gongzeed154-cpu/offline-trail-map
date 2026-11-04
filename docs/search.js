// ช่องค้นหา: พิกัดทุกรูปแบบ (MGRS, UTM, องศา ลิปดา ฟิลิปดา, องศา ลิปดาทศนิยม, องศาทศนิยม) · ชื่อสถานที่ · ลักษณะภูมิประเทศและเส้นชั้นความสูง
// ชื่อสถานที่: หาในแผนที่ที่โหลดอยู่บนจอก่อน (ออฟไลน์ได้) แล้วถามบริการ Nominatim ของ OpenStreetMap (ต้องมีเน็ต)
(function (root) {
  var G = TrailGeo;
  var ctx = null; // { map, toast, closeSheet, setContour }
  var marker = null;
  var state = { q: '', title: '', items: [], msg: '', coordCard: null };

  var TERRAIN_BTNS = [['peak', 'ยอดเขา'], ['ridge', 'สันเขา'], ['saddle', 'คอเขา'], ['valley', 'หุบเขา'], ['cliff', 'หน้าผา'], ['depression', 'ที่ต่ำบนภูเขา'], ['stream', 'ร่องน้ำ']];
  var CONTOUR_BTNS = [['index', 'เส้นชั้นหลัก'], ['intermediate', 'เส้นรอง'], ['supplementary', 'เส้นแทรก'], ['approx', 'เส้นโดยประมาณ'], ['depr', 'เส้นคุ้งกระทะ'], ['all', 'ทั้งหมด']];
  var CONTOUR_INFO = {
    index: 'เส้นชั้นความสูงหลัก: เส้นหนา ทุก 100 ม. มีตัวเลขความสูง (ซูมใกล้ ๆ ถึงจะเห็นครบ)',
    intermediate: 'เส้นชั้นความสูงรอง: เส้นบาง ทุก 20 ม. (ซูม 13 ขึ้นไป ซูมออกจะห่างขึ้นเอง)',
    supplementary: 'เส้นแทรก: เส้นประบาง ทุก 10 ม. ระหว่างเส้นรอง เห็นเมื่อซูม 14 ขึ้นไป ข้อมูลความสูงละเอียด ~30-40 ม. เส้นแทรกในที่ราบจึงไม่เนียน',
    approx: 'เส้นโดยประมาณ: แสดงเส้นชั้นความสูงทั้งหมดเป็นเส้นประ เส้นทุกเส้นในแอพนี้สร้างจากข้อมูลความสูงละเอียด ~30-40 ม. จึงเป็นค่าโดยประมาณทั้งหมด',
    all: 'แสดงเส้นชั้นความสูงตามปกติ (เส้นรอง 20 ม. เส้นหลัก 100 ม.)'
  };
  var KEYWORDS = {
    'ยอดเขา': ['t', 'peak'], 'ยอด': ['t', 'peak'], 'สันเขา': ['t', 'ridge'], 'สัน': ['t', 'ridge'], 'คอเขา': ['t', 'saddle'], 'หุบเขา': ['t', 'valley'], 'หุบ': ['t', 'valley'],
    'หน้าผา': ['t', 'cliff'], 'ที่ต่ำบนภูเขา': ['t', 'depression'], 'ที่ต่ำ': ['t', 'depression'], 'แอ่ง': ['t', 'depression'], 'ร่องน้ำ': ['t', 'stream'],
    'เส้นชั้นหลัก': ['c', 'index'], 'เส้นชั้นความสูงหลัก': ['c', 'index'], 'เส้นหลัก': ['c', 'index'], 'เส้นรอง': ['c', 'intermediate'], 'เส้นชั้นรอง': ['c', 'intermediate'], 'เส้นชั้นความสูงรอง': ['c', 'intermediate'],
    'เส้นแทรก': ['c', 'supplementary'], 'เส้นชั้นแทรก': ['c', 'supplementary'], 'เส้นโดยประมาณ': ['c', 'approx'], 'เส้นประมาณ': ['c', 'approx'], 'เส้นคุ้งกระทะ': ['c', 'depr'], 'คุ้งกระทะ': ['c', 'depr']
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text !== undefined) e.textContent = text; return e; }
  function init(c) { ctx = c; }
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' กม.' : Math.round(m) + ' ม.'; }

  /* ---------- ไปที่จุดหนึ่ง ---------- */
  function go(lat, lng, zoom, label) {
    var map = ctx.map();
    if (marker) marker.remove();
    marker = new maplibregl.Marker({ color: '#d6261c' }).setLngLat([lng, lat]).addTo(map);
    if (label) { var pop = new maplibregl.Popup({ offset: 28, closeButton: false }).setText(label); marker.setPopup(pop); }
    ctx.closeSheet();
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), zoom || 15), duration: 900 });
  }
  function pin(name, lat, lng) {
    if (root.TrailProj && TrailProj.addPin) { TrailProj.addPin(name || 'หมุดค้นหา', lat, lng); ctx.toast('ปักหมุดแล้ว: ' + (name || 'หมุดค้นหา')); }
  }

  /* ---------- ผลลัพธ์ ---------- */
  function renderResults() {
    var box = $('srRes');
    if (!box) return;
    box.innerHTML = '';
    if (state.coordCard) {
      var c = state.coordCard, card = el('div', 'background:#eef6f0;border-radius:10px;padding:10px 12px;margin-top:10px;line-height:1.6;font-size:14px');
      card.appendChild(el('div', 'font-weight:700;margin-bottom:4px', 'พิกัดที่ค้นหา'));
      G.FORMATS.forEach(function (f) { card.appendChild(el('div', 'font-size:13px', G.FORMAT_NAMES[f] + ': ' + G.formatPoint(c.lat, c.lng, f))); });
      var row = el('div', 'display:flex;gap:8px;margin-top:8px');
      var b1 = el('button', 'flex:1;border:0;border-radius:10px;padding:10px;background:#2e6b3f;color:#fff;font-size:14px', 'ไปที่จุดนี้');
      b1.onclick = function () { go(c.lat, c.lng, 16, G.formatPoint(c.lat, c.lng, 'dms')); };
      var b2 = el('button', 'flex:1;border:0;border-radius:10px;padding:10px;background:#e8efe9;color:#2e6b3f;font-size:14px', 'ปักหมุด');
      b2.onclick = function () { pin('พิกัดค้นหา', c.lat, c.lng); };
      row.appendChild(b1); row.appendChild(b2); card.appendChild(row);
      box.appendChild(card);
    }
    if (state.msg) box.appendChild(el('div', 'font-size:13px;color:#555;line-height:1.55;margin-top:10px;white-space:pre-line', state.msg));
    if (state.title) box.appendChild(el('h4', '', state.title));
    state.items.forEach(function (it) {
      var row = el('div', 'display:flex;align-items:center;gap:8px;border-bottom:1px solid #f0f0f0;padding:8px 0');
      var info = el('button', 'flex:1;text-align:left;border:0;background:none;padding:0;font-size:15px');
      info.appendChild(el('div', 'font-weight:600', it.name));
      info.appendChild(el('div', 'font-size:12.5px;color:#666;margin-top:1px', (it.detail ? it.detail + ' · ' : '') + fmtDist(it.dist) + (it.dir ? ' ทาง' + it.dir : '')));
      info.onclick = function () { go(it.lat, it.lng, it.zoom || 15, it.name); };
      var pb = el('button', 'flex:none;border:0;background:#e8efe9;color:#2e6b3f;border-radius:8px;padding:8px 10px;font-size:13px', 'ปักหมุด');
      pb.onclick = function () { pin(it.name, it.lat, it.lng); };
      row.appendChild(info); row.appendChild(pb);
      box.appendChild(row);
    });
    if (state.attrib) box.appendChild(el('div', 'font-size:11px;color:#888;margin-top:8px', state.attrib));
  }

  function setState(p) { for (var k in p) state[k] = p[k]; renderResults(); }

  /* ---------- ค้นหาชื่อในแผนที่ที่โหลดอยู่ (ออฟไลน์ได้) ---------- */
  var LAYER_LABEL = { place: 'สถานที่', mountain_peak: 'ยอดเขา/ภูเขา', poi: 'จุดสนใจ', water_name: 'แหล่งน้ำ', waterway: 'ทางน้ำ', transportation_name: 'ถนน/ทาง' };
  function searchLoaded(q) {
    var map = ctx.map(), cn = map.getCenter(), out = [], seen = {}, ql = q.toLowerCase();
    Object.keys(LAYER_LABEL).forEach(function (sl) {
      var feats = [];
      try { feats = map.querySourceFeatures('openmaptiles', { sourceLayer: sl }); } catch (e) { feats = []; }
      feats.forEach(function (f) {
        var p = f.properties || {}, names = [p['name:th'], p.name, p['name:en']].filter(Boolean);
        if (!names.some(function (n) { return String(n).toLowerCase().indexOf(ql) >= 0; })) return;
        var g = f.geometry, pt = null;
        if (g.type === 'Point') pt = g.coordinates;
        else if (g.type === 'LineString') pt = g.coordinates[Math.floor(g.coordinates.length / 2)];
        else if (g.type === 'MultiLineString') { var l0 = g.coordinates[0]; pt = l0[Math.floor(l0.length / 2)]; }
        else if (g.type === 'Polygon' || g.type === 'MultiPolygon') { var ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]; var sx = 0, sy = 0; ring.forEach(function (r) { sx += r[0]; sy += r[1]; }); pt = [sx / ring.length, sy / ring.length]; }
        if (!pt) return;
        var nm = names[0], key = nm + '|' + pt[0].toFixed(3) + '|' + pt[1].toFixed(3);
        if (seen[key]) return;
        seen[key] = 1;
        out.push({ name: nm, lat: pt[1], lng: pt[0], detail: LAYER_LABEL[sl] + (p.ele ? ' สูง ' + p.ele + ' ม.' : '') + ' (ในแผนที่ที่โหลด)', dist: G.haversine({ lat: cn.lat, lng: cn.lng }, { lat: pt[1], lng: pt[0] }) });
      });
    });
    out.sort(function (a, b) { return a.dist - b.dist; });
    return out.slice(0, 15);
  }

  function searchOnline(q) {
    var map = ctx.map(), b = map.getBounds(), cn = map.getCenter();
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=th&q=' + encodeURIComponent(q) +
      '&viewbox=' + [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].join(',');
    var ctl = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 10000);
    return fetch(url, { signal: ctl.signal }).then(function (r) { clearTimeout(to); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (list) {
        return list.map(function (r) {
          var lat = parseFloat(r.lat), lng = parseFloat(r.lon);
          var nm = (r.name || String(r.display_name || '').split(',')[0] || q);
          return { name: nm, lat: lat, lng: lng, detail: String(r.display_name || '').split(',').slice(1, 4).join(',').trim() || String(r.type || ''), dist: G.haversine({ lat: cn.lat, lng: cn.lng }, { lat: lat, lng: lng }), zoom: 15 };
        }).filter(function (r) { return isFinite(r.lat) && isFinite(r.lng); });
      }).catch(function (e) { clearTimeout(to); throw e; });
  }

  function doPlace(q) {
    var local = searchLoaded(q);
    setState({ coordCard: null, title: '', items: local, msg: local.length ? 'พบในแผนที่ที่โหลดอยู่ ' + local.length + ' รายการ กำลังค้นหาเพิ่ม…' : 'กำลังค้นหา…', attrib: '' });
    if (!navigator.onLine) {
      setState({ msg: local.length ? 'ออฟไลน์: แสดงเฉพาะชื่อที่อยู่ในแผนที่ที่โหลดบนจอ' : 'ออฟไลน์: ค้นหาชื่อได้เฉพาะที่อยู่ในแผนที่ที่โหลดบนจอ ไม่พบรายการ ลองเลื่อนแผนที่ไปใกล้ที่นั่นแล้วค้นใหม่ หรือค้นด้วยพิกัด' });
      return;
    }
    searchOnline(q).then(function (rem) {
      var all = local.concat(rem.filter(function (r) { return !local.some(function (l) { return Math.abs(l.lat - r.lat) < 0.0005 && Math.abs(l.lng - r.lng) < 0.0005; }); }));
      setState({ items: all, msg: all.length ? '' : 'ไม่พบ "' + q + '" ลองพิมพ์ชื่ออื่น หรือค้นด้วยพิกัด', attrib: rem.length ? 'ผลค้นหาออนไลน์จาก OpenStreetMap Nominatim (ชื่อที่พิมพ์ถูกส่งไปยังบริการนี้)' : '' });
    }).catch(function () {
      setState({ msg: (local.length ? 'แสดงเฉพาะชื่อในแผนที่ที่โหลดอยู่ ' : '') + 'ค้นหาออนไลน์ไม่ได้ (ไม่มีเน็ตหรือบริการไม่ตอบ) ลองใหม่ภายหลัง' });
    });
  }

  function doCoord(pt) {
    setState({ coordCard: { lat: pt.lat, lng: pt.lng }, title: '', items: [], msg: '', attrib: '' });
    go(pt.lat, pt.lng, 16, G.formatPoint(pt.lat, pt.lng, 'dms'));
  }

  function doTerrain(kind) {
    setState({ coordCard: null, title: '', items: [], msg: 'กำลังวิเคราะห์ภูมิประเทศรอบกลางจอ… (ครั้งแรกใช้เวลาสองสามวินาที)', attrib: '' });
    TrailTerrain.find(kind, function (t) { setState({ msg: t }); }).then(function (res) {
      var nm = TrailTerrain.NAMES[kind];
      setState({
        title: nm + ' รอบกลางจอ (' + res.items.length + ' จาก ' + res.total + ' ที่พบ)',
        items: res.items,
        msg: res.total ? 'วาดผลบนแผนที่แล้ว แตะรายการเพื่อไปดู · วิเคราะห์จากข้อมูลความสูงละเอียด ~30-40 ม. รอบกลางจอกว้างราว 28 กม. เป็นค่าประมาณ ต้องตรวจกับสภาพจริง' : 'ไม่พบ' + nm + 'ในบริเวณนี้ ลองเลื่อนกลางจอไปที่อื่นแล้วค้นใหม่'
      });
    }).catch(function (e) { setState({ msg: 'วิเคราะห์ไม่สำเร็จ: ' + (e && e.message ? e.message : e) }); });
  }

  function doContour(kind) {
    if (kind === 'depr') { doTerrain('depression'); return; }
    if (!TrailContour.showClass(kind)) { setState({ msg: 'เปิดเส้นชั้นความสูงไม่ได้' }); return; }
    setState({ coordCard: null, title: '', items: [], msg: CONTOUR_INFO[kind], attrib: '' });
  }

  function submit() {
    var q = ($('srQ').value || '').trim();
    state.q = q;
    if (!q) return;
    var kw = KEYWORDS[q.replace(/\s+/g, '')];
    if (kw) { if (kw[0] === 't') doTerrain(kw[1]); else doContour(kw[1]); return; }
    var pt = G.parsePoint(q);
    if (pt && isFinite(pt.lat) && isFinite(pt.lng) && Math.abs(pt.lat) <= 90 && Math.abs(pt.lng) <= 180) { doCoord(pt); return; }
    doPlace(q);
  }

  /* ---------- แผ่นค้นหา ---------- */
  function renderSheet(body) {
    body.innerHTML = '';
    var f = el('div', 'display:flex;gap:8px;margin:4px 0 8px');
    var inp = el('input', 'flex:1;min-width:0;font-size:16px;padding:10px;border:1px solid #ccc;border-radius:10px');
    inp.id = 'srQ'; inp.type = 'search'; inp.placeholder = 'ชื่อสถานที่ หรือพิกัด (MGRS/UTM/องศา)'; inp.value = state.q;
    inp.setAttribute('autocapitalize', 'characters'); inp.setAttribute('autocorrect', 'off'); inp.setAttribute('enterkeyhint', 'search');
    inp.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
    var go1 = el('button', 'flex:none;border:0;border-radius:10px;padding:10px 16px;background:#2e6b3f;color:#fff;font-size:15px', 'ค้นหา');
    go1.id = 'srGo'; go1.onclick = submit;
    f.appendChild(inp); f.appendChild(go1); body.appendChild(f);
    body.appendChild(el('div', 'font-size:12px;color:#777;line-height:1.5', 'ตัวอย่าง: 47PPR 00052 56624 · 14°04′43″N 99°55′36″E · 14.0787, 99.9266 · ดอยอินทนนท์ · ยอดเขา'));

    function chips(title, list, fn) {
      body.appendChild(el('h4', '', title));
      var wrap = el('div', 'display:flex;flex-wrap:wrap;gap:8px');
      list.forEach(function (it) {
        var b = el('button', 'border:1.5px solid #2e6b3f;background:#fff;color:#2e6b3f;border-radius:18px;padding:7px 12px;font-size:14px', it[1]);
        b.onclick = function () { fn(it[0]); };
        wrap.appendChild(b);
      });
      body.appendChild(wrap);
    }
    chips('ลักษณะภูมิประเทศ (วิเคราะห์รอบกลางจอ)', TERRAIN_BTNS, doTerrain);
    chips('เส้นชั้นความสูง', CONTOUR_BTNS, doContour);
    var clr = el('button', 'margin-top:12px;border:1px solid #bbb;background:#fff;color:#555;border-radius:18px;padding:7px 14px;font-size:13px', 'ล้างผลและหมุดค้นหาบนแผนที่');
    clr.onclick = function () { TrailTerrain.clear(); if (marker) { marker.remove(); marker = null; } if (TrailContour.getClass() !== 'all') TrailContour.showClass('all'); setState({ coordCard: null, title: '', items: [], msg: '', attrib: '' }); };
    body.appendChild(clr);
    var res = el('div'); res.id = 'srRes'; body.appendChild(res);
    renderResults();
    setTimeout(function () { try { inp.focus(); } catch (e) { /* ไม่เป็นไร */ } }, 50);
  }

  root.TrailSearch = { init: init, renderSheet: renderSheet };
})(typeof self !== 'undefined' ? self : this);
