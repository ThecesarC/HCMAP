/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface KmlFeature {
  id: string;
  name: string;
  description: string;
  properties: Record<string, string>;
  geometryType: 'Polygon' | 'LineString' | 'Point' | 'Unknown';
  // A placemark can contain multiple polygons (MultiGeometry)
  // Each polygon is represented by an array of paths:
  // - paths[0] is the outer boundary (array of LatLngLiterals)
  // - paths[1..n] are the inner boundaries (holes)
  polygons: google.maps.LatLngLiteral[][][];
  lineStrings: google.maps.LatLngLiteral[][];
  points: google.maps.LatLngLiteral[];
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface KmlDocument {
  name: string;
  features: KmlFeature[];
  styles: Record<string, KmlStyle>;
}

export interface KmlStyle {
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface SampleKml {
  id: string;
  name: string;
  description: string;
  center: { lat: number; lng: number };
  zoom: number;
  content: string;
}

export interface DistrictKmlFile {
  id: string;
  name: string;
  brigade: string; // e.g. "Brigada 1", "Brigada 2", "Brigada 3", "Brigada 4", "Brigada 5", "General"
  enabled: boolean;
  kmlText: string;
  kmlDoc: KmlDocument;
  uploadedAt: string;
}

export interface District {
  id: string;
  name: string; // e.g. "Distrito 8", "Distrito 11"
  description?: string;
  enabled: boolean;
  color: string; // e.g. "#3b82f6" for District 8, "#10b981" for District 11
  kmlFiles: DistrictKmlFile[];
}

export interface DistrictFeature extends KmlFeature {
  districtId: string;
  districtName: string;
  districtColor: string;
  brigadeName: string;
  fileId: string;
  fileName: string;
}
