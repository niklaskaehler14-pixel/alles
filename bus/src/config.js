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
  groundY: 0.12,
};

// The drivable town area (with the green belt around the ring and the river in the south).
// Everything beyond is landscape drawn by the backdrop.
export function worldExtent(b) {
  const riverZ0 = b.maxZ + ROAD.half + ROAD.sidewalk + 55;
  const riverZ1 = riverZ0 + 60;
  return { x0: b.minX - 150, x1: b.maxX + 150, z0: b.minZ - 260, z1: riverZ1 + 40, riverZ0, riverZ1 };
}

// backdrop: tree count, terrain texture size and grid spacing (m) of the landscape.
export const QUALITY = {
  low: { pixelRatio: 1.25, shadows: 0, trees: 0.5, pedestrians: 26, traffic: 14, mirrors: false, backdrop: { trees: 1800, tex: 1024, step: 40 } },
  medium: { pixelRatio: 1.6, shadows: 1024, trees: 0.8, pedestrians: 44, traffic: 22, mirrors: true, backdrop: { trees: 4500, tex: 2048, step: 30 } },
  high: { pixelRatio: 2, shadows: 2048, trees: 1, pedestrians: 64, traffic: 30, mirrors: true, backdrop: { trees: 8000, tex: 2048, step: 24 } },
};

export const PHYSICS_DT = 1 / 120;
