/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { District, DistrictKmlFile, KmlFeature, KmlDocument } from '../types';

/**
 * Escapes special XML characters to prevent malformed XML in KML documents.
 */
export function escapeXml(unsafe: string | null | undefined): string {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/**
 * Converts CSS Hex color (#RRGGBB) and opacity (0..1) to KML Color format (aabbggrr).
 */
export function hexToKmlColor(hex: string, opacity: number = 1.0): string {
  let clean = (hex || '#3b82f6').replace('#', '').trim();
  let r = '00';
  let g = '00';
  let b = '00';

  if (clean.length === 6) {
    r = clean.substring(0, 2);
    g = clean.substring(2, 4);
    b = clean.substring(4, 6);
  } else if (clean.length === 3) {
    r = clean[0] + clean[0];
    g = clean[1] + clean[1];
    b = clean[2] + clean[2];
  } else if (clean.length === 8) {
    // If RGBA hex is provided (#RRGGBBAA)
    r = clean.substring(0, 2);
    g = clean.substring(2, 4);
    b = clean.substring(4, 6);
    const alphaFromHex = parseInt(clean.substring(6, 8), 16) / 255;
    opacity = isNaN(alphaFromHex) ? opacity : alphaFromHex;
  }

  const alphaNum = Math.max(0, Math.min(255, Math.round(opacity * 255)));
  const a = alphaNum.toString(16).padStart(2, '0');

  // KML standard is aabbggrr
  return `${a}${b}${g}${r}`.toLowerCase();
}

/**
 * Palette of standard brigade colors and borders.
 */
export const BRIGADE_PALETTES = [
  { brigade: 1, name: 'Brigada 1', fill: '#dc2626', border: '#991b1b', fillOpacity: 0.5 }, // Rojo
  { brigade: 2, name: 'Brigada 2', fill: '#2563eb', border: '#1d4ed8', fillOpacity: 0.5 }, // Azul
  { brigade: 3, name: 'Brigada 3', fill: '#16a34a', border: '#15803d', fillOpacity: 0.5 }, // Verde
  { brigade: 4, name: 'Brigada 4', fill: '#8b4513', border: '#5c2e0b', fillOpacity: 0.5 }, // Marrón
  { brigade: 5, name: 'Brigada 5', fill: '#9333ea', border: '#6b21a8', fillOpacity: 0.5 }, // Púrpura
  { brigade: 6, name: 'Brigada 6', fill: '#0284c7', border: '#0369a1', fillOpacity: 0.5 }, // Sky
  { brigade: 7, name: 'Brigada 7', fill: '#ea580c', border: '#c2410c', fillOpacity: 0.5 }, // Naranja
  { brigade: 8, name: 'Brigada 8', fill: '#db2777', border: '#be185d', fillOpacity: 0.5 }, // Rosa
  { brigade: 9, name: 'Brigada 9', fill: '#0d9488', border: '#0f766e', fillOpacity: 0.5 }, // Teal
  { brigade: 10, name: 'Brigada 10', fill: '#7c3aed', border: '#6d28d9', fillOpacity: 0.5 }, // Violeta
];

/**
 * Palette of specific coordinator colors matching user configuration.
 */
export const COORDINATOR_PALETTES: Record<string, { fill: string; border: string }> = {
  'DAVID': { fill: '#808080', border: '#4b5563' },
  'MIGUEL ANGEL': { fill: '#00a8e8', border: '#0284c7' },
  'ELEAZAR': { fill: '#1e1b78', border: '#172554' },
  'ROSA ELIA': { fill: '#f97316', border: '#ea580c' },
  'LEONARDO': { fill: '#16a34a', border: '#15803d' },
  'CANDY': { fill: '#06b6d4', border: '#0e7490' },
  'MAULEON': { fill: '#ef4444', border: '#dc2626' },
  'ROBERTO': { fill: '#eab308', border: '#ca8a04' },
  'EVELIA': { fill: '#ec4899', border: '#be185d' },
  'ALFREDO': { fill: '#85754d', border: '#574c35' },
};

/**
 * Extracts a numeric brigade number or normalizes name.
 */
export function getBrigadeNumber(name: string): number {
  const match = (name || '').match(/\d+/);
  return match ? parseInt(match[0], 10) : 999;
}

/**
 * Formats an array of LatLngLiterals into a KML coordinate string.
 * Automatically closes linear rings if required.
 */
function formatCoordinates(points: google.maps.LatLngLiteral[], closeRing = false): string {
  if (!points || points.length === 0) return '';
  const pts = [...points];

  if (closeRing && pts.length >= 3) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first.lat !== last.lat || first.lng !== last.lng) {
      pts.push({ lat: first.lat, lng: first.lng });
    }
  }

  return pts.map(pt => `${pt.lng},${pt.lat},0`).join('\n                ');
}

/**
 * Serializes Placemark geometries (Polygon, MultiGeometry, LineString, Point) to KML.
 */
function serializeGeometry(feature: KmlFeature): string {
  // 1. Polygon or MultiGeometry
  if (feature.geometryType === 'Polygon' && feature.polygons && feature.polygons.length > 0) {
    const polyXmlList = feature.polygons.map(polyPaths => {
      const outer = polyPaths[0] || [];
      const outerCoords = formatCoordinates(outer, true);

      let innerXml = '';
      for (let i = 1; i < polyPaths.length; i++) {
        const innerCoords = formatCoordinates(polyPaths[i], true);
        if (innerCoords) {
          innerXml += `
            <innerBoundaryIs>
              <LinearRing>
                <coordinates>
                  ${innerCoords}
                </coordinates>
              </LinearRing>
            </innerBoundaryIs>`;
        }
      }

      return `          <Polygon>
            <tessellate>1</tessellate>
            <outerBoundaryIs>
              <LinearRing>
                <coordinates>
                  ${outerCoords}
                </coordinates>
              </LinearRing>
            </outerBoundaryIs>${innerXml}
          </Polygon>`;
    });

    if (polyXmlList.length === 1) {
      return polyXmlList[0];
    } else {
      return `          <MultiGeometry>\n${polyXmlList.join('\n')}\n          </MultiGeometry>`;
    }
  }

  // 2. LineString
  if (feature.geometryType === 'LineString' && feature.lineStrings && feature.lineStrings.length > 0) {
    const lineXmlList = feature.lineStrings.map(path => {
      const coords = formatCoordinates(path, false);
      return `          <LineString>
            <tessellate>1</tessellate>
            <coordinates>
              ${coords}
            </coordinates>
          </LineString>`;
    });

    if (lineXmlList.length === 1) {
      return lineXmlList[0];
    } else {
      return `          <MultiGeometry>\n${lineXmlList.join('\n')}\n          </MultiGeometry>`;
    }
  }

  // 3. Point
  if (feature.geometryType === 'Point' && feature.points && feature.points.length > 0) {
    const ptXmlList = feature.points.map(pt => `          <Point>
            <coordinates>${pt.lng},${pt.lat},0</coordinates>
          </Point>`);

    if (ptXmlList.length === 1) {
      return ptXmlList[0];
    } else {
      return `          <MultiGeometry>\n${ptXmlList.join('\n')}\n          </MultiGeometry>`;
    }
  }

  return '';
}

export interface KmlExportOptions {
  title?: string;
  description?: string;
  includeOnlyEnabled?: boolean;
  districtId?: string; // If specified, export only this district
}

/**
 * Generates a complete, structured, multi-layer KML XML document containing
 * all districts and their ordered brigade layers.
 */
export function generateCompositeKml(
  districts: District[],
  options: KmlExportOptions = {}
): string {
  const {
    title = 'Mapa Electoral - Distritos y Brigadas',
    description = 'Exportación completa del mapa electoral con capas ordenadas por distrito y brigada.',
    includeOnlyEnabled = false,
    districtId
  } = options;

  // Filter districts if specified
  let targetDistricts = districts;
  if (districtId) {
    targetDistricts = districts.filter(d => d.id === districtId);
  }
  if (includeOnlyEnabled) {
    targetDistricts = targetDistricts.filter(d => d.enabled);
  }

  // Collect unique brigade styles used across all layers
  const definedStyleIds = new Set<string>();
  let stylesXml = '';

  const registerStyle = (id: string, fillColor: string, strokeColor: string, fillOpacity = 0.5, strokeWidth = 2.5) => {
    if (definedStyleIds.has(id)) return;
    definedStyleIds.add(id);

    const kmlFill = hexToKmlColor(fillColor, fillOpacity);
    const kmlStroke = hexToKmlColor(strokeColor, 1.0);

    stylesXml += `    <Style id="${id}">
      <LineStyle>
        <color>${kmlStroke}</color>
        <width>${strokeWidth}</width>
      </LineStyle>
      <PolyStyle>
        <color>${kmlFill}</color>
        <fill>1</fill>
        <outline>1</outline>
      </PolyStyle>
      <BalloonStyle>
        <text><![CDATA[<h3>$[name]</h3><p>$[description]</p>]]></text>
      </BalloonStyle>
    </Style>\n`;
  };

  // Register baseline styles for Brigadas 1 to 10
  BRIGADE_PALETTES.forEach(p => {
    registerStyle(`style-brigada-${p.brigade}`, p.fill, p.border, p.fillOpacity, 2.5);
  });

  // Also register a default style
  registerStyle('style-default', '#3b82f6', '#1d4ed8', 0.45, 2.0);

  // Build folders XML
  let foldersXml = '';

  targetDistricts.forEach((district, dIndex) => {
    const districtStyleId = `style-distrito-${district.id}`;
    registerStyle(districtStyleId, district.color || '#3b82f6', district.color || '#1e3a8a', 0.4, 2.5);

    // Sort KML files/brigades inside this district in clean natural order
    const files = [...district.kmlFiles];
    if (includeOnlyEnabled) {
      // filter only enabled files
    }

    files.sort((a, b) => {
      const numA = getBrigadeNumber(a.brigade || a.name);
      const numB = getBrigadeNumber(b.brigade || b.name);
      if (numA !== numB) return numA - numB;
      return (a.brigade || a.name).localeCompare(b.brigade || b.name);
    });

    let filesXml = '';

    files.forEach(file => {
      const bNum = getBrigadeNumber(file.brigade || file.name);
      let fileStyleId = districtStyleId;

      const upperBrigade = (file.brigade || file.name || '').toUpperCase().trim();
      if (COORDINATOR_PALETTES[upperBrigade]) {
        const cPal = COORDINATOR_PALETTES[upperBrigade];
        fileStyleId = `style-coord-${upperBrigade.replace(/[^A-Z0-9]/g, '_')}`;
        registerStyle(fileStyleId, cPal.fill, cPal.border, 0.5, 2.5);
      } else if (bNum <= 10 && bNum >= 1) {
        fileStyleId = `style-brigada-${bNum}`;
      }

      // Extract features
      const features = (file.kmlDoc?.features || []);

      // Sort features by section number or name so Placemarks are ordered cleanly
      const sortedFeatures = [...features].sort((a, b) => {
        const secA = parseInt(a.properties?.['SECCION'] || a.properties?.['seccion'] || a.name.match(/\d+/)?.[0] || '0', 10);
        const secB = parseInt(b.properties?.['SECCION'] || b.properties?.['seccion'] || b.name.match(/\d+/)?.[0] || '0', 10);
        if (secA && secB && secA !== secB) return secA - secB;
        return (a.name || '').localeCompare(b.name || '');
      });

      let placemarksXml = '';

      sortedFeatures.forEach((feat, fIndex) => {
        const geom = serializeGeometry(feat);
        if (!geom) return;

        // Determine feature styleUrl
        let featStyleUrl = `#${fileStyleId}`;
        if (feat.fillColor && feat.strokeColor) {
          const customStyleId = `style-feat-${feat.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
          registerStyle(customStyleId, feat.fillColor, feat.strokeColor, feat.fillOpacity || 0.5, feat.strokeWidth || 2.0);
          featStyleUrl = `#${customStyleId}`;
        }

        // ExtendedData
        const propertiesEntries = Object.entries(feat.properties || {});
        // Ensure SECCION, BRIGADA, DISTRITO are explicitly present in ExtendedData
        const propMap = new Map<string, string>();
        propertiesEntries.forEach(([k, v]) => propMap.set(k, String(v)));

        if (!propMap.has('BRIGADA') && file.brigade) {
          propMap.set('BRIGADA', file.brigade);
        }
        if (!propMap.has('DISTRITO') && district.name) {
          propMap.set('DISTRITO', district.name);
        }

        let extendedDataXml = '';
        if (propMap.size > 0) {
          const dataTags = Array.from(propMap.entries()).map(([k, v]) => 
            `          <Data name="${escapeXml(k)}">\n            <value>${escapeXml(v)}</value>\n          </Data>`
          ).join('\n');
          extendedDataXml = `\n        <ExtendedData>\n${dataTags}\n        </ExtendedData>`;
        }

        const placemarkName = feat.name || `Sección ${fIndex + 1}`;
        const descContent = feat.description 
          ? `\n        <description><![CDATA[${feat.description}]]></description>`
          : `\n        <description><![CDATA[<b>${escapeXml(district.name)}</b> - ${escapeXml(file.brigade || file.name)}<br/>Sección: ${escapeXml(placemarkName)}]]></description>`;

        placemarksXml += `      <Placemark id="${escapeXml(feat.id || `pm-${dIndex}-${fIndex}`)}">
        <name>${escapeXml(placemarkName)}</name>${descContent}
        <styleUrl>${featStyleUrl}</styleUrl>${extendedDataXml}
${geom}
      </Placemark>\n`;
      });

      const brigadeLabel = file.brigade ? `${file.brigade} (${file.name})` : file.name;
      const fileVisibility = file.enabled ? '1' : '0';

      filesXml += `    <Folder id="folder-layer-${escapeXml(file.id)}">
      <name>${escapeXml(brigadeLabel)}</name>
      <visibility>${fileVisibility}</visibility>
      <open>1</open>
      <description>${escapeXml(file.brigade || 'Capa')} perteneciente a ${escapeXml(district.name)} - ${sortedFeatures.length} secciones</description>
${placemarksXml}    </Folder>\n`;
    });

    const distVisibility = district.enabled ? '1' : '0';

    foldersXml += `  <Folder id="folder-distrito-${escapeXml(district.id)}">
    <name>${escapeXml(district.name)}</name>
    <visibility>${distVisibility}</visibility>
    <open>1</open>
    <description>Polígonos y capas correspondientes a ${escapeXml(district.name)} (${files.length} capas)</description>
${filesXml}  </Folder>\n`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>${escapeXml(title)}</name>
    <open>1</open>
    <description>${escapeXml(description)}</description>
${stylesXml}
${foldersXml}  </Document>
</kml>`;
}

/**
 * Triggers a browser download of the generated KML file.
 */
export function downloadKmlFile(kmlContent: string, filename = 'mapa_electoral_completo.kml'): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('Error downloading KML file:', err);
    return false;
  }
}
