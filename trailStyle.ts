// สไตล์แผนที่เดินป่า: พื้นที่ป่า/น้ำ/ถนน/ทางเดินเท้า + เงาเขา (hillshade) + ยอดเขาพร้อมความสูง
// ข้อมูลพื้นฐาน: OpenStreetMap ผ่าน OpenFreeMap, ข้อมูลความสูง: Terrain Tiles (AWS Open Data)

// ถ้ามีแหล่งเส้นชั้นความสูงแบบ vector tiles ให้ใส่ URL ที่นี่ (ตัวอย่าง: 'https://example.com/contours/{z}/{x}/{y}.pbf')
// ต้องมี layer ชื่อ "contour" และ field "ele" (เมตร) ถ้าเว้นว่างไว้ จะไม่แสดงเส้นชั้นความสูง
export const CONTOUR_TILES_URL: string = '';

const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];

export function buildTrailStyle(): Record<string, unknown> {
  const sources: Record<string, unknown> = {
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    dem: {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 12,
      attribution: 'Terrain Tiles: Mapzen, NASA SRTM, USGS (AWS Open Data)',
    },
  };
  if (CONTOUR_TILES_URL) {
    sources.contours = { type: 'vector', tiles: [CONTOUR_TILES_URL], maxzoom: 14 };
  }

  const layers: Record<string, unknown>[] = [
    { id: 'background', type: 'background', paint: { 'background-color': '#f1efe6' } },
    {
      id: 'landcover_wood',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'wood'],
      paint: { 'fill-color': '#b9d8a8' },
    },
    {
      id: 'landcover_grass',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland']]],
      paint: { 'fill-color': '#dbe8c4' },
    },
    {
      id: 'landuse_park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      paint: { 'fill-color': '#a9d19a', 'fill-opacity': 0.4 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': '#9ebdff' },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      paint: {
        'line-color': '#7fa8e8',
        'line-width': ['interpolate', ['exponential', 1.2], ['zoom'], 10, 0.6, 16, 3],
      },
    },
    // เงาเขา: ช่วยให้เห็นลักษณะภูมิประเทศ สันเขา และหุบเขา
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'dem',
      paint: {
        'hillshade-exaggeration': 0.6,
        'hillshade-shadow-color': '#3b3b2f',
        'hillshade-highlight-color': '#ffffff',
        'hillshade-accent-color': '#5a5a45',
      },
    },
  ];

  if (CONTOUR_TILES_URL) {
    layers.push(
      {
        id: 'contour_minor',
        type: 'line',
        source: 'contours',
        'source-layer': 'contour',
        minzoom: 12,
        paint: { 'line-color': '#a0663a', 'line-width': 0.5, 'line-opacity': 0.6 },
      },
      {
        id: 'contour_major',
        type: 'line',
        source: 'contours',
        'source-layer': 'contour',
        minzoom: 10,
        filter: ['==', ['%', ['get', 'ele'], 100], 0],
        paint: { 'line-color': '#8a4f25', 'line-width': 1.1 },
      },
      {
        id: 'contour_label',
        type: 'symbol',
        source: 'contours',
        'source-layer': 'contour',
        minzoom: 13,
        filter: ['==', ['%', ['get', 'ele'], 100], 0],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['to-string', ['get', 'ele']],
          'text-font': FONT,
          'text-size': 10,
        },
        paint: { 'text-color': '#6b3c1a', 'text-halo-color': '#f1efe6', 'text-halo-width': 1 },
      },
    );
  }

  layers.push(
    // ทางเดินเท้า / ทางลูกรัง
    {
      id: 'road_path',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 12,
      filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]],
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': '#c4501b',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 18, 3],
        'line-dasharray': [2, 1.5],
      },
    },
    {
      id: 'road_minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary', 'secondary']]],
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 18, 8],
      },
    },
    {
      id: 'road_major',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['primary', 'trunk', 'motorway']]],
      paint: {
        'line-color': '#f4c26b',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 18, 12],
      },
    },
    {
      id: 'boundary',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['<=', ['get', 'admin_level'], 4],
      paint: { 'line-color': '#9b8fb0', 'line-width': 1, 'line-dasharray': [4, 2] },
    },
    // ยอดเขา พร้อมความสูง (เมตร)
    {
      id: 'peak',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'mountain_peak',
      minzoom: 10,
      layout: {
        'text-field': [
          'format',
          ['coalesce', ['get', 'name'], ''],
          {},
          '\n',
          {},
          ['concat', '▲ ', ['to-string', ['coalesce', ['get', 'ele'], '']], ' ม.'],
          { 'font-scale': 0.9 },
        ],
        'text-font': FONT_BOLD,
        'text-size': 12,
        'text-anchor': 'top',
      },
      paint: { 'text-color': '#5b3a1a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
    },
    {
      id: 'water_name',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11 },
      paint: { 'text-color': '#3a62b3', 'text-halo-color': '#ffffff', 'text-halo-width': 1 },
    },
    {
      id: 'place',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      layout: {
        'text-field': ['coalesce', ['get', 'name:th'], ['get', 'name']],
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 14, 16],
      },
      paint: { 'text-color': '#000000', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
    },
  );

  return {
    version: 8,
    name: 'Trail',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources,
    layers,
  };
}
