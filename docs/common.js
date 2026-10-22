// ฟังก์ชันที่ใช้ร่วมกันระหว่างหน้าเว็บ (app.js) และ service worker (sw.js)
(function (root) {
  var OFM_TILEJSON = 'https://tiles.openfreemap.org/planet';
  var DEM_TEMPLATE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  var GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

  var VECTOR_MAXZOOM = 14; // ระดับซูมสูงสุดของไทล์เวกเตอร์
  var DEM_MAXZOOM = 12; // ระดับซูมสูงสุดของไทล์ความสูง
  var MIN_ZOOM = 10; // ระดับซูมต่ำสุดที่ดาวน์โหลด

  // ไทล์เวกเตอร์ของ OpenFreeMap มีเลขเวอร์ชันในพาธ (เช่น /planet/20261022_001001_pt/...)
  // เปลี่ยนเป็นคีย์ที่ไม่ผูกกับเวอร์ชัน เพื่อให้ไทล์ที่เก็บไว้ใช้ได้ต่อแม้เวอร์ชันเปลี่ยน
  function cacheKey(url) {
    var m = /^https:\/\/tiles\.openfreemap\.org\/planet\/[^/]+\/(\d+\/\d+\/\d+\.pbf)$/.exec(url);
    if (m) return 'https://ofm-tiles.local/planet/' + m[1];
    return url;
  }

  function isCacheable(url) {
    if (url === OFM_TILEJSON) return false; // TileJSON ต้องได้ของใหม่เสมอ (มีเลขเวอร์ชัน)
    return (
      url.indexOf('https://tiles.openfreemap.org/') === 0 ||
      url.indexOf('https://s3.amazonaws.com/elevation-tiles-prod/') === 0
    );
  }

  function lngToX(lng, z) {
    return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
  }

  function latToY(lat, z) {
    var rad = (lat * Math.PI) / 180;
    return Math.floor(
      ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z)
    );
  }

  function clampTile(v, z) {
    var max = Math.pow(2, z) - 1;
    return Math.max(0, Math.min(max, v));
  }

  // bounds = [west, south, east, north]; คืนรายการ {z,x,y}
  function tilesForBounds(bounds, minZ, maxZ) {
    var west = bounds[0], south = bounds[1], east = bounds[2], north = bounds[3];
    var out = [];
    for (var z = minZ; z <= maxZ; z++) {
      var x0 = clampTile(lngToX(west, z), z);
      var x1 = clampTile(lngToX(east, z), z);
      var y0 = clampTile(latToY(north, z), z);
      var y1 = clampTile(latToY(south, z), z);
      for (var x = x0; x <= x1; x++) {
        for (var y = y0; y <= y1; y++) out.push({ z: z, x: x, y: y });
      }
    }
    return out;
  }

  function countTiles(bounds) {
    return (
      tilesForBounds(bounds, MIN_ZOOM, VECTOR_MAXZOOM).length +
      tilesForBounds(bounds, MIN_ZOOM, DEM_MAXZOOM).length
    );
  }

  function fillTemplate(tpl, t) {
    return tpl.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
  }

  // ไฟล์ตัวอักษรที่ต้องใช้ (ละติน + ไทย)
  function glyphUrls() {
    var fonts = ['Noto Sans Regular', 'Noto Sans Bold'];
    var ranges = ['0-255', '256-511', '3584-3839', '8192-8447'];
    var out = [];
    fonts.forEach(function (f) {
      ranges.forEach(function (r) {
        out.push(
          GLYPHS.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', r)
        );
      });
    });
    return out;
  }

  // สไตล์แผนที่เดินป่า: ป่า/น้ำ/ถนน/ทางเดินเท้า + เงาเขา + ยอดเขาพร้อมความสูง
  function buildStyle(vectorTemplate) {
    var FONT = ['Noto Sans Regular'];
    var FONT_BOLD = ['Noto Sans Bold'];
    return {
      version: 8,
      name: 'Trail',
      glyphs: GLYPHS,
      sources: {
        openmaptiles: {
          type: 'vector',
          tiles: [vectorTemplate],
          maxzoom: VECTOR_MAXZOOM,
          attribution:
            '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
            '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
        },
        dem: {
          type: 'raster-dem',
          tiles: [DEM_TEMPLATE],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: DEM_MAXZOOM,
          attribution: 'Terrain Tiles: Mapzen, NASA SRTM, USGS (AWS Open Data)'
        }
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#f1efe6' } },
        {
          id: 'landcover_wood', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
          filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-color': '#b9d8a8' }
        },
        {
          id: 'landcover_grass', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
          filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland']]],
          paint: { 'fill-color': '#dbe8c4' }
        },
        {
          id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park',
          paint: { 'fill-color': '#a9d19a', 'fill-opacity': 0.4 }
        },
        {
          id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water',
          paint: { 'fill-color': '#9ebdff' }
        },
        {
          id: 'waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway',
          paint: {
            'line-color': '#7fa8e8',
            'line-width': ['interpolate', ['exponential', 1.2], ['zoom'], 10, 0.6, 16, 3]
          }
        },
        {
          id: 'hillshade', type: 'hillshade', source: 'dem',
          paint: {
            'hillshade-exaggeration': 0.6,
            'hillshade-shadow-color': '#3b3b2f',
            'hillshade-highlight-color': '#ffffff',
            'hillshade-accent-color': '#5a5a45'
          }
        },
        {
          id: 'road_path', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
          minzoom: 12,
          filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]],
          layout: { 'line-cap': 'round' },
          paint: {
            'line-color': '#c4501b',
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 18, 3],
            'line-dasharray': [2, 1.5]
          }
        },
        {
          id: 'road_minor', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary', 'secondary']]],
          paint: {
            'line-color': '#ffffff',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 18, 8]
          }
        },
        {
          id: 'road_major', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['primary', 'trunk', 'motorway']]],
          paint: {
            'line-color': '#f4c26b',
            'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 18, 12]
          }
        },
        {
          id: 'boundary', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary',
          filter: ['<=', ['get', 'admin_level'], 4],
          paint: { 'line-color': '#9b8fb0', 'line-width': 1, 'line-dasharray': [4, 2] }
        },
        {
          id: 'peak', type: 'symbol', source: 'openmaptiles', 'source-layer': 'mountain_peak',
          minzoom: 10,
          layout: {
            'text-field': [
              'format',
              ['coalesce', ['get', 'name'], ''], {},
              '\n', {},
              ['concat', '▲ ', ['to-string', ['coalesce', ['get', 'ele'], '']], ' ม.'],
              { 'font-scale': 0.9 }
            ],
            'text-font': FONT_BOLD,
            'text-size': 12,
            'text-anchor': 'top'
          },
          paint: { 'text-color': '#5b3a1a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 }
        },
        {
          id: 'water_name', type: 'symbol', source: 'openmaptiles', 'source-layer': 'water_name',
          layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11 },
          paint: { 'text-color': '#3a62b3', 'text-halo-color': '#ffffff', 'text-halo-width': 1 }
        },
        {
          id: 'place', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
          layout: {
            'text-field': ['coalesce', ['get', 'name:th'], ['get', 'name']],
            'text-font': FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 14, 16]
          },
          paint: { 'text-color': '#000000', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 }
        }
      ]
    };
  }

  root.TrailCommon = {
    OFM_TILEJSON: OFM_TILEJSON,
    DEM_TEMPLATE: DEM_TEMPLATE,
    VECTOR_MAXZOOM: VECTOR_MAXZOOM,
    DEM_MAXZOOM: DEM_MAXZOOM,
    MIN_ZOOM: MIN_ZOOM,
    cacheKey: cacheKey,
    isCacheable: isCacheable,
    tilesForBounds: tilesForBounds,
    countTiles: countTiles,
    fillTemplate: fillTemplate,
    glyphUrls: glyphUrls,
    buildStyle: buildStyle
  };
})(typeof self !== 'undefined' ? self : this);
