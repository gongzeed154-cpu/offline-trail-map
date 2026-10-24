// ส่งออก/นำเข้าเส้นทาง: GPX (แทร็ก/route), KML, GeoJSON, Markdown
(function (root) {
  var G = TrailGeo;
  var R = TrailRoute;

  var FORMATS = {
    gpx: { ext: 'gpx', mime: 'application/gpx+xml', label: 'GPX แทร็ก + จุดปัก (แนะนำสำหรับนาฬิกา/แอพนำทาง)' },
    gpxrte: { ext: 'gpx', mime: 'application/gpx+xml', label: 'GPX แบบ Route (เฉพาะจุดปัก)' },
    kml: { ext: 'kml', mime: 'application/vnd.google-earth.kml+xml', label: 'KML (Google Earth / Google Maps)' },
    geojson: { ext: 'geojson', mime: 'application/geo+json', label: 'GeoJSON (QGIS / เว็บแผนที่)' },
    md: { ext: 'md', mime: 'text/markdown', label: 'Markdown (ตารางจุด ทิศ ระยะ สำหรับอ่าน/พิมพ์)' }
  };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_').trim() || 'route'; }
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' กม.' : Math.round(m) + ' ม.'; }
  function fmtDur(sec) {
    if (!isFinite(sec)) return '–';
    var m = Math.round(sec / 60);
    return m < 60 ? m + ' นาที' : Math.floor(m / 60) + ' ชม. ' + (m % 60) + ' น.';
  }

  // เพิ่มจุดระหว่างทางให้เส้นตรงยาวๆ มีโปรไฟล์ความสูงและแสดงบนนาฬิกาได้ละเอียด
  function densify(pts, step) {
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var d = G.haversine({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] });
      var n = Math.max(1, Math.ceil(d / step));
      for (var k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    return out;
  }

  async function eleFor(pts, onStatus) {
    var out = new Array(pts.length), CH = 40;
    for (var i = 0; i < pts.length; i += CH) {
      var jobs = [];
      for (var j = i; j < Math.min(pts.length, i + CH); j++) {
        (function (k) {
          jobs.push(R.elevAsync(pts[k][1], pts[k][0]).then(function (v) { out[k] = typeof v === 'number' ? v : null; }).catch(function () { out[k] = null; }));
        })(j);
      }
      await Promise.all(jobs);
      if (onStatus) onStatus('อ่านความสูง ' + Math.min(pts.length, i + CH) + '/' + pts.length);
    }
    return out;
  }

  // เตรียมข้อมูลเส้นทาง: จุดละเอียด + ความสูง
  async function prepare(list, onStatus) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var L = R.polyLength(r.pts);
      var pts = densify(r.pts, Math.max(30, L / 1500));
      if (onStatus) onStatus('เส้นทาง ' + (i + 1) + '/' + list.length + ' · อ่านความสูง…');
      var ele = await eleFor(pts, function (t) { if (onStatus) onStatus('เส้นทาง ' + (i + 1) + '/' + list.length + ' · ' + t); });
      var wpts = r.wps.map(function (w) { return [w.lng, w.lat]; });
      var wele = await eleFor(wpts);
      out.push({ r: r, pts: pts, ele: ele, wele: wele });
    }
    return out;
  }

  function e1(v) { return v === null || v === undefined ? '' : '<ele>' + v.toFixed(1) + '</ele>'; }
  function wpName(r, i) { return i === 0 ? 'เริ่มต้น' : i === r.wps.length - 1 ? 'ปลายทาง' : 'จุด ' + (i + 1); }

  function buildGPX(items, asRoute) {
    var s = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="แผนที่เดินป่าออฟไลน์" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      '<metadata><name>' + esc(items.length === 1 ? items[0].r.name : 'เส้นทางเดินป่า') + '</name><time>' + new Date().toISOString() + '</time></metadata>\n';
    items.forEach(function (it) {
      var r = it.r;
      if (!asRoute) {
        r.wps.forEach(function (w, i) {
          s += '<wpt lat="' + w.lat.toFixed(6) + '" lon="' + w.lng.toFixed(6) + '">' + e1(it.wele[i]) + '<name>' + esc(r.name + ' – ' + wpName(r, i)) + '</name></wpt>\n';
        });
        s += '<trk><name>' + esc(r.name) + '</name><trkseg>\n';
        it.pts.forEach(function (p, i) { s += '<trkpt lat="' + p[1].toFixed(6) + '" lon="' + p[0].toFixed(6) + '">' + e1(it.ele[i]) + '</trkpt>\n'; });
        s += '</trkseg></trk>\n';
      } else {
        s += '<rte><name>' + esc(r.name) + '</name>\n';
        r.wps.forEach(function (w, i) {
          s += '<rtept lat="' + w.lat.toFixed(6) + '" lon="' + w.lng.toFixed(6) + '">' + e1(it.wele[i]) + '<name>' + esc(wpName(r, i)) + '</name></rtept>\n';
        });
        s += '</rte>\n';
      }
    });
    return s + '</gpx>\n';
  }

  function coordStr(pts, ele) {
    return pts.map(function (p, i) { return p[0].toFixed(6) + ',' + p[1].toFixed(6) + ',' + (ele[i] === null || ele[i] === undefined ? 0 : ele[i].toFixed(1)); }).join(' ');
  }

  function buildKML(items) {
    var s = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n<name>' +
      esc(items.length === 1 ? items[0].r.name : 'เส้นทางเดินป่า') + '</name>\n' +
      '<Style id="ln"><LineStyle><color>ffbf2c7b</color><width>4</width></LineStyle></Style>\n';
    items.forEach(function (it) {
      var r = it.r;
      s += '<Folder><name>' + esc(r.name) + '</name>\n';
      s += '<Placemark><name>' + esc(r.name) + '</name><description>' + esc('ระยะ ' + fmtDist(r.dist) + ' · เวลาโดยประมาณ ' + fmtDur(r.time)) + '</description><styleUrl>#ln</styleUrl>' +
        '<LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>' + coordStr(it.pts, it.ele) + '</coordinates></LineString></Placemark>\n';
      r.wps.forEach(function (w, i) {
        s += '<Placemark><name>' + esc(wpName(r, i)) + '</name><Point><coordinates>' + w.lng.toFixed(6) + ',' + w.lat.toFixed(6) + ',' + (it.wele[i] === null ? 0 : it.wele[i].toFixed(1)) + '</coordinates></Point></Placemark>\n';
      });
      s += '</Folder>\n';
    });
    return s + '</Document></kml>\n';
  }

  function buildGeoJSON(items) {
    var feats = [];
    items.forEach(function (it) {
      var r = it.r;
      feats.push({
        type: 'Feature',
        properties: { name: r.name, distance_m: Math.round(r.dist), est_time_s: Math.round(r.time) },
        geometry: { type: 'LineString', coordinates: it.pts.map(function (p, i) { return it.ele[i] === null ? [p[0], p[1]] : [p[0], p[1], Math.round(it.ele[i] * 10) / 10]; }) }
      });
      r.wps.forEach(function (w, i) {
        feats.push({ type: 'Feature', properties: { name: wpName(r, i), route: r.name, index: i + 1 }, geometry: { type: 'Point', coordinates: it.wele[i] === null ? [w.lng, w.lat] : [w.lng, w.lat, it.wele[i]] } });
      });
    });
    return JSON.stringify({ type: 'FeatureCollection', features: feats }, null, 1);
  }

  function buildMD(items, o) {
    var s = '# เส้นทางเดินป่า\n\nสร้างเมื่อ ' + new Date().toLocaleString('th-TH') + ' · แอพแผนที่เดินป่าออฟไลน์\n\n';
    items.forEach(function (it) {
      var r = it.r;
      s += '## ' + r.name + '\n\n';
      s += '- ระยะรวม: **' + fmtDist(r.dist) + '**\n- เวลาโดยประมาณ: **' + fmtDur(r.time) + '**\n- จำนวนจุดปัก: ' + r.wps.length + '\n';
      if (r.ascent) s += '- ขึ้นสะสม ' + r.ascent + ' ม. · ลงสะสม ' + (r.descent || 0) + ' ม.\n';
      if (r.saddles) s += '- ข้ามคอเขา ' + r.saddles + ' จุด\n';
      var emin = null, emax = null;
      it.ele.forEach(function (v) { if (v !== null) { emin = emin === null ? v : Math.min(emin, v); emax = emax === null ? v : Math.max(emax, v); } });
      if (emin !== null) s += '- ความสูงต่ำสุด–สูงสุดตามแนวเส้น: ' + Math.round(emin) + ' – ' + Math.round(emax) + ' ม.\n';
      s += '\n| # | ชื่อ | พิกัด | ละติจูด, ลองจิจูด | สูง (ม.) | ทิศกริด (องศา / มิล) | ทิศจริง | ระยะจากจุดก่อน | สะสม | เวลาสะสม |\n|---|---|---|---|---|---|---|---|---|---|\n';
      var cum = 0, ct = 0;
      r.wps.forEach(function (w, i) {
        var tg = '–', tt = '–', dd = '–';
        if (i > 0) {
          var a = r.wps[i - 1];
          var az = G.trueAzimuth(a, w), gr = G.norm360(az - G.convergence(a.lat, a.lng));
          tg = gr.toFixed(1) + '° / ' + Math.round(gr * 6400 / 360);
          tt = az.toFixed(1) + '°';
          dd = fmtDist(r.legDist[i - 1]);
          cum += r.legDist[i - 1];
          ct += r.legTime[i - 1];
        }
        s += '| ' + (i + 1) + ' | ' + wpName(r, i) + ' | ' + o.fmtPoint(w.lat, w.lng) + ' | ' + w.lat.toFixed(5) + ', ' + w.lng.toFixed(5) + ' | ' +
          (it.wele[i] === null ? '–' : Math.round(it.wele[i])) + ' | ' + tg + ' | ' + tt + ' | ' + dd + ' | ' + fmtDist(cum) + ' | ' + fmtDur(ct) + ' |\n';
      });
      s += '\n';
    });
    s += '> ค่าความสูงมาจากข้อมูลภูมิประเทศความละเอียดประมาณ 35 ม. และทิศเป็นทิศระหว่างจุดปัก (เส้นตรง) ควรตรวจกับสภาพจริงเสมอ\n';
    return s;
  }

  // สร้างไฟล์ คืน { name, mime, text }
  async function build(list, fmt, o, onStatus) {
    var f = FORMATS[fmt];
    var items = await prepare(list, onStatus);
    var text;
    if (fmt === 'gpx') text = buildGPX(items, false);
    else if (fmt === 'gpxrte') text = buildGPX(items, true);
    else if (fmt === 'kml') text = buildKML(items);
    else if (fmt === 'geojson') text = buildGeoJSON(items);
    else text = buildMD(items, o);
    var base = list.length === 1 ? safeName(list[0].name) : 'เส้นทาง-' + list.length + '-เส้น';
    return { name: base + (fmt === 'gpxrte' ? '-route' : '') + '.' + f.ext, mime: f.mime, text: text };
  }

  function download(file) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(file.blob || new Blob([file.text], { type: file.mime + ';charset=utf-8' }));
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  }

  // เปิดแผ่นแชร์ของเครื่อง (ส่งเข้าแอพ Files / แอพนาฬิกา / AirDrop) คืน Promise<boolean>
  function share(file) {
    var f = null;
    try { f = new File([file.blob || file.text], file.name, { type: file.mime }); } catch (e) { f = null; }
    if (f && navigator.canShare && navigator.canShare({ files: [f] })) {
      return navigator.share({ files: [f], title: file.name }).then(function () { return true; }).catch(function (e) { return !!(e && e.name === 'AbortError'); });
    }
    return Promise.resolve(false);
  }

  /* ---------- นำเข้า ---------- */
  function parseCoordsKML(txt) {
    var out = [];
    txt.trim().split(/\s+/).forEach(function (t) {
      var p = t.split(',');
      var lng = parseFloat(p[0]), lat = parseFloat(p[1]);
      if (!isNaN(lng) && !isNaN(lat)) out.push([lng, lat]);
    });
    return out;
  }
  function textOf(el, tag) {
    var n = el.getElementsByTagName(tag)[0];
    return n && n.textContent ? n.textContent.trim() : '';
  }

  /* ---------- อ่านไฟล์ (รองรับ KMZ ของ Google Earth) ---------- */
  // KMZ คือไฟล์ ZIP ที่มี doc.kml อยู่ข้างใน อ่านตารางไฟล์ท้าย ZIP แล้วแตกเฉพาะไฟล์ .kml (ไม่ต้องใช้ไลบรารีเสริม)
  function unzipKml(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf), i, eocd = -1;
    for (i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ไฟล์ KMZ ไม่ถูกต้อง');
    var n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true), list = [];
    for (i = 0; i < n; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      var nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true);
      list.push({
        method: dv.getUint16(off + 10, true), csize: dv.getUint32(off + 20, true), lho: dv.getUint32(off + 42, true),
        name: new TextDecoder('utf-8').decode(u8.subarray(off + 46, off + 46 + nl))
      });
      off += 46 + nl + el + cl;
    }
    var pick = list.filter(function (e) { return /(^|\/)doc\.kml$/i.test(e.name); })[0] || list.filter(function (e) { return /\.kml$/i.test(e.name); })[0];
    if (!pick) throw new Error('ไม่พบไฟล์ .kml ใน KMZ นี้');
    var start = pick.lho + 30 + dv.getUint16(pick.lho + 26, true) + dv.getUint16(pick.lho + 28, true);
    var data = u8.subarray(start, start + pick.csize);
    if (pick.method === 0) return Promise.resolve(new TextDecoder('utf-8').decode(data));
    if (pick.method !== 8 || typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error('เครื่องนี้แตกไฟล์ KMZ ไม่ได้ ให้บันทึกเป็น .kml จาก Google Earth แล้วนำเข้าแทน'));
    }
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(function (ab) {
      return new TextDecoder('utf-8').decode(ab);
    });
  }

  // อ่านไฟล์ที่ผู้ใช้เลือก คืนข้อความ XML/JSON (แตก KMZ ให้อัตโนมัติ)
  function readFile(file) {
    return file.arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf, 0, 2);
      if (/\.kmz$/i.test(file.name) || (b[0] === 0x50 && b[1] === 0x4b)) return unzipKml(buf);
      return new TextDecoder('utf-8').decode(buf);
    });
  }

  // คืนรายการหมุดจาก KML (Placemark ที่เป็นจุด) [{ name, lat, lng }]
  function parsePoints(text) {
    var out = [];
    if (text.trim().charAt(0) === '{' || !/<kml|<Placemark/i.test(text)) return out;
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return out;
    Array.prototype.forEach.call(doc.getElementsByTagName('Placemark'), function (pm) {
      if (pm.getElementsByTagName('LineString').length || pm.getElementsByTagName('Polygon').length || pm.getElementsByTagName('gx:Track').length) return;
      Array.prototype.forEach.call(pm.getElementsByTagName('Point'), function (pt) {
        var c = parseCoordsKML(textOf(pt, 'coordinates'))[0];
        if (c) out.push({ name: textOf(pm, 'name') || 'หมุด', lat: c[1], lng: c[0] });
      });
    });
    return out;
  }

  // คืนรายการ [{ name, pts:[[lng,lat],...] }]
  function parseFile(text, filename) {
    var out = [];
    var lower = (filename || '').toLowerCase();
    if (/\.(geojson|json)$/.test(lower) || text.trim().charAt(0) === '{') {
      var j = JSON.parse(text);
      var feats = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [{ type: 'Feature', properties: {}, geometry: j }];
      feats.forEach(function (f, i) {
        var g = f.geometry || {};
        var nm = (f.properties && (f.properties.name || f.properties.Name)) || (filename || 'นำเข้า') + ' ' + (i + 1);
        var lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
        lines.forEach(function (c) { out.push({ name: nm, pts: c.map(function (p) { return [p[0], p[1]]; }) }); });
      });
      return out;
    }
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('อ่านไฟล์ไม่ได้');
    var base = (filename || 'นำเข้า').replace(/\.[^.]+$/, '');
    if (doc.documentElement.tagName.toLowerCase() === 'gpx') {
      Array.prototype.forEach.call(doc.getElementsByTagName('trk'), function (trk, i) {
        var pts = [];
        Array.prototype.forEach.call(trk.getElementsByTagName('trkpt'), function (p) { pts.push([parseFloat(p.getAttribute('lon')), parseFloat(p.getAttribute('lat'))]); });
        out.push({ name: textOf(trk, 'name') || base + ' แทร็ก ' + (i + 1), pts: pts });
      });
      Array.prototype.forEach.call(doc.getElementsByTagName('rte'), function (rte, i) {
        var pts = [];
        Array.prototype.forEach.call(rte.getElementsByTagName('rtept'), function (p) { pts.push([parseFloat(p.getAttribute('lon')), parseFloat(p.getAttribute('lat'))]); });
        out.push({ name: textOf(rte, 'name') || base + ' route ' + (i + 1), pts: pts });
      });
    } else {
      Array.prototype.forEach.call(doc.getElementsByTagName('Placemark'), function (pm, i) {
        var nm = textOf(pm, 'name') || base + ' ' + (i + 1);
        Array.prototype.forEach.call(pm.getElementsByTagName('LineString'), function (ls) {
          out.push({ name: nm, pts: parseCoordsKML(textOf(ls, 'coordinates')) });
        });
        // รูปหลายเหลี่ยม (ขอบเขต) นำเข้าเป็นเส้นปิด
        Array.prototype.forEach.call(pm.getElementsByTagName('Polygon'), function (pg) {
          var ob = pg.getElementsByTagName('outerBoundaryIs')[0] || pg;
          out.push({ name: nm, pts: parseCoordsKML(textOf(ob, 'coordinates')) });
        });
        // แทร็กจาก GPS (gx:Track): <gx:coord>ลองจิจูด ละติจูด ความสูง</gx:coord>
        Array.prototype.forEach.call(pm.getElementsByTagName('gx:Track'), function (tr) {
          var pts = [];
          Array.prototype.forEach.call(tr.getElementsByTagName('gx:coord'), function (c) {
            var q = c.textContent.trim().split(/\s+/);
            pts.push([parseFloat(q[0]), parseFloat(q[1])]);
          });
          out.push({ name: nm, pts: pts });
        });
      });
    }
    return out.filter(function (x) { return x.pts.length >= 2 && x.pts.every(function (p) { return isFinite(p[0]) && isFinite(p[1]); }); });
  }

  root.TrailExport = { FORMATS: FORMATS, build: build, download: download, share: share, parseFile: parseFile, parsePoints: parsePoints, readFile: readFile, fmtDist: fmtDist, fmtDur: fmtDur };
})(typeof self !== 'undefined' ? self : this);
