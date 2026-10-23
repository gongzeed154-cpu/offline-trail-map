// เส้นชั้นความสูง: สร้างบนเครื่องจากข้อมูลความสูง (DEM) ชุดเดียวกับที่ใช้ทำเงาเขา ใช้ไลบรารี maplibre-contour
// ระยะห่างเส้นปรับตามระดับซูมเพื่อให้อ่านออก ตั้งแต่ซูม 13 ขึ้นไปเป็นเส้นละ 20 ม. เส้นหลักทุก 100 ม. พร้อมตัวเลขความสูง
// ข้อมูลความสูงละเอียดราว 30-40 ม. ต่อจุด เส้นบนที่ราบจะไม่เนียนเท่าแผนที่ทหาร 1:50,000
(function (root) {
  var C = TrailCommon;
  var ctx = null; // { map: () => map, toast }
  var dem = null;
  var added = false;
  var failedWarn = false;

  // zoom: [เส้นรอง, เส้นหลัก] เป็นเมตร
  var THRESHOLDS = { 11: [100, 500], 12: [40, 200], 13: [20, 100] };
  var LINE_COLOR = '#a0602a';
  var MIN_ZOOM = 11;

  function init(c) { ctx = c; }

  function setup() {
    if (added) return true;
    if (!root.mlcontour) { ctx.toast('โหลดตัวสร้างเส้นชั้นความสูงไม่ได้'); return false; }
    var map = ctx.map();
    if (!dem) {
      dem = new root.mlcontour.DemSource({
        url: C.DEM_TEMPLATE, encoding: 'terrarium', maxzoom: C.DEM_MAXZOOM, worker: true, cacheSize: 100, timeoutMs: 15000
      });
      dem.setupMaplibre(root.maplibregl);
    }
    map.addSource('contours', {
      type: 'vector', minzoom: MIN_ZOOM, maxzoom: 15,
      tiles: [dem.contourProtocolUrl({
        thresholds: THRESHOLDS, contourLayer: 'contours', elevationKey: 'ele', levelKey: 'level', extent: 4096, buffer: 1
      })]
    });
    map.addLayer({
      id: 'contour-lines', type: 'line', source: 'contours', 'source-layer': 'contours', minzoom: MIN_ZOOM,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': LINE_COLOR,
        'line-opacity': 0.85,
        'line-width': ['interpolate', ['linear'], ['zoom'],
          11, ['match', ['get', 'level'], 1, 0.7, 0.35],
          15, ['match', ['get', 'level'], 1, 1.8, 0.8]]
      }
    }, map.getLayer('road_path') ? 'road_path' : undefined);
    map.addLayer({
      id: 'contour-labels', type: 'symbol', source: 'contours', 'source-layer': 'contours', minzoom: 12,
      filter: ['>', ['get', 'level'], 0],
      layout: {
        'symbol-placement': 'line', 'text-size': 11, 'text-font': ['Noto Sans Bold'],
        'text-field': ['number-format', ['get', 'ele'], {}], 'symbol-spacing': 300
      },
      paint: { 'text-color': '#6b3b12', 'text-halo-color': 'rgba(255,255,255,.9)', 'text-halo-width': 1.5 }
    }, map.getLayer('traffic') ? 'traffic' : undefined);
    map.on('error', function (e) {
      if (failedWarn || !e || e.sourceId !== 'contours') return;
      failedWarn = true;
      ctx.toast('สร้างเส้นชั้นความสูงบางส่วนไม่ได้ (ไม่มีข้อมูลความสูงของพื้นที่นี้ ต้องมีอินเทอร์เน็ตหรือดาวน์โหลดพื้นที่ไว้)');
    });
    added = true;
    return true;
  }

  function apply(on) {
    var map = ctx && ctx.map();
    if (!map) return;
    if (on && !setup()) return;
    ['contour-lines', 'contour-labels'].forEach(function (id) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    });
  }

  root.TrailContour = { init: init, apply: apply };
})(typeof self !== 'undefined' ? self : this);
