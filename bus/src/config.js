// Road geometry and tuning constants. Units: metres, seconds, kilograms.

export const ROAD = {
  lane: 3.75, // lane width; carriageway = two lanes
  half: 3.75, // half carriageway width
  laneOffset: 1.875, // lane centre from the road centre line
  curbHeight: 0.15,
  cornerRadius: 9, // curb radius at junctions
  sidewalk: 6, // curb to building line
  walkway: 2.6, // pedestrian walking line (inset from curb)
  // Stop lines are set back behind the curb arcs (as on bus routes), so a bus turning right
  // can swing out without touching cars waiting in the other lane.
  stopLineGap: 6,
  bendRadius: 32, // curb radius where a street simply bends (corners of the ring road)
  bayDepth: 3,
  bayTaperIn: 12,
  bayTaperOut: 9,
};
// Distance from a junction centre to the stop line / lane ends.
ROAD.junctionTrim = ROAD.half + ROAD.cornerRadius + ROAD.stopLineGap; // 18.75
ROAD.bendTrim = ROAD.half + ROAD.bendRadius; // 35.75
ROAD.straightTrim = 1;
ROAD.crossingCentre = ROAD.half + 4; // pedestrian crossing centre line from the junction centre
ROAD.crossingWidth = 4;

export const WORLD = {
  margin: 700, // green land around the city
  groundY: 0.12,
};

export const QUALITY = {
  low: { pixelRatio: 1.25, shadows: 0, bloom: false, trees: 0.5, pedestrians: 26, traffic: 14, mirrors: false, drawDistance: 700 },
  medium: { pixelRatio: 1.6, shadows: 1024, bloom: false, trees: 0.8, pedestrians: 44, traffic: 22, mirrors: true, drawDistance: 1000 },
  high: { pixelRatio: 2, shadows: 2048, bloom: true, trees: 1, pedestrians: 64, traffic: 30, mirrors: true, drawDistance: 1400 },
};

export const PHYSICS_DT = 1 / 120;
