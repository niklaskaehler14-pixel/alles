// Bus types. Dimensions follow typical German city buses (e.g. a 12 m solo bus:
// 12.1 m long, 5.9 m wheelbase, ~23 m turning circle, 220 kW, 1200 Nm).
// Local frame: origin at the rear axle (for articulated buses: the middle axle), +z forward.

const DOOR_W = 1.25;

export const BUS_TYPES = {
  solo: {
    id: 'solo',
    name: 'Stadtbus 12 m',
    blurb: 'Der Klassiker: 12 m, Dieselmotor, 2 Türen, 90 Plätze.',
    price: 0,
    length: 12.1,
    width: 2.55,
    height: 3.12,
    wheelbase: 5.9,
    frontOverhang: 2.7,
    trackFront: 2.12,
    trackRear: 1.84,
    wheelRadius: 0.48,
    mass: 11700,
    cgFromRear: 2.2,
    power: 220000,
    torque: 1200,
    engine: 'diesel',
    steerMax: 0.75,
    capacity: 90,
    seats: 32,
    doors: [
      { z: 7.55, w: DOOR_W, front: true },
      { z: 2.55, w: DOOR_W },
    ],
    driveForceCap: 23500,
  },
  midi: {
    id: 'midi',
    name: 'Midibus 10,6 m',
    blurb: 'Kurz und wendig: kleiner Wendekreis, ideal für enge Altstadtgassen. 70 Plätze.',
    price: 3000,
    length: 10.6,
    width: 2.55,
    height: 3.1,
    wheelbase: 4.4,
    frontOverhang: 2.7,
    trackFront: 2.12,
    trackRear: 1.84,
    wheelRadius: 0.48,
    mass: 10300,
    cgFromRear: 1.7,
    power: 220000,
    torque: 1200,
    engine: 'diesel',
    steerMax: 0.86,
    capacity: 70,
    seats: 26,
    doors: [
      { z: 6.05, w: DOOR_W, front: true },
      { z: 1.35, w: DOOR_W },
    ],
    driveForceCap: 22000,
  },
  electric: {
    id: 'electric',
    name: 'E-Bus 12 m',
    blurb: 'Leise und kräftig: Elektroantrieb mit Rekuperation. Fahrgäste lieben die ruhige Fahrt.',
    price: 6500,
    length: 12.1,
    width: 2.55,
    height: 3.35,
    wheelbase: 5.9,
    frontOverhang: 2.7,
    trackFront: 2.12,
    trackRear: 1.84,
    wheelRadius: 0.48,
    mass: 13400,
    cgFromRear: 2.3,
    power: 250000,
    torque: 0,
    engine: 'electric',
    steerMax: 0.75,
    capacity: 88,
    seats: 30,
    doors: [
      { z: 7.55, w: DOOR_W, front: true },
      { z: 2.55, w: DOOR_W },
    ],
    driveForceCap: 27000,
    comfortBonus: 1.15,
  },
  articulated: {
    id: 'articulated',
    name: 'Gelenkbus 18 m',
    blurb: 'Das Flaggschiff: 18 m, 3 Türen, 145 Plätze. Knickgelenk – beim Abbiegen schwenkt das Heck mit.',
    price: 9500,
    length: 18.1,
    width: 2.55,
    height: 3.12,
    wheelbase: 5.9, // front axle -> middle axle
    frontOverhang: 2.7,
    trackFront: 2.12,
    trackRear: 1.84,
    wheelRadius: 0.48,
    mass: 11200, // front section
    trailerMass: 6300,
    cgFromRear: 2.4,
    power: 265000,
    torque: 1700,
    engine: 'diesel',
    steerMax: 0.75,
    capacity: 145,
    seats: 45,
    // Rear section: joint behind the middle axle, drive axle behind the joint.
    joint: 1.6,
    trailerAxle: 4.39,
    trailerOverhang: 3.52,
    doors: [
      { z: 7.55, w: DOOR_W, front: true },
      { z: 2.55, w: DOOR_W },
      { z: -2.1, w: DOOR_W, trailer: true }, // measured from the joint towards the rear
    ],
    driveForceCap: 33000,
  },
};

export const BUS_ORDER = ['solo', 'midi', 'electric', 'articulated'];

// Derived geometry helpers.
export function busGeometry(spec) {
  const front = spec.wheelbase + spec.frontOverhang; // front bumper (z from rear axle)
  if (spec.joint) {
    const rearOfFront = -spec.joint - 0.35; // front section ends a little behind the joint
    return {
      front,
      rear: rearOfFront,
      center: (front + rearOfFront) / 2,
      halfLength: (front - rearOfFront) / 2,
      halfWidth: spec.width / 2,
      trailerFront: 0.35, // measured forward from the joint
      trailerRear: -(spec.trailerAxle + spec.trailerOverhang),
    };
  }
  const rear = -(spec.length - front);
  return { front, rear, center: (front + rear) / 2, halfLength: spec.length / 2, halfWidth: spec.width / 2 };
}
