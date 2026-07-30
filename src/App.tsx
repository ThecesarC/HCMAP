/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  MapContainer, 
  TileLayer, 
  Polygon, 
  Polyline, 
  CircleMarker, 
  useMap,
  Tooltip,
  ZoomControl
} from 'react-leaflet';
import L from 'leaflet';
import { 
  Upload, 
  Map as MapIcon, 
  Search, 
  Info, 
  Eye, 
  Compass, 
  Trash2, 
  Grid, 
  Database,
  Sparkles,
  FileText,
  User,
  LogOut,
  ChevronDown,
  Shield,
  ArrowLeft,
  MapPin,
  ChevronRight,
  Layers,
  Plus,
  Folder,
  Tag,
  EyeOff,
  X,
  Check,
  Filter,
  Save
} from 'lucide-react';
import { parseKml } from './utils/kmlParser';
import { KmlDocument, KmlFeature, District, DistrictKmlFile, DistrictFeature } from './types';
import { SAMPLES } from './data/samples';
import { getKmlFromFirestore, saveKmlToFirestore } from './lib/firebase';
import currentKmlText from './data/current.kml?raw';
import brigada1KmlText from './data/brigada1.kml?raw';
import brigada2KmlText from './data/brigada2.kml?raw';

// Redefine Leaflet Default Icon behaviors to prevent path resolution bugs in dev servers
// SafePolygon component to prevent react-leaflet Tooltip DOM removeChild unmount errors
interface SafePolygonProps {
  positions: L.LatLngTuple[][];
  pathOptions: L.PathOptions;
  eventHandlers?: any;
  sectionVal?: string | null;
}

const SafePolygon = React.memo(function SafePolygon({
  positions,
  pathOptions,
  eventHandlers,
  sectionVal
}: SafePolygonProps) {
  const polygonRef = useRef<L.Polygon>(null);

  useEffect(() => {
    const poly = polygonRef.current;
    if (!poly) return;

    if (sectionVal) {
      poly.bindTooltip(sectionVal, {
        permanent: true,
        direction: 'center',
        className: 'leaflet-tooltip-own'
      });
    } else {
      poly.unbindTooltip();
    }

    return () => {
      try {
        poly.unbindTooltip();
      } catch (e) {
        // Safe guard against react-leaflet DOM removeChild errors
      }
    };
  }, [sectionVal]);

  return (
    <Polygon
      ref={polygonRef}
      positions={positions}
      pathOptions={pathOptions}
      eventHandlers={eventHandlers}
    />
  );
});
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Helper functions for Leaflet LatLng Bounds calculation
const getFeatureBounds = (feat: KmlFeature): L.LatLngBounds | null => {
  const points: L.LatLngTuple[] = [];

  feat.polygons.forEach(poly => {
    poly.forEach(path => {
      path.forEach(coord => {
        points.push([coord.lat, coord.lng]);
      });
    });
  });

  feat.lineStrings.forEach(path => {
    path.forEach(coord => {
      points.push([coord.lat, coord.lng]);
    });
  });

  feat.points.forEach(coord => {
    points.push([coord.lat, coord.lng]);
  });

  if (points.length === 0) return null;
  return L.latLngBounds(points);
};

const getAllFeaturesBounds = (features: KmlFeature[]): L.LatLngBounds | null => {
  const points: L.LatLngTuple[] = [];
  features.forEach(feat => {
    feat.polygons.forEach(poly => {
      poly.forEach(path => {
        path.forEach(coord => {
          points.push([coord.lat, coord.lng]);
        });
      });
    });
    feat.lineStrings.forEach(path => {
      path.forEach(coord => {
        points.push([coord.lat, coord.lng]);
      });
    });
    feat.points.forEach(coord => {
      points.push([coord.lat, coord.lng]);
    });
  });

  if (points.length === 0) return null;
  return L.latLngBounds(points);
};

// Math Helpers for local geodetic calculations (Haversine & Shoelace approximation)
function haversineDistance(pt1: { lat: number; lng: number }, pt2: { lat: number; lng: number }): number {
  const R = 6371000; // Earth's mean radius in meters
  const dLat = ((pt2.lat - pt1.lat) * Math.PI) / 180;
  const dLng = ((pt2.lng - pt1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((pt1.lat * Math.PI) / 180) *
      Math.cos((pt2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function computePolygonArea(polygons: { lat: number; lng: number }[][][]): number {
  if (polygons.length === 0) return 0;
  
  let totalArea = 0;
  const R = 6378137; // Earth's equatorial radius in meters

  polygons.forEach(poly => {
    if (poly.length === 0 || poly[0].length < 3) return;

    // Outer boundary area using Shoelace formula adjusted for latitude
    const outer = poly[0];
    let area = 0;
    
    let avgLat = 0;
    outer.forEach(pt => {
      avgLat += pt.lat;
    });
    avgLat = ((avgLat / outer.length) * Math.PI) / 180;
    
    const x = outer.map(pt => ((pt.lng * Math.PI) / 180) * R * Math.cos(avgLat));
    const y = outer.map(pt => ((pt.lat * Math.PI) / 180) * R);
    
    let numPoints = outer.length;
    let j = numPoints - 1;
    for (let i = 0; i < numPoints; i++) {
      area += (x[j] + x[i]) * (y[j] - y[i]);
      j = i;
    }
    let polyArea = Math.abs(area / 2);

    // Subtract holes
    for (let h = 1; h < poly.length; h++) {
      const hole = poly[h];
      if (hole.length < 3) continue;
      let holeArea = 0;
      const hx = hole.map(pt => ((pt.lng * Math.PI) / 180) * R * Math.cos(avgLat));
      const hy = hole.map(pt => ((pt.lat * Math.PI) / 180) * R);
      let hj = hole.length - 1;
      for (let i = 0; i < hole.length; i++) {
        holeArea += (hx[hj] + hx[i]) * (hy[hj] - hy[i]);
        hj = i;
      }
      polyArea -= Math.abs(holeArea / 2);
    }

    totalArea += polyArea;
  });

  return totalArea;
}

function computePathLength(paths: { lat: number; lng: number }[][]): number {
  let len = 0;
  paths.forEach(path => {
    for (let i = 0; i < path.length - 1; i++) {
      len += haversineDistance(path[i], path[i + 1]);
    }
  });
  return len;
}

// Map Controller for Zooming / Fitting bounds reactively
function MapController({ 
  selectedFeature, 
  fitBoundsTrigger,
  allFeatures,
  fitAllTrigger
}: { 
  selectedFeature: KmlFeature | null; 
  fitBoundsTrigger: number;
  allFeatures: KmlFeature[];
  fitAllTrigger: number;
}) {
  const map = useMap();

  // Fit bounds to a single selected feature
  useEffect(() => {
    if (!map || !selectedFeature) return;
    const bounds = getFeatureBounds(selectedFeature);
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16, animate: true });
    }
  }, [map, selectedFeature, fitBoundsTrigger]);

  // Fit bounds to all features
  useEffect(() => {
    if (!map || allFeatures.length === 0) return;
    const bounds = getAllFeaturesBounds(allFeatures);
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50], animate: true });
    }
  }, [map, allFeatures, fitAllTrigger]);

  return null;
}

const ALLOWED_SECCIONES = [
  "2729", "2802", "2804", "2805", "1145", "1148", "1149", "1151", "1152", "1153",
  "1161", "2809", "2810", "2811", "2814", "2815", "2776", "1008", "1052", "1060",
  "1061", "1141", "1142", "1047", "1022", "1211", "1019", "1210", "2721", "2748"
];

// Normalize values to remove decimals or spaces (e.g., "2729.0" -> "2729")
const normalizeVal = (v: any): string => {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  // Remove trailing .0 if it's parsed as float (e.g. 2729.0 -> 2729)
  const withoutDecimal = s.replace(/\.0+$/, '');
  // Also remove leading zeros for comparison if they are numbers
  const withoutLeadingZeros = withoutDecimal.replace(/^0+/, '');
  return withoutLeadingZeros || withoutDecimal || s;
};

// Case insensitive and accent-safe property key matching
const isSeccionKey = (key: string): boolean => {
  const normalizedKey = key.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .trim();
  
  return normalizedKey === 'seccion' || 
         normalizedKey === 'section' || 
         normalizedKey === 'sec' || 
         normalizedKey === 'secc' ||
         normalizedKey.includes('seccion') ||
         normalizedKey.includes('section');
};

// Extracts a section number from free-text strings
const extractSeccionFromNameOrDesc = (text: string): string | null => {
  if (!text) return null;
  // Match patterns like "seccion 2729", "sección 2729", "sec. 2729", "sec 2729", "seccion: 2729", "sección: 2729"
  const regex = /(?:secci[oó]n|sec\.?|section)\s*:?\s*(\d+)/i;
  const match = text.match(regex);
  if (match && match[1]) {
    return normalizeVal(match[1]);
  }
  
  // Also check if the entire text is just a number (like "2729")
  const justNumber = text.trim();
  if (/^\d+(\.0+)?$/.test(justNumber)) {
    return normalizeVal(justNumber);
  }
  
  return null;
};

// Robust helper to get Seccion value from a feature properties, name, description or other attributes
const getSeccionValue = (feature: KmlFeature): string | null => {
  if (!feature) return null;
  const props = feature.properties || {};

  // 1. Check feature.properties keys first using keys containing 'seccion' or similar
  for (const [key, value] of Object.entries(props)) {
    if (isSeccionKey(key)) {
      const normVal = normalizeVal(value);
      if (normVal) return normVal;
    }
  }

  // 2. Check if feature.name itself is a section number (e.g. "968", "2802", "1145")
  if (feature.name) {
    const trimmed = feature.name.trim();
    if (/^\d+(\.0+)?$/.test(trimmed)) {
      return normalizeVal(trimmed);
    }
    const extracted = extractSeccionFromNameOrDesc(feature.name);
    if (extracted) return extracted;
  }

  // 3. Check if feature.description has "Sección X" or "Sec X"
  if (feature.description) {
    const extracted = extractSeccionFromNameOrDesc(feature.description);
    if (extracted) return extracted;
  }

  // 4. Try any property value that matches one of our allowed sections or is numeric
  for (const value of Object.values(props)) {
    const normVal = normalizeVal(value);
    if (normVal && ALLOWED_SECCIONES.includes(normVal)) {
      return normVal;
    }
  }

  // 5. Scan any other property string value for numbers
  for (const value of Object.values(props)) {
    const text = String(value);
    const numbers = text.match(/\d+/g);
    if (numbers) {
      for (const num of numbers) {
        const norm = normalizeVal(num);
        if (norm && /^\d{1,4}$/.test(norm)) {
          return norm;
        }
      }
    }
  }

  return null;
};

// Check if feature matches Seccion filter
const isFeatureAllowed = (feature: KmlFeature): boolean => {
  return true; // Allow all sections from loaded KML files
};

// Check if feature contains "ÁREA" (case-insensitive and accent-insensitive)
const carriesArea = (feature: KmlFeature): boolean => {
  if (!feature) return false;
  const containsAreaWord = (str: string | null | undefined): boolean => {
    if (!str) return false;
    // Normalize string to remove accents and convert to lowercase
    const normalized = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return normalized.includes("area");
  };

  if (containsAreaWord(feature.name)) return true;
  if (containsAreaWord(feature.description)) return true;
  for (const val of Object.values(feature.properties || {})) {
    if (containsAreaWord(String(val))) return true;
  }
  return false;
};

// Palette of distinct colors for Brigadas
const PALETTE_BRIGADAS = [
  { fill: '#16a34a', border: '#15803d', defaultName: 'Brigada 1' }, // Emerald / Green
  { fill: '#8b4513', border: '#5c2e0b', defaultName: 'Brigada 2' }, // SaddleBrown / Brown
  { fill: '#dc2626', border: '#991b1b', defaultName: 'Brigada 3' }, // Red
  { fill: '#2563eb', border: '#1d4ed8', defaultName: 'Brigada 4' }, // Blue
  { fill: '#9333ea', border: '#6b21a8', defaultName: 'Brigada 5' }, // Purple
  { fill: '#0284c7', border: '#0369a1', defaultName: 'Brigada 6' }, // Sky
  { fill: '#ea580c', border: '#c2410c', defaultName: 'Brigada 7' }, // Orange
  { fill: '#db2777', border: '#be185d', defaultName: 'Brigada 8' }, // Pink
  { fill: '#0d9488', border: '#0f766e', defaultName: 'Brigada 9' }, // Teal
  { fill: '#7c3aed', border: '#6d28d9', defaultName: 'Brigada 10' }  // Violet
];

function getFeatureBrigadeInfo(feature: any): { key: string; name: string; color: string; border: string } {
  // 1. Check explicitly assigned brigadeName from file upload / district management (e.g. 'Brigada 1', 'Brigada 2')
  const brigadeNameStr = (feature.brigadeName || '').trim();
  const lowerB = brigadeNameStr.toLowerCase();
  
  const isGeneric = !brigadeNameStr || 
                    lowerB === 'general' || 
                    lowerB === 'general (b1-b4)' || 
                    lowerB.includes('brigadas 1-5') || 
                    lowerB.includes('todas');

  if (!isGeneric) {
    const bNumMatch = brigadeNameStr.match(/\d+/);
    if (bNumMatch) {
      const num = parseInt(bNumMatch[0], 10);
      const idx = (num - 1) % PALETTE_BRIGADAS.length;
      const palette = PALETTE_BRIGADAS[Math.max(0, idx)];
      return { key: `brigada-${num}`, name: `Brigada ${num}`, color: palette.fill, border: palette.border };
    } else {
      let hash = 0;
      for (let i = 0; i < brigadeNameStr.length; i++) hash += brigadeNameStr.charCodeAt(i);
      const palette = PALETTE_BRIGADAS[Math.abs(hash) % PALETTE_BRIGADAS.length];
      return { key: `brigade-${brigadeNameStr}`, name: brigadeNameStr, color: palette.fill, border: palette.border };
    }
  }

  // 2. Check properties / text in name / description for explicit BRIGADA tags (e.g., BRIGADA 1, B1, BRIGADA_2)
  const fullSearchText = `${feature.name || ''} ${feature.description || ''} ${JSON.stringify(feature.properties || {})}`.toUpperCase();
  const bMatch = fullSearchText.match(/BRIGADA\s*(\d+)/i) || fullSearchText.match(/\bB(\d+)\b/i) || fullSearchText.match(/BRIGADA_(\d+)/i);
  if (bMatch) {
    const num = parseInt(bMatch[1], 10);
    const idx = (num - 1) % PALETTE_BRIGADAS.length;
    const palette = PALETTE_BRIGADAS[Math.max(0, idx)];
    return { key: `brigada-${num}`, name: `Brigada ${num}`, color: palette.fill, border: palette.border };
  }

  // 3. Check if file name itself specifies a Brigade (e.g., "Brigada_2.kml", "B2.kml")
  if (feature.fileName) {
    const fnMatch = feature.fileName.match(/BRIGADA\s*(\d+)/i) || feature.fileName.match(/\bB(\d+)\b/i) || feature.fileName.match(/BRIGADA_(\d+)/i);
    if (fnMatch) {
      const num = parseInt(fnMatch[1], 10);
      const idx = (num - 1) % PALETTE_BRIGADAS.length;
      const palette = PALETTE_BRIGADAS[Math.max(0, idx)];
      return { key: `brigada-${num}`, name: `Brigada ${num}`, color: palette.fill, border: palette.border };
    }
  }

  // 4. Default section mappings for sample Distrito 8
  const secVal = getSeccionValue(feature);
  if (secVal) {
    if (['1145', '1148', '1149', '1151', '1152', '1153', '1161', '2810', '2811', '2814', '2815', '2776', '1047'].includes(secVal)) {
      return { key: 'brigada-1', name: 'Brigada 1', color: PALETTE_BRIGADAS[0].fill, border: PALETTE_BRIGADAS[0].border };
    }
    if (['2802', '2804', '2805', '1008'].includes(secVal)) {
      return { key: 'brigada-2', name: 'Brigada 2', color: PALETTE_BRIGADAS[1].fill, border: PALETTE_BRIGADAS[1].border };
    }
    if (['2729', '1211', '1019', '2721', '2809'].includes(secVal)) {
      return { key: 'brigada-3', name: 'Brigada 3', color: PALETTE_BRIGADAS[2].fill, border: PALETTE_BRIGADAS[2].border };
    }
    if (['1022', '1210', '2748'].includes(secVal)) {
      return { key: 'brigada-4', name: 'Brigada 4', color: PALETTE_BRIGADAS[3].fill, border: PALETTE_BRIGADAS[3].border };
    }
    if (['1052', '1060', '1061', '1141', '1142'].includes(secVal)) {
      return { key: 'brigada-5', name: 'Brigada 5', color: PALETTE_BRIGADAS[4].fill, border: PALETTE_BRIGADAS[4].border };
    }
  }

  // Fallback: Default cleanly to Brigada 1
  return { key: 'brigada-1', name: 'Brigada 1', color: PALETTE_BRIGADAS[0].fill, border: PALETTE_BRIGADAS[0].border };
}

export default function App() {
  const [kmlDoc, setKmlDoc] = useState<KmlDocument | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<KmlFeature | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [fitBoundsTrigger, setFitBoundsTrigger] = useState(0);
  const [fitAllTrigger, setFitAllTrigger] = useState(0);

  // Districts & Brigades State Management
  const [districts, setDistricts] = useState<District[]>(() => {
    const saved = localStorage.getItem('districts_data_v2');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const filtered = parsed.filter((d: any) => d.id !== 'distrito-8' && !d.name.includes('Distrito 8'));
          if (filtered.length > 0) return filtered;
        }
      } catch (e) {
        console.warn("Could not parse saved districts_data_v2:", e);
      }
    }
    return [
      {
        id: 'distrito-11',
        name: 'Distrito 11',
        description: 'Polígonos y capas correspondientes al Distrito 11',
        enabled: true,
        color: '#16a34a', // Emerald green theme
        kmlFiles: []
      }
    ];
  });

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem('pref_sidebar_open');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [selectedDistrictFilter, setSelectedDistrictFilter] = useState<string>('all');
  const [selectedBrigadeFilter, setSelectedBrigadeFilter] = useState<string>('all');

  // KML Upload Modal with District & Brigade assignment
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [pendingKmlText, setPendingKmlText] = useState<string | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string>('Poligono.kml');
  const [targetDistrictId, setTargetDistrictId] = useState<string>('distrito-11');
  const [targetBrigade, setTargetBrigade] = useState<string>('Brigada 1');
  const [customBrigadeInput, setCustomBrigadeInput] = useState<string>('');

  // New District Creation Modal
  const [newDistrictModalOpen, setNewDistrictModalOpen] = useState(false);
  const [newDistrictNameInput, setNewDistrictNameInput] = useState('');
  const [newDistrictColorInput, setNewDistrictColorInput] = useState('#8b5cf6');

  // Custom coloring options
  const [coloringMode, setColoringMode] = useState<'kml' | 'random' | 'property'>(() => {
    const saved = localStorage.getItem('pref_coloring_mode');
    if (saved === 'kml' || saved === 'random' || saved === 'property') return saved;
    return 'kml';
  });
  const [colorByProperty, setColorByProperty] = useState<string>('');
  const [randomColors, setRandomColors] = useState<Record<string, string>>({});

  // Error handling
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Special section filter active by default (false so all new district KMLs render without restriction)
  const [filterSeccionesActive, setFilterSeccionesActive] = useState(false);

  // Map Base Tile (Streets by default, showing streets and colonies)
  const [mapBase, setMapBase] = useState<'streets' | 'satellite' | 'dark'>(() => {
    const saved = localStorage.getItem('pref_map_base');
    if (saved === 'streets' || saved === 'satellite' || saved === 'dark') return saved;
    return 'streets';
  });

  // Save user preferences to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('pref_sidebar_open', JSON.stringify(isSidebarOpen));
    } catch (e) {}
  }, [isSidebarOpen]);

  useEffect(() => {
    try {
      localStorage.setItem('pref_coloring_mode', coloringMode);
    } catch (e) {}
  }, [coloringMode]);

  useEffect(() => {
    try {
      localStorage.setItem('pref_map_base', mapBase);
    } catch (e) {}
  }, [mapBase]);

  // Save districts to localStorage whenever modified
  useEffect(() => {
    if (districts && districts.length > 0) {
      try {
        localStorage.setItem('districts_data_v2', JSON.stringify(districts));
      } catch (e) {
        console.warn("Error saving districts to localStorage:", e);
      }
    }
  }, [districts]);

  // Google Account simulated states
  const [currentUser, setCurrentUser] = useState<{ email: string; name: string; avatar?: string } | null>(() => {
    const saved = localStorage.getItem('google_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    // Default to normal user so they see the standard view initially
    return { email: 'bunkerhrv@gmail.com', name: 'Bunker HRV', avatar: 'B' };
  });

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [customEmailInput, setCustomEmailInput] = useState('');

  const [isSavingToServer, setIsSavingToServer] = useState(false);
  const [serverSaveMessage, setServerSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [firestoreQuotaExceeded, setFirestoreQuotaExceeded] = useState(false);

  const checkFirestoreQuotaError = (err: any) => {
    const errMsg = err?.message || String(err);
    if (errMsg.includes("quota") || errMsg.includes("Quota") || errMsg.includes("exceeded") || errMsg.includes("Exceeded")) {
      setFirestoreQuotaExceeded(true);
    }
  };

  const isFakeKml = (kmlText: string | null): boolean => {
    if (!kmlText) return false;
    return kmlText.includes('HEXAGONAL_GRID');
  };

  // Helper function to attach parsed KML to a district as a KML file
  const attachKmlToDistrict = (
    kmlText: string, 
    fileName: string, 
    districtId: string, 
    brigadeName: string
  ): { success: boolean; updatedDistricts?: District[] } => {
    try {
      const parsed = parseKml(kmlText);
      setKmlDoc(parsed);

      const newFile: DistrictKmlFile = {
        id: 'kml-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
        name: fileName || parsed.name || 'Archivo.kml',
        brigade: brigadeName || 'General',
        enabled: true,
        kmlText: kmlText,
        kmlDoc: parsed,
        uploadedAt: new Date().toLocaleDateString('es-MX')
      };

      let newDistrictsList: District[] = [];

      setDistricts(prev => {
        newDistrictsList = prev.map(dist => {
          if (dist.id === districtId) {
            // Check if file with same name already exists to avoid duplicate entries
            const existing = dist.kmlFiles.filter(f => f.name !== newFile.name);
            return {
              ...dist,
              enabled: true, // Auto-activate district on upload
              kmlFiles: [...existing, newFile]
            };
          }
          return dist;
        });
        return newDistrictsList;
      });

      // Trigger map bounds fit
      setTimeout(() => {
        setFitAllTrigger(prev => prev + 1);
      }, 150);

      return { success: true, updatedDistricts: newDistrictsList };
    } catch (err) {
      console.error("Error attaching KML to district:", err);
      setErrorMsg("Error al procesar el archivo KML. Verifica que el archivo XML sea válido.");
      return { success: false };
    }
  };

  // Load default sample or persisted KML on mount into Districts
  useEffect(() => {
    const initKml = async () => {
      let serverDistrictsData: District[] | null = null;
      let serverKmlText: string | null = null;

      // 1. Fetch official Districts and KML from server (/api/districts & /api/kml)
      try {
        const resDist = await fetch('/api/districts');
        const dataDist = await resDist.json();
        if (dataDist.success && Array.isArray(dataDist.districts) && dataDist.districts.length > 0) {
          serverDistrictsData = dataDist.districts;
        }
      } catch (err) {
        console.warn("Could not fetch districts from local API server:", err);
      }

      try {
        const resKml = await fetch('/api/kml');
        const dataKml = await resKml.json();
        if (dataKml.success && dataKml.kml && !isFakeKml(dataKml.kml)) {
          serverKmlText = dataKml.kml;
        }
      } catch (err) {
        console.warn("Error fetching KML from local API server:", err);
      }

      // 2. Try loading persisted data from Firestore
      let firestoreResult: { kmlText: string | null; districtsData: any | null } | null = null;
      try {
        console.log("Intentando cargar KML y Distritos desde Firebase Firestore...");
        const res = await getKmlFromFirestore();
        if (res) {
          firestoreResult = res;
        }
      } catch (fErr: any) {
        console.warn("No se pudo conectar a Firestore:", fErr);
        checkFirestoreQuotaError(fErr);
      }

      // 3. Load from localStorage fallback
      let localDistrictsData: District[] | null = null;
      const savedLocal = localStorage.getItem('districts_data_v2');
      if (savedLocal) {
        try {
          const parsed = JSON.parse(savedLocal);
          if (Array.isArray(parsed) && parsed.length > 0) {
            localDistrictsData = parsed;
          }
        } catch (e) {
          console.warn("Could not parse local districts:", e);
        }
      }

      // Canonical D11 default files (Brigada 1 and Brigada 2)
      const canonicalD11Files: DistrictKmlFile[] = [];
      try {
        if (brigada1KmlText) {
          canonicalD11Files.push({
            id: 'd11-brigada1-kml',
            name: 'BRIGADA 1 DT11.kml',
            brigade: 'Brigada 1',
            enabled: true,
            kmlText: brigada1KmlText,
            kmlDoc: parseKml(brigada1KmlText),
            uploadedAt: new Date().toLocaleDateString('es-MX')
          });
        }
        if (brigada2KmlText) {
          canonicalD11Files.push({
            id: 'd11-brigada2-kml',
            name: 'BRIGADA 2 DT11.kml',
            brigade: 'Brigada 2',
            enabled: true,
            kmlText: brigada2KmlText,
            kmlDoc: parseKml(brigada2KmlText),
            uploadedAt: new Date().toLocaleDateString('es-MX')
          });
        }
      } catch (e) {
        console.error("Error parsing default Brigada KMLs:", e);
      }

      // Merge source priority: Firestore > Server > LocalStorage
      const candidateSources: District[][] = [];
      if (firestoreResult?.districtsData && Array.isArray(firestoreResult.districtsData) && firestoreResult.districtsData.length > 0) {
        candidateSources.push(firestoreResult.districtsData);
      }
      if (serverDistrictsData) {
        candidateSources.push(serverDistrictsData);
      }
      if (localDistrictsData) {
        candidateSources.push(localDistrictsData);
      }

      const processDistrictArray = (rawDistricts: any[]): District[] => {
        return rawDistricts
          .filter((d: any) => d.id !== 'distrito-8' && d.name !== 'Distrito 8')
          .map((d: any) => ({
            ...d,
            kmlFiles: (d.kmlFiles || []).map((f: any) => {
              if (f.kmlText) {
                try {
                  const parsed = parseKml(f.kmlText);
                  return { ...f, kmlDoc: parsed };
                } catch (e) {
                  console.error("Error parsing file:", f.name, e);
                  return null;
                }
              }
              return f;
            }).filter((f: any) => f && f.kmlDoc && Array.isArray(f.kmlDoc.features))
          }));
      };

      let mergedDistricts: District[] = candidateSources.length > 0 
        ? processDistrictArray(candidateSources[0])
        : [
            {
              id: 'distrito-11',
              name: 'Distrito 11',
              description: 'Polígonos y capas correspondientes al Distrito 11',
              enabled: true,
              color: '#16a34a',
              kmlFiles: [...canonicalD11Files]
            }
          ];

      // Merge secondary sources so no user-uploaded file is ever lost
      for (let s = 1; s < candidateSources.length; s++) {
        const secondary = processDistrictArray(candidateSources[s]);
        secondary.forEach(secDist => {
          const targetDistIndex = mergedDistricts.findIndex(d => d.id === secDist.id);
          if (targetDistIndex >= 0) {
            const existingDist = mergedDistricts[targetDistIndex];
            secDist.kmlFiles.forEach(secFile => {
              const fileExists = existingDist.kmlFiles.some(f => f.name === secFile.name || f.id === secFile.id);
              if (!fileExists) {
                existingDist.kmlFiles.push(secFile);
              }
            });
          } else {
            mergedDistricts.push(secDist);
          }
        });
      }

      // Ensure Distrito 11 includes canonicalD11Files if missing
      const d11Idx = mergedDistricts.findIndex(d => d.id === 'distrito-11');
      if (canonicalD11Files.length > 0) {
        if (d11Idx >= 0) {
          const d11 = mergedDistricts[d11Idx];
          if (!d11.kmlFiles || d11.kmlFiles.length === 0) {
            d11.kmlFiles = [...canonicalD11Files];
          } else {
            canonicalD11Files.forEach(cFile => {
              const hasCanonical = d11.kmlFiles.some(f => f.name === cFile.name || f.id === cFile.id);
              if (!hasCanonical) {
                d11.kmlFiles.push(cFile);
              }
            });
          }
        } else {
          mergedDistricts.unshift({
            id: 'distrito-11',
            name: 'Distrito 11',
            description: 'Polígonos y capas correspondientes al Distrito 11',
            enabled: true,
            color: '#16a34a',
            kmlFiles: [...canonicalD11Files]
          });
        }
      }

      setDistricts(mergedDistricts);

      try {
        localStorage.setItem('districts_data_v2', JSON.stringify(mergedDistricts));
      } catch (e) {}

      setTimeout(() => {
        setFitAllTrigger(prev => prev + 1);
      }, 200);
    };

    initKml();
  }, []);

  const saveKmlToServer = async () => {
    setIsSavingToServer(true);
    setServerSaveMessage(null);
    try {
      // Clean districts data by stripping heavy parsed kmlDoc DOM objects
      const cleanDistricts = districts.map(d => ({
        ...d,
        kmlFiles: (d.kmlFiles || []).map(f => {
          const { kmlDoc, ...rest } = f;
          return rest;
        })
      }));

      // Gather all active KML texts across districts
      const allKmlTexts: string[] = [];
      cleanDistricts.forEach(d => {
        d.kmlFiles.forEach(f => {
          if (f.kmlText) allKmlTexts.push(f.kmlText);
        });
      });

      const fallbackKml = localStorage.getItem('persisted_kml_content') || '';
      const mainKmlText = allKmlTexts.length > 0 ? allKmlTexts.join('\n\n') : fallbackKml;

      // 0. Always save to LocalStorage immediately so local session is never lost
      try {
        localStorage.setItem('districts_data_v2', JSON.stringify(cleanDistricts));
        if (mainKmlText) {
          localStorage.setItem('persisted_kml_content', mainKmlText);
        }
      } catch (lErr) {
        console.warn("LocalStorage save warning:", lErr);
      }

      // 1. Save to Express backend (/api/districts)
      const saveServerPromise = (async (): Promise<boolean> => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          const res = await fetch('/api/districts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ districts: cleanDistricts, kmlText: mainKmlText }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          const data = await res.json();
          return !!data.success;
        } catch (sErr) {
          console.warn("Express server save skipped or timed out:", sErr);
          return false;
        }
      })();

      // 2. Save to Firebase Firestore with a 4-second timeout guard
      const saveFirestorePromise = (async (): Promise<boolean> => {
        try {
          const timeout = new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error("Firestore timeout")), 4000)
          );
          await Promise.race([
            saveKmlToFirestore(mainKmlText, currentUser?.email || 'admin', cleanDistricts),
            timeout
          ]);
          return true;
        } catch (fErr: any) {
          console.warn("Firestore save failed or timed out:", fErr);
          checkFirestoreQuotaError(fErr);
          return false;
        }
      })();

      // Run both in parallel so one does not block the other
      const [serverSuccess, firestoreSuccess] = await Promise.all([saveServerPromise, saveFirestorePromise]);

      if (serverSuccess || firestoreSuccess) {
        setServerSaveMessage({ 
          type: 'success', 
          text: '¡Guardado con éxito! Todos los Distritos y Brigadas se publicaron correctamente.' 
        });
      } else {
        setServerSaveMessage({ 
          type: 'success', 
          text: '¡Guardado correctamente en almacenamiento local!' 
        });
      }
    } catch (err: any) {
      setServerSaveMessage({ type: 'error', text: 'Error al intentar guardar los cambios.' });
    } finally {
      setIsSavingToServer(false);
      setTimeout(() => {
        setServerSaveMessage(null);
      }, 6000);
    }
  };

  // Fit bounds when filter changes
  useEffect(() => {
    if (kmlDoc) {
      setTimeout(() => {
        setFitAllTrigger(prev => prev + 1);
      }, 50);
    }
  }, [filterSeccionesActive]);

  // Generate unique random colors for features if they switch to 'random' mode
  useEffect(() => {
    if (!kmlDoc) return;
    const colors: Record<string, string> = {};
    kmlDoc.features.forEach((f) => {
      const hue = Math.floor(Math.random() * 360);
      colors[f.id] = `hsl(${hue}, 80%, 55%)`;
    });
    setRandomColors(colors);
  }, [kmlDoc]);

  // Check if current document has any 'SECCION' key
  const hasSeccionProperties = kmlDoc?.features.some(f => getSeccionValue(f) !== null) || false;

  // Active features aggregated across all enabled districts and enabled KML files
  const activeDistrictFeatures = useMemo<DistrictFeature[]>(() => {
    const result: DistrictFeature[] = [];

    districts.forEach(district => {
      if (!district.enabled) return;

      district.kmlFiles.forEach(file => {
        if (!file.enabled || !file.kmlDoc || !Array.isArray(file.kmlDoc.features)) return;

        file.kmlDoc.features.forEach(feat => {
          // If filterSeccionesActive is explicitly turned ON, restrict section filter to Distrito 8
          if (filterSeccionesActive && district.id === 'distrito-8' && feat.properties) {
            const hasSec = Object.keys(feat.properties).some(k => k.toUpperCase().includes('SECCION'));
            if (hasSec && !isFeatureAllowed(feat)) {
              return;
            }
          }

          result.push({
            ...feat,
            districtId: district.id,
            districtName: district.name,
            districtColor: district.color,
            brigadeName: file.brigade || 'General',
            fileId: file.id,
            fileName: file.name
          });
        });
      });
    });

    return result;
  }, [districts, filterSeccionesActive]);

  const activeFeatures = activeDistrictFeatures;

  // District manipulation methods
  const toggleDistrict = (districtId: string) => {
    setDistricts(prev => prev.map(d => d.id === districtId ? { ...d, enabled: !d.enabled } : d));
  };

  const toggleKmlFile = (districtId: string, fileId: string) => {
    setDistricts(prev => prev.map(d => {
      if (d.id === districtId) {
        return {
          ...d,
          kmlFiles: d.kmlFiles.map(f => f.id === fileId ? { ...f, enabled: !f.enabled } : f)
        };
      }
      return d;
    }));
  };

  const deleteKmlFile = (districtId: string, fileId: string) => {
    setDistricts(prev => prev.map(d => {
      if (d.id === districtId) {
        return {
          ...d,
          kmlFiles: d.kmlFiles.filter(f => f.id !== fileId)
        };
      }
      return d;
    }));
  };

  const handleCreateDistrict = () => {
    if (!newDistrictNameInput.trim()) return;
    const newId = 'distrito-' + Date.now();
    const newDist: District = {
      id: newId,
      name: newDistrictNameInput.trim(),
      description: `Polígonos y capas correspondientes a ${newDistrictNameInput.trim()}`,
      enabled: true,
      color: newDistrictColorInput || '#8b5cf6',
      kmlFiles: []
    };
    setDistricts(prev => [...prev, newDist]);
    setTargetDistrictId(newId);
    setNewDistrictNameInput('');
    setNewDistrictModalOpen(false);
  };

  const handleKmlFileSelected = (file: File, preselectDistrictId?: string) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        setPendingKmlText(text);
        setPendingFileName(file.name);
        if (preselectDistrictId) {
          setTargetDistrictId(preselectDistrictId);
        }
        setUploadModalOpen(true);
      }
    };
    reader.onerror = () => {
      setErrorMsg('Error al leer el archivo KML.');
    };
    reader.readAsText(file);
  };

  const confirmKmlUpload = async () => {
    if (!pendingKmlText) return;
    const finalBrigade = customBrigadeInput.trim() || targetBrigade || 'Brigada 1';
    
    const result = attachKmlToDistrict(
      pendingKmlText,
      pendingFileName,
      targetDistrictId,
      finalBrigade
    );

    if (result.success && result.updatedDistricts) {
      setUploadModalOpen(false);
      setPendingKmlText(null);
      setCustomBrigadeInput('');

      // Gather all active KML texts across districts to build a complete combined text
      const allKmlTexts: string[] = [];
      result.updatedDistricts.forEach(d => {
        d.kmlFiles.forEach(f => {
          if (f.kmlText) allKmlTexts.push(f.kmlText);
        });
      });
      const combinedText = allKmlTexts.length > 0 ? allKmlTexts.join('\n\n') : pendingKmlText;

      try {
        await fetch('/api/districts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ districts: result.updatedDistricts, kmlText: combinedText })
        });
      } catch (sErr) {
        console.warn("Auto-sync to server skipped:", sErr);
      }

      try {
        await saveKmlToFirestore(combinedText, currentUser?.email || 'bunkerhrv@gmail.com', result.updatedDistricts);
        console.log("¡KML y estructura de Distritos guardados exitosamente en Firestore!");
      } catch (err) {
        console.warn("Auto-sync to Firestore skipped/limited:", err);
      }
    }
  };

  // Extract all unique ExtendedData keys from active features to allow categorization
  const getExtendedDataKeys = (): string[] => {
    const keysSet = new Set<string>();
    activeFeatures.forEach(f => {
      if (f && f.properties) {
        Object.keys(f.properties).forEach(k => keysSet.add(k));
      }
    });
    return Array.from(keysSet);
  };

  const extendedKeys = getExtendedDataKeys();

  // If coloring by property is selected, find all unique values of that property to generate hues
  const getUniquePropertyValues = (propKey: string): string[] => {
    if (!propKey) return [];
    const valuesSet = new Set<string>();
    activeFeatures.forEach(f => {
      if (f && f.properties && f.properties[propKey]) {
        valuesSet.add(f.properties[propKey]);
      }
    });
    return Array.from(valuesSet);
  };

  const propertyUniqueValues = colorByProperty ? getUniquePropertyValues(colorByProperty) : [];

  // Get style configs for Leaflet vectors based on active color modes
  const getFeatureStyle = (feature: KmlFeature) => {
    if (!feature) {
      return { fillColor: '#16a34a', fillOpacity: 0.45, color: '#15803d', weight: 2.5 };
    }
    const isSelected = selectedFeature?.id === feature.id;

    if (coloringMode === 'random') {
      const color = (randomColors && randomColors[feature.id]) || '#3b82f6';
      return {
        fillColor: color,
        fillOpacity: isSelected ? 0.65 : 0.35,
        color: isSelected ? '#ffffff' : color,
        weight: isSelected ? 3.5 : 2
      };
    }

    if (coloringMode === 'property' && colorByProperty) {
      const val = feature.properties ? feature.properties[colorByProperty] : null;
      if (!val) {
        return {
          fillColor: '#475569',
          fillOpacity: isSelected ? 0.45 : 0.2,
          color: isSelected ? '#ffffff' : '#64748b',
          weight: isSelected ? 3 : 1.5
        };
      }
      const idx = propertyUniqueValues.indexOf(val);
      const total = propertyUniqueValues.length;
      const hue = total > 1 ? (idx * (360 / total)) : 140;
      const col = `hsl(${hue}, 75%, 45%)`;
      return {
        fillColor: col,
        fillOpacity: isSelected ? 0.7 : 0.45,
        color: isSelected ? '#ffffff' : `hsl(${hue}, 85%, 35%)`,
        weight: isSelected ? 3.5 : 2
      };
    }

    // Default: Dynamic Brigade color assignment
    const bInfo = getFeatureBrigadeInfo(feature);
    return {
      fillColor: bInfo.color,
      fillOpacity: isSelected ? 0.75 : 0.45,
      color: isSelected ? '#ffffff' : bInfo.border,
      weight: isSelected ? 4 : 2.5
    };
  };

  // State and helpers for the top-left color zones / active color sections dropdown
  const [selectedColorGroup, setSelectedColorGroup] = useState<string | null>(null);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [isColorWidgetCollapsed, setIsColorWidgetCollapsed] = useState(false);
  const [isDetailsCollapsed, setIsDetailsCollapsed] = useState(false);

  // Group active features by their Brigade and distinct assigned color
  const colorGroups = useMemo(() => {
    const groups: Record<string, { key: string; color: string; friendlyName: string; features: KmlFeature[] }> = {};
    
    activeFeatures.forEach(f => {
      if (!f) return;
      const bInfo = getFeatureBrigadeInfo(f);
      const style = getFeatureStyle(f);
      
      if (!groups[bInfo.key]) {
        groups[bInfo.key] = {
          key: bInfo.key,
          color: style.fillColor || bInfo.color,
          friendlyName: bInfo.name,
          features: []
        };
      }
      groups[bInfo.key].features.push(f);
    });

    const getBrigadeNumber = (name: string): number => {
      const match = name.match(/\d+/);
      return match ? parseInt(match[0], 10) : 999;
    };
    
    // Sort so Brigada 1, Brigada 2, Brigada 3, Brigada 4, Brigada 5 appear in natural sequence
    const sortedGroups = Object.values(groups).sort((a, b) => {
      const numA = getBrigadeNumber(a.friendlyName);
      const numB = getBrigadeNumber(b.friendlyName);
      if (numA !== numB) return numA - numB;
      return a.friendlyName.localeCompare(b.friendlyName);
    });
    
    return sortedGroups;
  }, [activeFeatures, coloringMode, colorByProperty, randomColors]);

  const preventMapAction = (e: React.MouseEvent | React.WheelEvent) => {
    e.stopPropagation();
  };

  // KML parsing pipeline
  const loadSampleKml = (kmlText: string, persist = true) => {
    try {
      setErrorMsg(null);
      const parsed = parseKml(kmlText);
      setKmlDoc(parsed);
      setSelectedFeature(null);
      
      if (persist) {
        localStorage.setItem('persisted_kml_content', kmlText);
        localStorage.setItem('persisted_kml_name', parsed.name || 'Cargado');
      }

      const keys = Object.keys(parsed.features[0]?.properties || {});
      if (keys.length > 0) {
        setColorByProperty(keys[0]);
      }

      // Trigger bounds recalculation asynchronously to let map load
      setTimeout(() => {
        setFitAllTrigger(prev => prev + 1);
      }, 100);
    } catch (err: any) {
      console.error(err);
      setErrorMsg('Error al parsear el archivo KML. Asegúrate de que sea un XML de KML válido.');
    }
  };

  const handleKmlFile = (file: File) => {
    handleKmlFileSelected(file, targetDistrictId || 'distrito-11');
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleKmlFile(e.dataTransfer.files[0]);
    }
  };

  const triggerFileSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.kml';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        handleKmlFile(file);
      }
    };
    input.click();
  };

  // Filter features based on search query
  const filteredFeatures = activeFeatures.filter(f => {
    if (!f) return false;
    const query = (searchQuery || '').trim().toLowerCase();
    if (!query) return true;
    const nameStr = (f.name || '').toLowerCase();
    const descStr = (f.description || '').toLowerCase();
    const matchesName = nameStr.includes(query);
    const matchesDesc = descStr.includes(query);
    const props = f.properties || {};
    const matchesProps = Object.entries(props).some(([k, v]) => 
      (k || '').toLowerCase().includes(query) || String(v || '').toLowerCase().includes(query)
    );
    return matchesName || matchesDesc || matchesProps;
  });

  // Calculate geodetic metrics for property viewer
  const calculateFeatureMetrics = (feat: KmlFeature) => {
    let totalArea = 0; // sqm
    let totalLength = 0; // meters
    let totalVertices = 0;

    if (feat.geometryType === 'Polygon') {
      totalArea = computePolygonArea(feat.polygons);
      
      // Calculate perimeter length of all paths in the polygon
      feat.polygons.forEach(poly => {
        poly.forEach(path => {
          totalVertices += path.length;
          // Add first coordinate to close the perimeter calculation
          if (path.length > 1) {
            const closedPath = [...path, path[0]];
            totalLength += computePathLength([closedPath]);
          }
        });
      });
    }

    if (feat.geometryType === 'LineString') {
      totalLength = computePathLength(feat.lineStrings);
      feat.lineStrings.forEach(path => {
        totalVertices += path.length;
      });
    }

    if (feat.geometryType === 'Point') {
      totalVertices = feat.points.length;
    }

    return {
      areaHectares: totalArea > 0 ? (totalArea / 10000).toFixed(2) : null,
      areaSqKm: totalArea > 0 ? (totalArea / 1000000).toFixed(4) : null,
      lengthKm: totalLength > 0 ? (totalLength / 1000).toFixed(3) : null,
      lengthMeters: totalLength > 0 ? totalLength.toFixed(1) : null,
      vertices: totalVertices
    };
  };

  const metrics = selectedFeature ? calculateFeatureMetrics(selectedFeature) : null;
  const isAdmin = currentUser && [
    'hugocesarlemuscortes@gmail.com'
  ].includes(currentUser.email.trim().toLowerCase());

  return (
    <div className="h-screen w-screen flex flex-col bg-[#050505] text-[#e2e8f0] overflow-hidden font-sans">
      
      {firestoreQuotaExceeded && (
        <div className="bg-amber-950/90 border-b border-amber-800/60 text-amber-100 px-4 py-2 text-xs flex flex-col md:flex-row md:items-center justify-between gap-2 z-30 transition-all duration-300">
          <div className="flex items-center gap-2">
            <span className="text-sm">⚠️</span>
            <div>
              <p className="font-semibold text-amber-200">
                Se ha excedido la cuota diaria gratuita de Firebase Firestore. El visor está operando con la caché local y el servidor API de respaldo.
              </p>
              <p className="text-[10px] text-amber-300/80 font-mono">
                Error: Quota exceeded for quota metric 'Free daily read units per project (free tier database)'.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a 
              href="https://console.firebase.google.com/project/asymmetric-axon-bt3g1/firestore/databases/ai-studio-hcmap-8888b844-b892-4aea-8a10-57ec75a46d0c/data?openUpgradeDialog=true"
              target="_blank" 
              rel="noopener noreferrer" 
              className="bg-amber-800/40 hover:bg-amber-800/70 border border-amber-700/50 text-amber-200 font-semibold px-2.5 py-1 rounded transition whitespace-nowrap"
            >
              Ver Consola de Firebase
            </a>
            <button 
              onClick={() => setFirestoreQuotaExceeded(false)}
              className="text-amber-400 hover:text-amber-200 font-bold px-1 text-sm select-none cursor-pointer"
              title="Descartar"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Elegant Header */}
      <header className="h-[60px] bg-[#0f172a] border-b border-[#1e293b] flex items-center px-4 sm:px-6 justify-between flex-shrink-0 z-20">
        <div className="flex items-center space-x-3">
          {isAdmin && (
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition select-none cursor-pointer ${
                isSidebarOpen 
                  ? 'bg-blue-600/20 text-blue-400 border-blue-500/40' 
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
              title="Activar / Desactivar Barra Lateral de Distritos y Brigadas"
            >
              <Layers className="w-4 h-4 text-blue-400" />
              <span className="hidden sm:inline">Distritos & Brigadas</span>
              <span className="bg-blue-500/20 text-blue-300 text-[10px] font-mono px-1.5 py-0.2 rounded">
                {districts.filter(d => d.enabled).length}/{districts.length}
              </span>
            </button>
          )}

          <div className="flex items-center">
            <a
              href="https://wa.me/524434008893?text=HOLA%20CESAR,%20REQUIERO%20INFORMACION..."
              target="_blank"
              rel="noopener noreferrer"
              className="font-extrabold tracking-tight text-red-500 text-lg sm:text-xl animate-blink-red hover:scale-105 transition-transform duration-200 cursor-pointer select-none inline-flex items-center"
              title="Enviar mensaje de WhatsApp a César (4434008893)"
            >
              HCES.MAPS
            </a>
            <span className="ml-2 text-[#475569] text-xs font-semibold px-2 py-0.5 bg-slate-950/45 rounded border border-slate-800/40 hidden md:inline">Visor de Capas</span>
          </div>

          {/* Quick District Pills in Header - Admin only */}
          {isAdmin && (
            <div className="hidden lg:flex items-center space-x-1.5 pl-2">
              {districts.map(d => (
                <button
                  key={d.id}
                  onClick={() => toggleDistrict(d.id)}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition flex items-center space-x-1.5 ${
                    d.enabled 
                      ? 'bg-slate-900 text-slate-200 border-slate-700' 
                      : 'bg-slate-950/60 text-slate-600 border-slate-900 line-through'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }}></span>
                  <span>{d.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* Google Authentication & Save Changes Button */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {isAdmin && (
            <button
              onClick={saveKmlToServer}
              disabled={isSavingToServer}
              className={`px-3 py-1.5 rounded-xl font-extrabold text-xs flex items-center space-x-1.5 border shadow-lg transition cursor-pointer select-none ${
                isSavingToServer
                  ? 'bg-emerald-950 text-emerald-400 border-emerald-800 opacity-80 cursor-wait'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500/80 hover:shadow-emerald-900/50 active:scale-[0.98]'
              }`}
              title="Guardar y publicar todos los cambios permanentemente"
            >
              <Save className="w-3.5 h-3.5" />
              <span className="tracking-wide text-[11px] sm:text-xs">
                {isSavingToServer ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
              </span>
            </button>
          )}

          {currentUser ? (
            <div className="flex items-center space-x-2 bg-slate-950/60 border border-slate-800/80 rounded-xl py-1 px-2 sm:px-2.5 transition select-none">
              <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white uppercase shadow-inner flex-shrink-0">
                {currentUser.avatar || currentUser.email[0]}
              </div>
              
              <div className="text-left max-w-[120px] sm:max-w-[160px] truncate hidden md:block">
                <p className="text-[11px] font-bold text-slate-200 leading-tight truncate">
                  {currentUser.name}
                </p>
                <p className="text-[9px] text-slate-400 font-mono leading-none truncate">
                  {currentUser.email}
                </p>
              </div>

              {isAdmin ? (
                <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <Shield className="w-2.5 h-2.5 mr-0.5" />
                  Admin
                </span>
              ) : (
                <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                  <User className="w-2.5 h-2.5 mr-0.5" />
                  Usuario
                </span>
              )}

              {/* Quick inline logout button */}
              <button
                onClick={() => {
                  setCurrentUser(null);
                  localStorage.removeItem('google_user');
                }}
                className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 rounded-lg transition cursor-pointer ml-1"
                title="Cerrar sesión"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                const u = { email: 'hugocesarlemuscortes@gmail.com', name: 'Hugo César Lemus', avatar: 'H' };
                setCurrentUser(u);
                localStorage.setItem('google_user', JSON.stringify(u));
              }}
              className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-1.5 px-3 rounded-xl transition shadow cursor-pointer"
            >
              <User className="w-3.5 h-3.5" />
              <span>Acceder</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        
        {/* LEFT SIDEBAR: Distritos & Brigadas Management (Admin Only) */}
        {isAdmin && isSidebarOpen && (
          <aside className="w-full md:w-[360px] lg:w-[380px] flex-shrink-0 border-b md:border-b-0 md:border-r border-[#1e293b] flex flex-col bg-[#0f172a] max-h-[50vh] md:max-h-full z-10 transition-all duration-300 shadow-xl">
            
            {/* Sidebar Title & Quick Actions */}
            <div className="p-3.5 border-b border-[#1e293b] bg-slate-900/60 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-100 text-xs tracking-wide">Distritos y Brigadas</h2>
                  <span className="text-[10px] text-slate-400 font-mono block">Gestión Multi-Capa</span>
                </div>
              </div>

              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => setNewDistrictModalOpen(true)}
                  className="px-2.5 py-1 bg-purple-950/50 hover:bg-purple-900/70 text-purple-300 border border-purple-800/40 rounded-lg text-xs font-semibold transition flex items-center space-x-1 cursor-pointer"
                  title="Agregar un nuevo Distrito"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="text-[10px]">Nuevo Distrito</span>
                </button>
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-200 rounded-lg transition md:hidden"
                  title="Cerrar barra lateral"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable District & File List */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-4 custom-scrollbar">
              
              {/* Dropzone for drag-and-drop file upload */}
              <div 
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={triggerFileSelect}
                className={`border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition flex items-center justify-center space-x-2.5 ${
                  dragActive 
                    ? 'border-blue-500 bg-blue-500/10' 
                    : 'border-slate-800 hover:border-slate-700 bg-slate-950/50'
                }`}
              >
                <Upload className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <div className="text-left min-w-0">
                  <p className="text-xs font-semibold text-slate-200">Subir nuevo archivo KML</p>
                  <p className="text-[10px] text-slate-400">Vincula un KML a cualquier Distrito y Brigada</p>
                </div>
              </div>

              {/* Districts Container */}
              <div className="space-y-3">
                {districts.map(dist => {
                  const totalKmls = dist.kmlFiles.length;
                  const totalPolygons = dist.kmlFiles.reduce((acc, f) => acc + (f.kmlDoc?.features?.length || 0), 0);

                  return (
                    <div 
                      key={dist.id}
                      className={`border rounded-xl transition-all overflow-hidden ${
                        dist.enabled 
                          ? 'bg-[#1e293b]/50 border-slate-700/80' 
                          : 'bg-slate-950/40 border-slate-900 opacity-60'
                      }`}
                    >
                      {/* District Header & Master Toggle */}
                      <div className="p-3 bg-slate-900/80 flex items-center justify-between border-b border-slate-800/80">
                        <div className="flex items-center space-x-2.5 min-w-0">
                          <button
                            onClick={() => toggleDistrict(dist.id)}
                            className={`w-4 h-4 rounded border flex items-center justify-center transition cursor-pointer ${
                              dist.enabled 
                                ? 'bg-blue-600 border-blue-500 text-white' 
                                : 'bg-slate-950 border-slate-800 text-transparent'
                            }`}
                            title={dist.enabled ? 'Desactivar vista de este distrito' : 'Activar vista de este distrito'}
                          >
                            <Check className="w-3 h-3 stroke-[3]" />
                          </button>
                          <div className="min-w-0">
                            <div className="flex items-center space-x-1.5">
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dist.color }}></span>
                              <h3 className="text-xs font-bold text-slate-200 truncate">{dist.name}</h3>
                            </div>
                            <p className="text-[10px] text-slate-400 truncate mt-0.5">
                              {totalKmls} {totalKmls === 1 ? 'archivo KML' : 'archivos KML'} · {totalPolygons} elementos
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            setTargetDistrictId(dist.id);
                            triggerFileSelect();
                          }}
                          className="px-2 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-lg text-[10px] font-bold transition flex items-center space-x-1 cursor-pointer"
                          title={`Subir archivo KML a ${dist.name}`}
                        >
                          <Upload className="w-3 h-3" />
                          <span>+ Subir KML</span>
                        </button>
                      </div>

                      {/* District KML Files List */}
                      <div className="p-2 space-y-1.5 bg-slate-950/30">
                        {dist.kmlFiles.length === 0 ? (
                          <div className="p-3 text-center border border-dashed border-slate-800/80 rounded-lg">
                            <p className="text-[11px] text-slate-500">Sin archivos KML en este distrito.</p>
                            <button
                              onClick={() => {
                                setTargetDistrictId(dist.id);
                                triggerFileSelect();
                              }}
                              className="mt-1.5 text-[10px] text-blue-400 font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Upload className="w-3 h-3" />
                              Subir KML a {dist.name}
                            </button>
                          </div>
                        ) : (
                          dist.kmlFiles.map(file => (
                            <div 
                              key={file.id}
                              className={`p-2 rounded-lg border text-xs flex items-center justify-between transition ${
                                file.enabled 
                                  ? 'bg-slate-900/90 border-slate-800 text-slate-200' 
                                  : 'bg-slate-950/60 border-slate-900 text-slate-500 line-through'
                              }`}
                            >
                              <div className="flex items-center space-x-2 min-w-0 pr-2">
                                <button
                                  onClick={() => toggleKmlFile(dist.id, file.id)}
                                  className="text-slate-400 hover:text-blue-400 transition flex-shrink-0 cursor-pointer"
                                  title={file.enabled ? 'Ocultar capa' : 'Mostrar capa'}
                                >
                                  {file.enabled ? <Eye className="w-3.5 h-3.5 text-blue-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                                </button>
                                <div className="min-w-0">
                                  <p className="font-semibold text-[11px] truncate">{file.name}</p>
                                  <div className="flex items-center space-x-1.5 mt-0.5">
                                    <span className="text-[9px] font-mono font-bold bg-slate-800 text-blue-300 px-1.5 py-0.2 rounded border border-slate-700/50">
                                      {file.brigade || 'General'}
                                    </span>
                                    <span className="text-[9px] text-slate-500">
                                      {file.kmlDoc?.features?.length || 0} elem.
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <button
                                onClick={() => deleteKmlFile(dist.id, file.id)}
                                className="p-1 text-slate-500 hover:text-rose-400 rounded transition cursor-pointer"
                                title="Eliminar este archivo KML"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Search Bar */}
              <div className="bg-[#1e293b]/40 border border-[#334155]/60 rounded-xl p-3">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Buscar sección, área o brigada..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-950 text-xs text-slate-200 border border-slate-800 pl-8 pr-3 py-1.5 rounded-lg outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Sidebar Save Changes Action Block */}
            <div className="p-3 border-t border-[#1e293b] bg-slate-900/90 space-y-2">
              <button
                onClick={saveKmlToServer}
                disabled={isSavingToServer}
                className={`w-full py-2.5 px-4 rounded-xl font-extrabold text-xs tracking-wider flex items-center justify-center space-x-2 border shadow-lg transition-all cursor-pointer ${
                  isSavingToServer
                    ? 'bg-emerald-950 text-emerald-400 border-emerald-800 opacity-80 cursor-wait'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 hover:shadow-emerald-950/50 active:scale-[0.98]'
                }`}
              >
                <Save className="w-4 h-4" />
                <span>{isSavingToServer ? 'GUARDANDO CAMBIOS...' : 'GUARDAR CAMBIOS'}</span>
              </button>
              {serverSaveMessage && (
                <div className={`p-2 rounded-lg text-[11px] text-center font-medium ${
                  serverSaveMessage.type === 'success' ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800' : 'bg-rose-950/80 text-rose-300 border border-rose-800'
                }`}>
                  {serverSaveMessage.text}
                </div>
              )}
            </div>

            {/* Sidebar Footer */}
            <div className="p-3 border-t border-[#1e293b] bg-slate-950 text-center text-[10px] text-[#64748b] flex items-center justify-between">
              <span>Gestor de Capas y Distritos</span>
              <span className="font-mono">{activeFeatures.length} polígonos</span>
            </div>
          </aside>
        )}

        {/* RIGHT PANEL: Leaflet Map & Details Overlay */}
        <main className="flex-1 relative flex flex-col min-h-0 bg-[#020617]">
          
          {/* Error Notification */}
          {errorMsg && (
            <div className="absolute top-4 left-4 right-4 z-[999] bg-rose-950/90 border border-rose-800 text-rose-200 px-4 py-3 rounded-xl text-xs flex items-center justify-between shadow-2xl backdrop-blur-md animate-slideDown">
              <span className="font-medium">{errorMsg}</span>
              <button 
                onClick={() => setErrorMsg(null)}
                className="ml-2 font-bold hover:text-white"
              >
                ✕
              </button>
            </div>
          )}

          {/* FLOATING TOP-LEFT COLOR ZONES & SECTIONS WIDGET */}
          {activeFeatures.length > 0 && (
            <div 
              className="absolute top-4 left-4 z-[999] max-w-[200px] xs:max-w-[230px] sm:max-w-[300px] md:max-w-[320px] w-full flex flex-col space-y-1.5 pointer-events-auto"
              onMouseDown={preventMapAction}
              onDoubleClick={preventMapAction}
              onWheel={preventMapAction}
            >
              {/* Main Zone Container */}
              <div className="bg-[#0f172a]/95 border border-[#1e293b] rounded-2xl shadow-2xl backdrop-blur-md p-2 sm:p-3 text-slate-100 transition-all duration-300">
                <div 
                  className="flex items-center justify-between cursor-pointer select-none"
                  onClick={() => setIsColorWidgetCollapsed(!isColorWidgetCollapsed)}
                >
                  <div className="min-w-0 pr-1">
                    <h3 className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1">
                      <span>Brigadas</span>
                      <ChevronDown className={`w-3 h-3 sm:w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${isColorWidgetCollapsed ? '' : 'rotate-180'}`} />
                    </h3>
                    {!isColorWidgetCollapsed && (
                      <p className="text-[8px] sm:text-[10px] text-slate-400 truncate">Ver secciones por brigada</p>
                    )}
                  </div>
                  <div className="flex items-center space-x-1.5 flex-shrink-0">
                    {isColorWidgetCollapsed ? (
                      <div className="flex -space-x-1 overflow-hidden">
                        {colorGroups.slice(0, 4).map(group => (
                          <span 
                            key={group.color}
                            className="w-2 h-2 rounded-full border border-slate-900 inline-block shadow-sm"
                            style={{ backgroundColor: group.color }}
                          />
                        ))}
                        {colorGroups.length > 4 && (
                          <span className="text-[8px] font-semibold text-slate-400 pl-1 leading-none self-center">
                            +{colorGroups.length - 4}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[8px] sm:text-[10px] font-mono bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">
                        {colorGroups.length} {colorGroups.length === 1 ? 'Brigada' : 'Brigadas'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Collapsible Body with Smooth Transition */}
                <div className={`transition-all duration-300 overflow-hidden ${isColorWidgetCollapsed ? 'max-h-0 mt-0 opacity-0' : 'max-h-[350px] sm:max-h-[420px] mt-2 pt-2 border-t border-slate-800 opacity-100'}`}>
                  {selectedColorGroup === null ? (
                    // List of existing color zones
                    <div className="grid grid-cols-1 gap-1 sm:gap-2 max-h-52 overflow-y-auto custom-scrollbar pr-0.5">
                      {colorGroups.map(group => {
                        return (
                          <button
                            key={group.key}
                            onClick={() => {
                              setSelectedColorGroup(group.key);
                              setGroupSearchQuery('');
                            }}
                            className="w-full flex items-center justify-between p-1.5 sm:p-2 rounded-lg sm:rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900/50 hover:bg-slate-900 transition text-left group cursor-pointer"
                          >
                            <div className="flex items-center space-x-1.5 sm:space-x-2.5 min-w-0">
                              <span 
                                className="w-2.5 h-2.5 sm:w-3.5 h-3.5 rounded-full border border-white/20 flex-shrink-0 shadow-sm"
                                style={{ backgroundColor: group.color }}
                              />
                              <div className="min-w-0">
                                <p className="text-[10px] sm:text-xs font-semibold text-slate-200 group-hover:text-white truncate">
                                  {group.friendlyName}
                                </p>
                                <p className="text-[8px] sm:text-[10px] text-slate-400 leading-none mt-0.5">
                                  {group.features.length} {group.features.length === 1 ? 'sección' : 'secciones'}
                                </p>
                              </div>
                            </div>
                            <ChevronRight className="w-3 h-3 sm:w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 transition" />
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    // Expanded Color Group Detail with sections dropdown list
                    <div className="flex flex-col space-y-1.5 sm:space-y-2">
                      {/* Header back button */}
                      <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                        <button
                          onClick={() => {
                            setSelectedColorGroup(null);
                            setGroupSearchQuery('');
                          }}
                          className="flex items-center text-[8px] sm:text-[10px] font-bold text-blue-400 hover:text-blue-300 transition uppercase tracking-wider cursor-pointer"
                        >
                          <ArrowLeft className="w-3 h-3 sm:w-3.5 h-3.5 mr-1" /> Atrás
                        </button>
                        
                        {(() => {
                          const activeGrp = colorGroups.find(g => g.key === selectedColorGroup || g.color === selectedColorGroup);
                          return (
                            <div className="flex items-center space-x-1 sm:space-x-1.5">
                              <span 
                                className="w-2 h-2 sm:w-2.5 h-2.5 rounded-full border border-white/20 shadow-sm"
                                style={{ backgroundColor: activeGrp?.color || '#3b82f6' }}
                              />
                              <span className="text-[9px] sm:text-[10px] font-semibold text-slate-300 max-w-[90px] sm:max-w-[120px] truncate">
                                {activeGrp?.friendlyName || 'Brigada'}
                              </span>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Search filter within this color zone */}
                      <div className="relative">
                        <Search className="absolute left-2 top-2 h-3 w-3 sm:h-3.5 sm:w-3.5 text-slate-500" />
                        <input
                          type="text"
                          placeholder="Buscar sección..."
                          value={groupSearchQuery}
                          onChange={(e) => setGroupSearchQuery(e.target.value)}
                          className="w-full pl-6 pr-2 py-1 bg-slate-900 border border-slate-800 focus:border-slate-700 rounded-md sm:rounded-lg text-[10px] sm:text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                        />
                        {groupSearchQuery && (
                          <button
                            onClick={() => setGroupSearchQuery('')}
                            className="absolute right-2 top-1 text-slate-500 hover:text-slate-300 text-[10px] font-bold px-1"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      {/* Scrollable List of Sections */}
                      <div className="max-h-36 sm:max-h-52 overflow-y-auto divide-y divide-slate-800/40 custom-scrollbar pr-0.5">
                        {(() => {
                          const currentGroup = colorGroups.find(g => g.key === selectedColorGroup || g.color === selectedColorGroup);
                          if (!currentGroup) return null;

                          const matchedFeatures = currentGroup.features.filter(f => {
                            const secVal = getSeccionValue(f);
                            if (!groupSearchQuery) return true;
                            return (secVal && secVal.toLowerCase().includes(groupSearchQuery.toLowerCase())) ||
                                   (f.name && f.name.toLowerCase().includes(groupSearchQuery.toLowerCase()));
                          });

                          if (matchedFeatures.length === 0) {
                            return (
                              <div className="py-4 text-center text-[9px] sm:text-[10px] text-slate-500">
                                No se encontraron secciones.
                              </div>
                            );
                          }

                          return matchedFeatures.map(f => {
                            const secVal = getSeccionValue(f);
                            const isSelected = selectedFeature?.id === f.id;
                            return (
                              <button
                                key={f.id}
                                onClick={() => {
                                  setSelectedFeature(f);
                                  setFitBoundsTrigger(prev => prev + 1);
                                  setIsColorWidgetCollapsed(true); // Automatically collapse widget on click to keep screen clean!
                                  setIsDetailsCollapsed(false); // Let it expand because asymmetrical padding will prevent covering!
                                }}
                                className={`w-full flex items-center justify-between p-1 sm:p-1.5 text-left transition rounded-md text-[10px] sm:text-xs ${
                                  isSelected 
                                    ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30 font-semibold' 
                                    : 'hover:bg-slate-900 text-slate-300 hover:text-slate-100'
                                }`}
                              >
                                <div className="flex items-center space-x-1.5 sm:space-x-2 min-w-0">
                                  <MapPin className={`w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0 ${isSelected ? 'text-blue-400' : 'text-slate-500'}`} />
                                  <div className="min-w-0">
                                    <p className="truncate font-medium">{f.name || `Sección ${secVal}`}</p>
                                    {secVal && secVal !== f.name && (
                                      <p className="text-[8px] sm:text-[9px] text-slate-500 leading-none mt-0.5">Sección: {secVal}</p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center space-x-1 flex-shrink-0">
                                  <span className="text-[8px] font-mono px-1 py-0.2 bg-slate-800 rounded text-slate-400 border border-slate-700/50">
                                    {f.geometryType === 'Polygon' ? 'Poli' : 'Punto'}
                                  </span>
                                </div>
                              </button>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Floating Map Controls overlay */}
          <div className="absolute top-4 right-4 z-[999] flex flex-col space-y-2">
            <div className="bg-[#0f172a]/95 border border-[#1e293b] rounded-xl p-1.5 shadow-2xl backdrop-blur-md flex items-center space-x-1">
              <span className="text-[9px] font-bold text-slate-400 px-1.5">MAPA:</span>
              <button
                onClick={() => setMapBase('streets')}
                className={`px-2 py-1 rounded text-[10px] font-bold transition ${
                  mapBase === 'streets' 
                    ? 'bg-blue-600 text-white shadow' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                CALLES
              </button>
              <button
                onClick={() => setMapBase('satellite')}
                className={`px-2 py-1 rounded text-[10px] font-bold transition ${
                  mapBase === 'satellite' 
                    ? 'bg-blue-600 text-white shadow' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                SATELITAL
              </button>
              <button
                onClick={() => setMapBase('dark')}
                className={`px-2 py-1 rounded text-[10px] font-bold transition ${
                  mapBase === 'dark' 
                    ? 'bg-blue-600 text-white shadow' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                OSCURO
              </button>
            </div>
          </div>

          {/* Leaflet Map container */}
          <div className="w-full h-full min-h-[350px] z-0">
            <MapContainer
              center={[19.7025, -101.1923]}
              zoom={13}
              scrollWheelZoom={true}
              zoomControl={false}
              style={{ width: '100%', height: '100%', background: '#020617' }}
            >
              {/* Dynamic Map Base Tile Layer */}
              {mapBase === 'streets' ? (
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  maxZoom={19}
                />
              ) : mapBase === 'satellite' ? (
                <TileLayer
                  attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  maxZoom={19}
                />
              ) : (
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />
              )}

              {/* Positioned ZoomControl to stay clear of top-left floating card */}
              <ZoomControl position="bottomright" />

              {/* Map Reactive bounds controller */}
              <MapController 
                selectedFeature={selectedFeature} 
                fitBoundsTrigger={fitBoundsTrigger}
                allFeatures={filteredFeatures}
                fitAllTrigger={fitAllTrigger}
              />

              {/* Render vector features */}
              {filteredFeatures.flatMap(f => {
                if (!f) return [];
                const style = getFeatureStyle(f);
                const sectionVal = getSeccionValue(f);

                // Polygons
                if (f.geometryType === 'Polygon') {
                  return f.polygons.map((polyPaths, pIdx) => {
                    // Leaflet expects [lat, lng][][] for polygon outer boundaries and holes
                    const leafletPaths: L.LatLngTuple[][] = polyPaths.map(path => 
                      path.map(pt => [pt.lat, pt.lng])
                    );

                    return (
                      <SafePolygon
                        key={`${f.id}-poly-${pIdx}`}
                        positions={leafletPaths}
                        pathOptions={{
                          fillColor: style.fillColor,
                          fillOpacity: style.fillOpacity,
                          color: style.color,
                          weight: style.weight
                        }}
                        eventHandlers={{
                          click: () => {
                            setSelectedFeature(f);
                            setFitBoundsTrigger(prev => prev + 1);
                          }
                        }}
                        sectionVal={sectionVal}
                      />
                    );
                  });
                }

                // LineStrings
                if (f.geometryType === 'LineString') {
                  return f.lineStrings.map((path, lIdx) => {
                    const leafletPath: L.LatLngTuple[] = path.map(pt => [pt.lat, pt.lng]);
                    return (
                      <Polyline
                        key={`${f.id}-line-${lIdx}`}
                        positions={leafletPath}
                        pathOptions={{
                          color: style.color,
                          weight: style.weight
                        }}
                        eventHandlers={{
                          click: () => {
                            setSelectedFeature(f);
                            setFitBoundsTrigger(prev => prev + 1);
                          }
                        }}
                      />
                    );
                  });
                }

                // Points rendered as nice glowing circle markers
                if (f.geometryType === 'Point') {
                  return f.points.map((pt, ptIdx) => (
                    <CircleMarker
                      key={`${f.id}-pt-${ptIdx}`}
                      center={[pt.lat, pt.lng]}
                      radius={selectedFeature?.id === f.id ? 8 : 5}
                      pathOptions={{
                        fillColor: style.color,
                        fillOpacity: 0.9,
                        color: '#ffffff',
                        weight: selectedFeature?.id === f.id ? 2 : 1
                      }}
                      eventHandlers={{
                        click: () => {
                          setSelectedFeature(f);
                          setFitBoundsTrigger(prev => prev + 1);
                        }
                      }}
                    />
                  ));
                }

                return [];
              })}
            </MapContainer>
          </div>
        </main>
      </div>

      {/* MODAL: Assign Uploaded KML to District & Brigade */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Upload className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-sm">Vincular Archivo KML</h3>
              </div>
              <button 
                onClick={() => setUploadModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
              <p className="text-[10px] uppercase font-bold text-slate-500">Archivo detectado:</p>
              <p className="text-xs font-bold text-blue-300 truncate">{pendingFileName}</p>
            </div>

            {/* Select Target District */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300">1. Selecciona el Distrito Destino:</label>
              <div className="grid grid-cols-2 gap-2">
                {districts.map(dist => (
                  <button
                    key={dist.id}
                    onClick={() => setTargetDistrictId(dist.id)}
                    className={`p-2.5 rounded-xl border text-xs text-left font-bold transition flex items-center space-x-2 cursor-pointer ${
                      targetDistrictId === dist.id 
                        ? 'bg-blue-600/20 border-blue-500 text-white' 
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: dist.color }}></span>
                    <span>{dist.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Select Brigade */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300">2. Asignar a Brigada:</label>
              <div className="grid grid-cols-3 gap-1.5">
                {['Brigada 1', 'Brigada 2', 'Brigada 3', 'Brigada 4', 'Brigada 5', 'General'].map(bName => (
                  <button
                    key={bName}
                    onClick={() => {
                      setTargetBrigade(bName);
                      setCustomBrigadeInput('');
                    }}
                    className={`py-2 px-2 rounded-lg border text-[10px] font-bold transition text-center cursor-pointer ${
                      targetBrigade === bName && !customBrigadeInput 
                        ? 'bg-blue-600 text-white border-blue-500' 
                        : 'bg-slate-950 text-slate-400 border-slate-850 hover:text-slate-200'
                    }`}
                  >
                    {bName}
                  </button>
                ))}
              </div>

              <div className="pt-1">
                <input
                  type="text"
                  placeholder="O escribe otra Brigada (ej. Brigada Especial)..."
                  value={customBrigadeInput}
                  onChange={(e) => setCustomBrigadeInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end space-x-2 border-t border-slate-800">
              <button
                onClick={() => setUploadModalOpen(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={confirmKmlUpload}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition flex items-center space-x-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Confirmar e Importar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Create New District */}
      {newDistrictModalOpen && (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Plus className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-sm">Agregar Nuevo Distrito</h3>
              </div>
              <button 
                onClick={() => setNewDistrictModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300">Nombre del Distrito:</label>
                <input
                  type="text"
                  placeholder="ej. Distrito 11, Distrito 12..."
                  value={newDistrictNameInput}
                  onChange={(e) => setNewDistrictNameInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 outline-none focus:border-purple-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300">Color Distintivo:</label>
                <div className="flex items-center space-x-2">
                  <input
                    type="color"
                    value={newDistrictColorInput}
                    onChange={(e) => setNewDistrictColorInput(e.target.value)}
                    className="w-8 h-8 rounded border-0 bg-transparent cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-400">{newDistrictColorInput}</span>
                </div>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end space-x-2 border-t border-slate-800">
              <button
                onClick={() => setNewDistrictModalOpen(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateDistrict}
                disabled={!newDistrictNameInput.trim()}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition flex items-center space-x-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Crear Distrito</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
