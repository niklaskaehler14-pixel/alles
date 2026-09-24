// World layout and tuning constants. Units: metres, seconds, kilograms.

export const SEED = 20260924;

export const WORLD = {
  size: 4000,
  half: 2000,
  segments: 512, // terrain grid resolution (7.8 m cells)
  waterLevel: 0,
};

export const ROAD = {
  width: 13, // asphalt incl. edge lines
  shoulder: 1.6, // gravel strip on each side
  spacing: 2, // distance between track samples
};
ROAD.half = ROAD.width / 2;
ROAD.halfTotal = ROAD.half + ROAD.shoulder;

export const CITY = { x: -700, z: -600, radius: 390, grid: 110, street: 18, height: 0 };

export const LAKE = { x: 560, z: 690, radius: 300, depth: -24 };

// Closed circuit through city, northern hills, lakeside and forest.
export const TRACK_POINTS = [
  [-1050, -600],
  [-900, -600],
  [-700, -600],
  [-500, -600],
  [-350, -600],
  [-170, -570],
  [30, -680],
  [220, -900],
  [520, -1010],
  [820, -930],
  [990, -700],
  [900, -450],
  [1060, -190],
  [1250, 120],
  [1180, 440],
  [1080, 760],
  [930, 1090],
  [640, 1210],
  [330, 1160],
  [90, 960],
  [-120, 720],
  [-420, 660],
  [-720, 820],
  [-1060, 720],
  [-1300, 420],
  [-1360, 60],
  [-1270, -260],
  [-1170, -470],
];

// The start/finish line sits on the city boulevard.
export const START_POINT = [-820, -600];

export const QUALITY = {
  low: { pixelRatio: 1, shadows: 0, post: false, trees: 0.35, bloom: false, speedBlur: false, drawDistance: 1400 },
  medium: { pixelRatio: 1.5, shadows: 1024, post: true, trees: 0.65, bloom: true, speedBlur: false, drawDistance: 2200 },
  high: { pixelRatio: 2, shadows: 2048, post: true, trees: 1, bloom: true, speedBlur: true, drawDistance: 3200 },
};
