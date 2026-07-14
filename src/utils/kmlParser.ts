/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { KmlDocument, KmlFeature, KmlStyle } from '../types';

/**
 * Converts a KML color string (aabbggrr) to a standard hex color (#rrggbba) and returns the opacity.
 */
export function kmlColorToCss(kmlColor: string): { color: string; opacity: number } {
  const clean = kmlColor.trim();
  let a = 'ff';
  let b = '00';
  let g = '00';
  let r = '00';

  if (clean.length === 8) {
    a = clean.substring(0, 2);
    b = clean.substring(2, 4);
    g = clean.substring(4, 6);
    r = clean.substring(6, 8);
  } else if (clean.length === 6) {
    b = clean.substring(0, 2);
    g = clean.substring(2, 4);
    r = clean.substring(4, 6);
  } else {
    // If it's a short value or invalid, fallback to something nice
    return { color: '#3b82f6', opacity: 0.5 };
  }

  const redHex = r;
  const greenHex = g;
  const blueHex = b;
  const alphaVal = parseInt(a, 16) / 255;

  return {
    color: `#${redHex}${greenHex}${blueHex}`,
    opacity: isNaN(alphaVal) ? 0.5 : alphaVal,
  };
}

/**
 * Parses coordinate strings in KML (longitude,latitude,altitude or longitude,latitude)
 */
function parseCoordinates(coordString: string): google.maps.LatLngLiteral[] {
  const coords: google.maps.LatLngLiteral[] = [];
  // Split by whitespace (spaces, tabs, newlines)
  const points = coordString.trim().split(/\s+/);
  for (const p of points) {
    if (!p) continue;
    const parts = p.split(',');
    if (parts.length >= 2) {
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng)) {
        coords.push({ lat, lng });
      }
    }
  }
  return coords;
}

/**
 * Parses KML XML text into a KmlDocument representation.
 */
export function parseKml(kmlText: string): KmlDocument {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(kmlText, 'text/xml');

  // Parse Document or Folder Name
  let docName = 'Archivo KML';
  const nameEl = xmlDoc.getElementsByTagName('name')[0];
  if (nameEl && nameEl.parentNode === xmlDoc.documentElement || (nameEl && nameEl.parentNode?.nodeName === 'Document')) {
    docName = nameEl.textContent || 'Archivo KML';
  }

  // 1. Parse Styles
  const styles: Record<string, KmlStyle> = {};
  const styleElements = xmlDoc.getElementsByTagName('Style');
  for (let i = 0; i < styleElements.length; i++) {
    const styleEl = styleElements[i];
    const id = styleEl.getAttribute('id');
    if (!id) continue;

    const styleData: KmlStyle = {};

    // PolyStyle
    const polyStyle = styleEl.getElementsByTagName('PolyStyle')[0];
    if (polyStyle) {
      const colorEl = polyStyle.getElementsByTagName('color')[0];
      if (colorEl) {
        const { color, opacity } = kmlColorToCss(colorEl.textContent || '');
        styleData.fillColor = color;
        styleData.fillOpacity = opacity;
      }
    }

    // LineStyle
    const lineStyle = styleEl.getElementsByTagName('LineStyle')[0];
    if (lineStyle) {
      const colorEl = lineStyle.getElementsByTagName('color')[0];
      if (colorEl) {
        const { color } = kmlColorToCss(colorEl.textContent || '');
        styleData.strokeColor = color;
      }
      const widthEl = lineStyle.getElementsByTagName('width')[0];
      if (widthEl) {
        styleData.strokeWidth = parseFloat(widthEl.textContent || '2');
      }
    }

    styles[`#${id}`] = styleData;
  }

  // 2. Parse Placemarks
  const features: KmlFeature[] = [];
  const placemarks = xmlDoc.getElementsByTagName('Placemark');

  for (let i = 0; i < placemarks.length; i++) {
    const placemark = placemarks[i];
    const id = placemark.getAttribute('id') || `placemark-${i}`;
    const name = placemark.getElementsByTagName('name')[0]?.textContent?.trim() || `Área ${i + 1}`;
    const description = placemark.getElementsByTagName('description')[0]?.textContent?.trim() || '';
    const styleUrl = placemark.getElementsByTagName('styleUrl')[0]?.textContent?.trim() || '';

    // Extract properties (ExtendedData, Custom Data, SchemaData)
    const properties: Record<string, string> = {};

    // SimpleData elements
    const simpleDatas = placemark.getElementsByTagName('SimpleData');
    for (let s = 0; s < simpleDatas.length; s++) {
      const sData = simpleDatas[s];
      const propName = sData.getAttribute('name');
      if (propName) {
        properties[propName] = sData.textContent?.trim() || '';
      }
    }

    // Data elements
    const datas = placemark.getElementsByTagName('Data');
    for (let d = 0; d < datas.length; d++) {
      const dataEl = datas[d];
      const propName = dataEl.getAttribute('name');
      if (propName) {
        const valEl = dataEl.getElementsByTagName('value')[0];
        if (valEl) {
          properties[propName] = valEl.textContent?.trim() || '';
        } else {
          // Fallback: If no <value> element exists, get direct text content
          properties[propName] = dataEl.textContent?.trim() || '';
        }
      }
    }

    // Direct children of ExtendedData that are custom XML tags
    const extendedDatas = placemark.getElementsByTagName('ExtendedData');
    for (let ex = 0; ex < extendedDatas.length; ex++) {
      const extEl = extendedDatas[ex];
      const children = extEl.children;
      for (let c = 0; c < children.length; c++) {
        const child = children[c];
        const tagName = child.tagName;
        if (tagName && tagName !== 'Data' && tagName !== 'SchemaData' && tagName !== 'SimpleData') {
          properties[tagName] = child.textContent?.trim() || '';
        }
      }
    }

    // Parse Geometries inside this Placemark (supporting MultiGeometry naturally)
    const featurePolygons: google.maps.LatLngLiteral[][][] = [];
    const featureLineStrings: google.maps.LatLngLiteral[][] = [];
    const featurePoints: google.maps.LatLngLiteral[] = [];

    // Parse Polygons
    const polygons = placemark.getElementsByTagName('Polygon');
    for (let p = 0; p < polygons.length; p++) {
      const polyEl = polygons[p];
      const polygonPaths: google.maps.LatLngLiteral[][] = [];

      // Outer boundary
      const outerBoundary = polyEl.getElementsByTagName('outerBoundaryIs')[0];
      if (outerBoundary) {
        const coordsText = outerBoundary.getElementsByTagName('coordinates')[0]?.textContent || '';
        const outerPath = parseCoordinates(coordsText);
        if (outerPath.length > 0) {
          polygonPaths.push(outerPath);
        }
      }

      // Inner boundaries (holes)
      const innerBoundaries = polyEl.getElementsByTagName('innerBoundaryIs');
      for (let ib = 0; ib < innerBoundaries.length; ib++) {
        const coordsText = innerBoundaries[ib].getElementsByTagName('coordinates')[0]?.textContent || '';
        const innerPath = parseCoordinates(coordsText);
        if (innerPath.length > 0) {
          polygonPaths.push(innerPath);
        }
      }

      if (polygonPaths.length > 0) {
        featurePolygons.push(polygonPaths);
      }
    }

    // Parse LineStrings
    const lineStrings = placemark.getElementsByTagName('LineString');
    for (let l = 0; l < lineStrings.length; l++) {
      const lineEl = lineStrings[l];
      const coordsText = lineEl.getElementsByTagName('coordinates')[0]?.textContent || '';
      const path = parseCoordinates(coordsText);
      if (path.length > 0) {
        featureLineStrings.push(path);
      }
    }

    // Parse Points
    const points = placemark.getElementsByTagName('Point');
    for (let pt = 0; pt < points.length; pt++) {
      const pointEl = points[pt];
      const coordsText = pointEl.getElementsByTagName('coordinates')[0]?.textContent || '';
      const path = parseCoordinates(coordsText);
      if (path.length > 0) {
        featurePoints.push(path[0]);
      }
    }

    // Determine Geometry Type
    let geometryType: 'Polygon' | 'LineString' | 'Point' | 'Unknown' = 'Unknown';
    if (featurePolygons.length > 0) {
      geometryType = 'Polygon';
    } else if (featureLineStrings.length > 0) {
      geometryType = 'LineString';
    } else if (featurePoints.length > 0) {
      geometryType = 'Point';
    }

    // Lookup Style
    let fillColor = undefined;
    let fillOpacity = undefined;
    let strokeColor = undefined;
    let strokeWidth = undefined;

    if (styleUrl && styles[styleUrl]) {
      const style = styles[styleUrl];
      fillColor = style.fillColor;
      fillOpacity = style.fillOpacity;
      strokeColor = style.strokeColor;
      strokeWidth = style.strokeWidth;
    }

    // Fallback styles if not specified
    if (!fillColor && geometryType === 'Polygon') {
      fillColor = '#10b981'; // Nice emerald
      fillOpacity = 0.35;
    }
    if (!strokeColor) {
      strokeColor = geometryType === 'Polygon' ? '#047857' : (geometryType === 'LineString' ? '#3b82f6' : '#ef4444');
    }
    if (!strokeWidth) {
      strokeWidth = 2;
    }

    features.push({
      id,
      name,
      description,
      properties,
      geometryType,
      polygons: featurePolygons,
      lineStrings: featureLineStrings,
      points: featurePoints,
      fillColor,
      fillOpacity,
      strokeColor,
      strokeWidth,
    });
  }

  return {
    name: docName,
    features,
    styles,
  };
}
