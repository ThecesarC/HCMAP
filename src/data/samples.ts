/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SampleKml {
  id: string;
  name: string;
  description: string;
  center: { lat: number; lng: number };
  zoom: number;
  content: string;
}

const ALLOWED_SECCIONES = [
  "2729", "2802", "2804", "2805", "1145", "1148", "1149", "1151", "1152", "1153",
  "1161", "2809", "2810", "2811", "2814", "2815", "2776", "1008", "1052", "1060",
  "1061", "1141", "1142", "1047", "1022", "1211", "1019", "1210", "2721", "2748"
];

const generate30SectionsKml = (): string => {
  let placemarks = '';

  // Helper to get perturbed node coordinates
  const getGridNode = (r: number, c: number): { lat: number; lng: number } => {
    // Center at Morelia (approx. row=2.5, col=2)
    const baseLat = 19.7025 + (r - 2.5) * 0.015;
    const baseLng = -101.1923 + (c - 2) * 0.018;

    const seed = r * 100 + c;
    const rand = (i: number) => {
      const x = Math.sin(seed + i * 7.1) * 12345.67;
      return x - Math.floor(x);
    };

    // Up to 35% jitter to make boundaries highly organic but prevent self-intersections
    const jitterLat = (rand(1) - 0.5) * 0.015 * 0.35;
    const jitterLng = (rand(2) - 0.5) * 0.018 * 0.35;

    return {
      lat: baseLat + jitterLat,
      lng: baseLng + jitterLng,
    };
  };

  // Helper to get organic edge points
  const getEdgePoints = (
    r1: number, c1: number,
    r2: number, c2: number
  ): { lat: number; lng: number }[] => {
    const pA = getGridNode(r1, c1);
    const pB = getGridNode(r2, c2);

    const id1 = r1 * 100 + c1;
    const id2 = r2 * 100 + c2;
    const minId = Math.min(id1, id2);
    const maxId = Math.max(id1, id2);
    const seed = minId * 10000 + maxId;

    const rand = (i: number) => {
      const x = Math.sin(seed + i * 9.3) * 54321.12;
      return x - Math.floor(x);
    };

    const dLat = pB.lat - pA.lat;
    const dLng = pB.lng - pA.lng;

    // Perpendicular vector for organic displacement
    const perpLat = -dLng * 0.16;
    const perpLng = dLat * 0.16;

    const jitter1 = (rand(1) - 0.5) * 1.25;
    const jitter2 = (rand(2) - 0.5) * 1.25;

    const pt1 = {
      lat: pA.lat + dLat * 0.33 + perpLat * jitter1,
      lng: pA.lng + dLng * 0.33 + perpLng * jitter1,
    };

    const pt2 = {
      lat: pA.lat + dLat * 0.67 + perpLat * jitter2,
      lng: pA.lng + dLng * 0.67 + perpLng * jitter2,
    };

    if (id1 < id2) {
      return [pt1, pt2];
    } else {
      return [pt2, pt1];
    }
  };

  ALLOWED_SECCIONES.forEach((sec, k) => {
    // 6 rows x 5 columns grid layout
    const row = Math.floor(k / 5);
    const col = k % 5;
    
    // Construct the polygon coordinates by traversing the four edges clockwise
    const points: { lat: number; lng: number }[] = [];
    
    // Start at Bottom-Left Node
    points.push(getGridNode(row, col));
    
    // Bottom Edge: Bottom-Left to Bottom-Right
    points.push(...getEdgePoints(row, col, row, col + 1));
    
    // Bottom-Right Node
    points.push(getGridNode(row, col + 1));
    
    // Right Edge: Bottom-Right to Top-Right
    points.push(...getEdgePoints(row, col + 1, row + 1, col + 1));
    
    // Top-Right Node
    points.push(getGridNode(row + 1, col + 1));
    
    // Top Edge: Top-Right to Top-Left
    points.push(...getEdgePoints(row + 1, col + 1, row + 1, col));
    
    // Top-Left Node
    points.push(getGridNode(row + 1, col));
    
    // Left Edge: Top-Left to Bottom-Left
    points.push(...getEdgePoints(row + 1, col, row, col));
    
    // Close the polygon (adding the starting point)
    points.push(points[0]);
    
    const coordinatesStr = points.map(p => `${p.lng},${p.lat}`).join(' ');
    
    placemarks += `    <Placemark id="placemark-${sec}">
      <name>Sección ${sec}</name>
      <description>Sección electoral número ${sec}. Cobertura predeterminada en Morelia, Michoacán.</description>
      <ExtendedData>
        <Data name="Seccion">${sec}</Data>
        <Data name="Municipio">Morelia</Data>
        <Data name="Estado">Michoacán</Data>
        <Data name="País">México</Data>
      </ExtendedData>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              ${coordinatesStr}
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>\n`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ORGANIC_INTERLOCKING_GRID_V2 -->
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Secciones Electorales</name>
${placemarks}  </Document>
</kml>`;
};

export const SAMPLES: SampleKml[] = [
  {
    id: 'mexico_default',
    name: 'Secciones Predeterminadas 🇲🇽',
    description: 'Capas de las 30 secciones electorales por defecto en la zona de Michoacán.',
    center: { lat: 19.7025, lng: -101.1923 },
    zoom: 12,
    content: generate30SectionsKml()
  }
];
