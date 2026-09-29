// Fare table and ticket requests (who wants what, what they pay with).

export const FARES = [
  { id: 'single', name: 'Einzelfahrt', price: 3.2 },
  { id: 'short', name: 'Kurzstrecke', price: 2.1 },
  { id: 'child', name: 'Kind (6–14)', price: 1.6 },
  { id: 'day', name: 'Tageskarte', price: 7.9 },
  { id: 'four', name: '4-Fahrten-Karte', price: 11.8 },
];

export const COINS = [5, 2, 1, 0.5, 0.2, 0.1];

// Passes shown when boarding (no sale needed).
export const PASSES = ['Deutschlandticket', 'Monatskarte', 'Schülerticket', 'Seniorenkarte', 'Jobticket'];

const PHRASES = {
  single: ['Einmal Einzelfahrt, bitte.', 'Eine Einzelfahrt, bitte.', 'Einmal in die Stadt, bitte.'],
  short: ['Kurzstrecke, bitte – nur zwei Stationen.', 'Einmal Kurzstrecke.'],
  child: ['Ein Kinderticket, bitte.', 'Einmal Kind, bitte.'],
  day: ['Eine Tageskarte, bitte.', 'Tageskarte bitte, ich fahre heute noch öfter.'],
  four: ['Eine 4-Fahrten-Karte, bitte.', 'Einmal die Vierer-Karte.'],
};

const round = (v) => Math.round(v * 100) / 100;

// What will the passenger pay with?
function payment(price, rng) {
  const notes = [5, 10, 20];
  if (rng() < 0.28) return round(price); // exact money
  if (price <= 2.5 && rng() < 0.5) return rng() < 0.5 ? 2 + (price > 2 ? 1 : 0) : 5;
  for (const n of notes) if (n >= price && rng() < 0.7) return n;
  return 20;
}

export function makeRequest(rng, { kid = false, stopsToGo = 3 } = {}) {
  let fare;
  if (kid) fare = 'child';
  else if (stopsToGo <= 2 && rng() < 0.55) fare = 'short';
  else {
    const r = rng();
    fare = r < 0.72 ? 'single' : r < 0.9 ? 'day' : 'four';
  }
  const f = FARES.find((x) => x.id === fare);
  const list = PHRASES[fare];
  const paid = payment(f.price, rng);
  return { fare, price: f.price, paid, change: round(paid - f.price), phrase: list[Math.floor(rng() * list.length)] };
}

export const euroText = (v) => `${v.toFixed(2).replace('.', ',')} €`;
export { round as roundCents };
