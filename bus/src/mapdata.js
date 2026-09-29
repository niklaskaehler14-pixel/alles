// Hand-authored city layout of Nordkamm: street grid, junction control, zones, stops and lines.
// Grid nodes are addressed as [i, j]: XS[i] is a north–south street, ZS[j] an east–west street.
// North is −z, east is +x. Traffic drives on the right.

export const XS = [-640, -470, -300, -140, 20, 180, 350, 520];
export const ZS = [-420, -260, -110, 40, 190, 340];

export const X_NAMES = ['Westring', 'Lindenallee', 'Goethestraße', 'Marktstraße', 'Kirchgasse', 'Parkstraße', 'Uhlandstraße', 'Ostring'];
export const Z_NAMES = ['Bahnhofstraße', 'Schillerstraße', 'Hauptstraße', 'Rathausstraße', 'Mühlenweg', 'Südring'];

// Street importance: 3 = main road (priority), 1 = collector, 0 = side street.
export const X_RANK = [3, 0, 0, 0, 0, 0, 0, 3];
export const Z_RANK = [3, 1, 3, 1, 1, 3];

// Missing street segments: 'h i,j' joins [i,j]–[i+1,j]; 'v i,j' joins [i,j]–[i,j+1].
export const MISSING = ['v 6,3', 'v 4,0', 'h 0,4', 'v 2,4'];

export const SIGNALS = ['3,0', '0,2', '1,2', '3,2', '5,2', '7,2', '3,5'];
// Right-before-left junctions inside the Tempo-30 zone.
export const RBL = ['1,1', '2,1', '1,3', '2,3'];
// Minor approaches with a stop sign instead of "Vorfahrt gewähren".
export const STOP_SIGNS = ['4,2', '2,2', '6,2'];

// Zebra crossings (Fußgängerüberweg) mid-block: axis, grid line, coordinate along the street.
export const ZEBRAS = [
  { axis: 'h', line: 3, at: -385 }, // Schulzentrum
  { axis: 'h', line: 1, at: -60 }, // St. Marien
  { axis: 'v', line: 5, at: 115 }, // Stadtpark
];

// What stands on each block (cell [i,j] spans XS[i]..XS[i+1], ZS[j]..ZS[j+1]).
export const CELL_USE = {
  '0,0': 'apartments',
  '1,0': 'offices',
  '2,0': 'civic',
  '3,0': 'station',
  '4,0': 'station',
  '5,0': 'university',
  '6,0': 'depot',
  '0,1': 'residential',
  '1,1': 'residential',
  '2,1': 'oldtown',
  '3,1': 'church',
  '4,1': 'theater',
  '5,1': 'university',
  '6,1': 'offices',
  '0,2': 'residential',
  '1,2': 'residential',
  '2,2': 'oldtown',
  '3,2': 'market',
  '4,2': 'mall',
  '5,2': 'shops',
  '6,2': 'residential',
  '0,3': 'industrial',
  '0,4': 'industrial',
  '1,3': 'school',
  '2,3': 'residential',
  '3,3': 'shops',
  '4,3': 'residential',
  '5,3': 'park',
  '6,3': 'park',
  '1,4': 'sports',
  '2,4': 'sports',
  '3,4': 'residential',
  '4,4': 'residential',
  '5,4': 'seniors',
  '6,4': 'hospital',
};

// Bus stops. axis 'h': on east–west street ZS[line], `front` is the x where the bus front should stop.
// axis 'v': on north–south street XS[line], `front` is a z. dir = direction of travel (N/E/S/W).
export const STOPS = [
  { id: 'hbf-w', name: 'Hauptbahnhof', axis: 'h', line: 0, dir: 'W', front: -40, type: 'bay', demand: 1.6 },
  { id: 'hbf-e', name: 'Hauptbahnhof', axis: 'h', line: 0, dir: 'E', front: -10, type: 'kerb', demand: 1.6 },
  { id: 'marien-s', name: 'St. Marien', axis: 'v', line: 3, dir: 'S', front: -150, type: 'kerb', demand: 0.8 },
  { id: 'marien-n', name: 'St. Marien', axis: 'v', line: 3, dir: 'N', front: -200, type: 'kerb', demand: 0.8 },
  { id: 'markt-e', name: 'Marktplatz', axis: 'h', line: 2, dir: 'E', front: -30, type: 'bay', demand: 1.4 },
  { id: 'markt-w', name: 'Marktplatz', axis: 'h', line: 2, dir: 'W', front: -90, type: 'kerb', demand: 1.4 },
  { id: 'galerie-e', name: 'Stadtgalerie', axis: 'h', line: 2, dir: 'E', front: 125, type: 'kerb', demand: 1.2 },
  { id: 'galerie-w', name: 'Stadtgalerie', axis: 'h', line: 2, dir: 'W', front: 60, type: 'kerb', demand: 1.2 },
  { id: 'park-e', name: 'Stadtpark', axis: 'h', line: 3, dir: 'E', front: 300, type: 'bay', demand: 0.9 },
  { id: 'park-w', name: 'Stadtpark', axis: 'h', line: 3, dir: 'W', front: 225, type: 'kerb', demand: 0.9 },
  { id: 'klinikum-s', name: 'Klinikum', axis: 'v', line: 7, dir: 'S', front: 300, type: 'bay', demand: 1.3 },
  { id: 'klinikum-n', name: 'Klinikum', axis: 'v', line: 7, dir: 'N', front: 245, type: 'kerb', demand: 1.3 },
  { id: 'buerger-w', name: 'Bürgerhaus', axis: 'h', line: 0, dir: 'W', front: -230, type: 'kerb', demand: 0.7 },
  { id: 'buerger-e', name: 'Bürgerhaus', axis: 'h', line: 0, dir: 'E', front: -360, type: 'kerb', demand: 0.7 },
  { id: 'westend-s', name: 'Westend', axis: 'v', line: 1, dir: 'S', front: -300, type: 'kerb', demand: 0.9 },
  { id: 'westend-n', name: 'Westend', axis: 'v', line: 1, dir: 'N', front: -330, type: 'kerb', demand: 0.9 },
  { id: 'linden-s', name: 'Lindenallee', axis: 'v', line: 1, dir: 'S', front: 10, type: 'kerb', demand: 0.7 },
  { id: 'linden-n', name: 'Lindenallee', axis: 'v', line: 1, dir: 'N', front: -20, type: 'kerb', demand: 0.7 },
  { id: 'schule-e', name: 'Schulzentrum', axis: 'h', line: 3, dir: 'E', front: -340, type: 'bay', demand: 1.3 },
  { id: 'schule-w', name: 'Schulzentrum', axis: 'h', line: 3, dir: 'W', front: -420, type: 'kerb', demand: 1.3 },
  { id: 'sport-e', name: 'Sportpark', axis: 'h', line: 4, dir: 'E', front: -170, type: 'kerb', demand: 0.8 },
  { id: 'sport-w', name: 'Sportpark', axis: 'h', line: 4, dir: 'W', front: -250, type: 'kerb', demand: 0.8 },
  { id: 'hochschule-e', name: 'Hochschule', axis: 'h', line: 0, dir: 'E', front: 280, type: 'kerb', demand: 1.1 },
  { id: 'depot-s', name: 'Betriebshof', axis: 'v', line: 7, dir: 'S', front: -330, type: 'kerb', demand: 0.5 },
  { id: 'ostring-s', name: 'Ostring', axis: 'v', line: 7, dir: 'S', front: -5, type: 'kerb', demand: 0.7 },
  { id: 'senioren-w', name: 'Seniorenstift', axis: 'h', line: 5, dir: 'W', front: 300, type: 'kerb', demand: 0.8 },
  { id: 'suedstadt-w', name: 'Südstadt', axis: 'h', line: 5, dir: 'W', front: -40, type: 'bay', demand: 1 },
  { id: 'sportsued-w', name: 'Sportpark Süd', axis: 'h', line: 5, dir: 'W', front: -400, type: 'kerb', demand: 0.6 },
  { id: 'gewerbe-n', name: 'Gewerbegebiet', axis: 'v', line: 0, dir: 'N', front: 120, type: 'kerb', demand: 0.7 },
  { id: 'westring-n', name: 'Westring', axis: 'v', line: 0, dir: 'N', front: -180, type: 'kerb', demand: 0.7 },
];

// Bus lines. `nodes` lists the junctions the bus passes after leaving the first stop.
export const LINES = [
  {
    id: '1',
    color: '#d7263d',
    title: 'Hauptbahnhof ⇄ Klinikum',
    blurb: 'Kurze Innenstadtlinie: Altstadt, Marktplatz, Stadtpark. Drei Ampeln, Rechtsabbiegen an der Parkstraße.',
    unlock: 0,
    trips: [
      {
        id: '1a',
        headsign: 'Klinikum',
        stops: ['hbf-w', 'marien-s', 'markt-e', 'galerie-e', 'park-e', 'klinikum-s'],
        nodes: ['3,0', '3,1', '3,2', '4,2', '5,2', '5,3', '6,3', '7,3', '7,4'],
      },
      {
        id: '1b',
        headsign: 'Hauptbahnhof',
        stops: ['klinikum-n', 'park-w', 'galerie-w', 'markt-w', 'marien-n', 'hbf-e'],
        nodes: ['7,4', '7,3', '6,3', '5,3', '5,2', '4,2', '3,2', '3,1', '3,0'],
      },
    ],
  },
  {
    id: '2',
    color: '#1b8fe0',
    title: 'Hauptbahnhof ⇄ Sportpark',
    blurb: 'Durchs Wohngebiet: Tempo-30-Zone, rechts vor links, Zebrastreifen am Schulzentrum.',
    unlock: 1,
    trips: [
      {
        id: '2a',
        headsign: 'Sportpark',
        stops: ['hbf-w', 'buerger-w', 'westend-s', 'linden-s', 'schule-e', 'sport-e'],
        nodes: ['3,0', '2,0', '1,0', '1,1', '1,2', '1,3', '2,3', '2,4'],
      },
      {
        id: '2b',
        headsign: 'Hauptbahnhof',
        stops: ['sport-w', 'schule-w', 'linden-n', 'westend-n', 'buerger-e', 'hbf-e'],
        nodes: ['2,4', '2,3', '1,3', '1,2', '1,1', '1,0', '2,0', '3,0'],
      },
    ],
  },
  {
    id: '3',
    color: '#2e9e5b',
    title: 'Ringlinie',
    blurb: 'Einmal rund um die Stadt: lange Strecke, enge Kurven an den Ecken, Tempo auf dem Ring.',
    unlock: 3,
    trips: [
      {
        id: '3',
        headsign: 'Ring ↻ Hauptbahnhof',
        stops: ['hbf-e', 'hochschule-e', 'depot-s', 'ostring-s', 'klinikum-s', 'senioren-w', 'suedstadt-w', 'sportsued-w', 'gewerbe-n', 'westring-n', 'hbf-e'],
        nodes: ['4,0', '5,0', '6,0', '7,0', '7,1', '7,2', '7,3', '7,4', '7,5', '6,5', '5,5', '4,5', '3,5', '2,5', '1,5', '0,5', '0,4', '0,3', '0,2', '0,1', '0,0', '1,0', '2,0', '3,0'],
      },
    ],
  },
];
