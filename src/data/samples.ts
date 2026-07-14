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

export const SAMPLES: SampleKml[] = [
  {
    id: 'mexico_default',
    name: 'Sección de Prueba (México) 🇲🇽',
    description: 'Polígono de prueba ubicado en México, configurado como base inicial de la aplicación.',
    center: { lat: 19.7025, lng: -101.1923 },
    zoom: 13,
    content: `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Secciones de Prueba México</name>
    <Placemark>
      <name>Sección de Prueba 1234</name>
      <description>Área de demostración inicial. El Administrador puede subir el archivo KML definitivo y guardarlo para todos los usuarios.</description>
      <ExtendedData>
        <Data name="Seccion">1234</Data>
        <Data name="Municipio">Morelia</Data>
        <Data name="Estado">Michoacán</Data>
        <Data name="País">México</Data>
      </ExtendedData>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              -101.2100,19.7150 -101.1750,19.7150 -101.1750,19.6900 -101.2100,19.6900 -101.2100,19.7150
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`
  }
];
