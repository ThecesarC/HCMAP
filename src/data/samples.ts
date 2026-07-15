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
  ALLOWED_SECCIONES.forEach((sec, k) => {
    // 6 rows x 5 columns grid layout centered at Morelia, Michoacán
    const row = Math.floor(k / 5);
    const col = k % 5;
    const centerLat = 19.7025 + (row - 2.5) * 0.015;
    const centerLng = -101.1923 + (col - 2) * 0.018;
    
    // Deterministic organic polygon generation (6-sided irregular shapes)
    const numPoints = 6;
    const points: string[] = [];
    const baseRadiusLat = 0.0075;
    const baseRadiusLng = 0.009;
    
    const seed = parseInt(sec) || k;
    const rand = (i: number) => {
      const x = Math.sin(seed + i * 3) * 10000;
      return x - Math.floor(x);
    };

    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      // Add organic jitter to make the boundaries look like real administrative borders
      const angleJitter = (rand(i * 2) - 0.5) * 0.18;
      const radiusJitter = 0.72 + rand(i * 2 + 1) * 0.55; // Multiplier from 0.72 to 1.27
      
      const ptLat = centerLat + Math.sin(angle + angleJitter) * baseRadiusLat * radiusJitter;
      const ptLng = centerLng + Math.cos(angle + angleJitter) * baseRadiusLng * radiusJitter;
      points.push(`${ptLng},${ptLat}`);
    }
    // Close the polygon by adding the first point again
    points.push(points[0]);
    const coordinatesStr = points.join(' ');
    
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
