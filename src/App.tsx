/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  MapContainer, 
  TileLayer, 
  Polygon, 
  Polyline, 
  CircleMarker, 
  useMap,
  Tooltip
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
  Sliders,
  Sparkles,
  FileText,
  User,
  LogOut,
  ChevronDown,
  Shield
} from 'lucide-react';
import { parseKml } from './utils/kmlParser';
import { KmlDocument, KmlFeature } from './types';
import { SAMPLES } from './data/samples';
import { getKmlFromFirestore, saveKmlToFirestore } from './lib/firebase';

// Redefine Leaflet Default Icon behaviors to prevent path resolution bugs in dev servers
// Even though we mostly use elegant vector elements (CircleMarker, Polyline, Polygon), it's good practice.
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
  // 1. Check feature.properties keys first using keys containing 'seccion' or similar
  for (const [key, value] of Object.entries(feature.properties)) {
    if (isSeccionKey(key)) {
      const normVal = normalizeVal(value);
      if (normVal) return normVal;
    }
  }

  // 2. Try any property value that matches one of our allowed sections exactly when normalized
  for (const value of Object.values(feature.properties)) {
    const normVal = normalizeVal(value);
    if (ALLOWED_SECCIONES.includes(normVal)) {
      return normVal;
    }
  }

  // 3. Scan feature.name for any number that is in ALLOWED_SECCIONES
  if (feature.name) {
    const numbers = feature.name.match(/\d+/g);
    if (numbers) {
      for (const num of numbers) {
        const norm = normalizeVal(num);
        if (ALLOWED_SECCIONES.includes(norm)) {
          return norm;
        }
      }
    }
  }

  // 4. Scan feature.description for any number that is in ALLOWED_SECCIONES
  if (feature.description) {
    const numbers = feature.description.match(/\d+/g);
    if (numbers) {
      for (const num of numbers) {
        const norm = normalizeVal(num);
        if (ALLOWED_SECCIONES.includes(norm)) {
          return norm;
        }
      }
    }
  }

  // 5. Scan any other property string value for numbers that are in ALLOWED_SECCIONES
  for (const value of Object.values(feature.properties)) {
    const text = String(value);
    const numbers = text.match(/\d+/g);
    if (numbers) {
      for (const num of numbers) {
        const norm = normalizeVal(num);
        if (ALLOWED_SECCIONES.includes(norm)) {
          return norm;
        }
      }
    }
  }

  // 6. Generic name or description extraction fallback
  const fromName = extractSeccionFromNameOrDesc(feature.name);
  if (fromName) return fromName;

  const fromDesc = extractSeccionFromNameOrDesc(feature.description);
  if (fromDesc) return fromDesc;

  return null;
};

// Check if feature matches Seccion filter
const isFeatureAllowed = (feature: KmlFeature): boolean => {
  const sec = getSeccionValue(feature);
  if (!sec) return false;
  return ALLOWED_SECCIONES.includes(sec);
};

export default function App() {
  const [kmlDoc, setKmlDoc] = useState<KmlDocument | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<KmlFeature | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [fitBoundsTrigger, setFitBoundsTrigger] = useState(0);
  const [fitAllTrigger, setFitAllTrigger] = useState(0);
  
  // Custom coloring options
  const [coloringMode, setColoringMode] = useState<'kml' | 'random' | 'property'>('kml');
  const [colorByProperty, setColorByProperty] = useState<string>('');
  const [randomColors, setRandomColors] = useState<Record<string, string>>({});

  // Error handling
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Special section filter active by default
  const [filterSeccionesActive, setFilterSeccionesActive] = useState(true);

  // Map Base Tile (Satellite by default, as requested by the user)
  const [mapBase, setMapBase] = useState<'satellite' | 'dark'>('satellite');

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

  // Load default sample or persisted KML on mount
  useEffect(() => {
    const initKml = async () => {
      // 1. Try Firestore first
      try {
        console.log("Intentando cargar KML desde Firebase Firestore...");
        const firestoreKml = await getKmlFromFirestore();
        if (firestoreKml) {
          console.log("¡Cargado KML exitosamente desde Firestore!");
          loadSampleKml(firestoreKml, false);
          return;
        }
      } catch (fErr) {
        console.warn("No se pudo conectar a Firestore (o no existe documento aún):", fErr);
      }

      // 2. Try Node Express backend API fallback
      try {
        console.log("Intentando cargar KML desde el servidor API local...");
        const res = await fetch('/api/kml');
        const data = await res.json();
        if (data.success && data.kml) {
          console.log("Cargando KML permanente desde el servidor local");
          loadSampleKml(data.kml, false);
          return;
        }
      } catch (err) {
        console.warn("Error fetching KML from local API server:", err);
      }

      // 3. Try LocalStorage or SAMPLES fallback
      const savedKml = localStorage.getItem('persisted_kml_content');
      if (savedKml && !savedKml.includes('Secciones de Prueba México') && !savedKml.includes('Sección de Prueba 1234')) {
        loadSampleKml(savedKml, false);
      } else {
        loadSampleKml(SAMPLES[0].content, false);
      }
    };

    initKml();
  }, []);

  const saveKmlToServer = async () => {
    if (!kmlDoc) return;
    setIsSavingToServer(true);
    setServerSaveMessage(null);
    try {
      const kmlText = localStorage.getItem('persisted_kml_content');
      if (!kmlText) {
        setServerSaveMessage({ type: 'error', text: 'No se encontró el texto KML en caché local para guardar.' });
        setIsSavingToServer(false);
        return;
      }

      // 1. Save to Firebase Firestore (Primary)
      let firestoreSuccess = false;
      try {
        await saveKmlToFirestore(kmlText, currentUser?.email || 'admin');
        firestoreSuccess = true;
      } catch (fErr: any) {
        console.error("Error saving to Firestore:", fErr);
      }

      // 2. Save to Express server (as fallback/dual-write if server is active)
      let serverSuccess = false;
      try {
        const res = await fetch('/api/kml', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ kmlText })
        });
        const data = await res.json();
        if (data.success) {
          serverSuccess = true;
        }
      } catch (sErr) {
        console.warn("Express server save skipped or failed (common on static Hosting):", sErr);
      }

      if (firestoreSuccess) {
        setServerSaveMessage({ 
          type: 'success', 
          text: '¡Guardado permanentemente en la Base de Datos de Firebase!' 
        });
      } else if (serverSuccess) {
        setServerSaveMessage({ 
          type: 'success', 
          text: '¡Guardado con éxito en el servidor de forma permanente!' 
        });
      } else {
        setServerSaveMessage({ 
          type: 'error', 
          text: 'No se pudo guardar en Firebase ni en el servidor. Verifica las reglas de Firestore.' 
        });
      }
    } catch (err: any) {
      setServerSaveMessage({ type: 'error', text: 'Error de red al intentar guardar.' });
    } finally {
      setIsSavingToServer(false);
      // Auto-clear message after 6 seconds
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

  // Active features list based on Seccion filter
  const activeFeatures = kmlDoc?.features.filter(f => {
    if (filterSeccionesActive && hasSeccionProperties) {
      return isFeatureAllowed(f);
    }
    return true;
  }) || [];

  // Extract all unique ExtendedData keys from active features to allow categorization
  const getExtendedDataKeys = (): string[] => {
    if (!kmlDoc) return [];
    const keysSet = new Set<string>();
    activeFeatures.forEach(f => {
      Object.keys(f.properties).forEach(k => keysSet.add(k));
    });
    return Array.from(keysSet);
  };

  const extendedKeys = getExtendedDataKeys();

  // If coloring by property is selected, find all unique values of that property to generate hues
  const getUniquePropertyValues = (propKey: string): string[] => {
    if (!kmlDoc || !propKey) return [];
    const valuesSet = new Set<string>();
    activeFeatures.forEach(f => {
      if (f.properties[propKey]) {
        valuesSet.add(f.properties[propKey]);
      }
    });
    return Array.from(valuesSet);
  };

  const propertyUniqueValues = colorByProperty ? getUniquePropertyValues(colorByProperty) : [];

  // Get style configs for Leaflet vectors based on active color modes
  const getFeatureStyle = (feature: KmlFeature) => {
    const isSelected = selectedFeature?.id === feature.id;

    // Specific brown sections requested by the user: 2802, 2804, 2805, 1008
    const secVal = getSeccionValue(feature);
    const isBrownSection = secVal && ['2802', '2804', '2805', '1008'].includes(secVal);

    if (isBrownSection) {
      const brownFill = '#8B4513'; // SaddleBrown
      const brownBorder = '#5C2E0B'; // Dark Brown
      return {
        fillColor: brownFill,
        fillOpacity: isSelected ? 0.75 : 0.45,
        color: isSelected ? '#ffffff' : brownBorder,
        weight: isSelected ? 4 : 2.5
      };
    }

    // Specific green sections requested by the user: 1145, 1148, 1149, 1151, 1152, 1153, 1161, 2809, 2810, 2811, 2814, 2815, 2776, 1047
    const isGreenSection = secVal && [
      '1145', '1148', '1149', '1151', '1152', '1153', '1161', 
      '2809', '2810', '2811', '2814', '2815', '2776', '1047'
    ].includes(secVal);

    if (isGreenSection) {
      const greenFill = '#16a34a'; // Emerald/Green 600
      const greenBorder = '#15803d'; // Darker Green
      return {
        fillColor: greenFill,
        fillOpacity: isSelected ? 0.75 : 0.45,
        color: isSelected ? '#ffffff' : greenBorder,
        weight: isSelected ? 4 : 2.5
      };
    }

    // Specific red sections requested by the user: 2729, 1211, 1019, 2721
    const isRedSection = secVal && [
      '2729', '1211', '1019', '2721'
    ].includes(secVal);

    if (isRedSection) {
      const redFill = '#dc2626'; // Red 600
      const redBorder = '#991b1b'; // Darker Red
      return {
        fillColor: redFill,
        fillOpacity: isSelected ? 0.75 : 0.45,
        color: isSelected ? '#ffffff' : redBorder,
        weight: isSelected ? 4 : 2.5
      };
    }

    // Specific blue sections requested by the user: 1022, 1210, 2748
    const isBlueSection = secVal && [
      '1022', '1210', '2748'
    ].includes(secVal);

    if (isBlueSection) {
      const blueFill = '#2563eb'; // Blue 600
      const blueBorder = '#1d4ed8'; // Darker Blue
      return {
        fillColor: blueFill,
        fillOpacity: isSelected ? 0.75 : 0.45,
        color: isSelected ? '#ffffff' : blueBorder,
        weight: isSelected ? 4 : 2.5
      };
    }

    // Specific purple sections requested by the user: 1052, 1060, 1061, 1141, 1142
    const isPurpleSection = secVal && [
      '1052', '1060', '1061', '1141', '1142'
    ].includes(secVal);

    if (isPurpleSection) {
      const purpleFill = '#9333ea'; // Purple 600
      const purpleBorder = '#6b21a8'; // Darker Purple
      return {
        fillColor: purpleFill,
        fillOpacity: isSelected ? 0.75 : 0.45,
        color: isSelected ? '#ffffff' : purpleBorder,
        weight: isSelected ? 4 : 2.5
      };
    }

    if (coloringMode === 'random') {
      const color = randomColors[feature.id] || '#3b82f6';
      return {
        fillColor: color,
        fillOpacity: isSelected ? 0.65 : 0.35,
        color: isSelected ? '#ffffff' : color,
        weight: isSelected ? 3.5 : 2
      };
    }

    if (coloringMode === 'property' && colorByProperty) {
      const val = feature.properties[colorByProperty];
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

    // Default: Red color as requested by the user for perfect contrast on satellite map
    const redColor = '#ef4444';
    return {
      fillColor: redColor,
      fillOpacity: isSelected ? 0.7 : 0.4,
      color: isSelected ? '#ffffff' : '#b91c1c',
      weight: isSelected ? 4 : 2.5
    };
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
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        loadSampleKml(text);
      }
    };
    reader.onerror = () => {
      setErrorMsg('Error al leer el archivo KML.');
    };
    reader.readAsText(file);
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
    const query = searchQuery.toLowerCase();
    const matchesName = f.name.toLowerCase().includes(query);
    const matchesDesc = f.description.toLowerCase().includes(query);
    const matchesProps = Object.entries(f.properties).some(([k, v]) => 
      k.toLowerCase().includes(query) || String(v).toLowerCase().includes(query)
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
  const isAdmin = currentUser?.email.trim().toLowerCase() === 'hugocesarlemuscortes@gmail.com';

  return (
    <div className="h-screen w-screen flex flex-col bg-[#050505] text-[#e2e8f0] overflow-hidden font-sans">
      
      {/* Elegant Header */}
      <header className="h-[60px] bg-[#0f172a] border-b border-[#1e293b] flex items-center px-6 justify-between flex-shrink-0 z-20">
        <div className="flex items-center">
          <span className="font-extrabold tracking-tight text-red-500 text-lg">HC.MAP</span>
          <span className="ml-3 text-[#475569] text-xs font-semibold px-2 py-0.5 bg-slate-950/45 rounded border border-slate-800/40">Visor de Capas</span>
        </div>
        
        {/* Google Authentication Account Profile Selector */}
        <div className="relative">
          {currentUser ? (
            <button
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex items-center space-x-2.5 bg-slate-950/50 hover:bg-slate-900/80 border border-slate-800 rounded-full py-1.5 pl-2.5 pr-3.5 transition select-none cursor-pointer"
            >
              <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white uppercase shadow-inner">
                {currentUser.avatar || currentUser.email[0]}
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-[11px] font-bold text-slate-200 leading-tight">
                  {currentUser.name}
                </p>
                <p className="text-[9px] text-slate-400 font-mono leading-none">
                  {currentUser.email}
                </p>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>
          ) : (
            <button
              onClick={() => {
                const u = { email: 'hugocesarlemuscortes@gmail.com', name: 'Hugo César Lemus', avatar: 'H' };
                setCurrentUser(u);
                localStorage.setItem('google_user', JSON.stringify(u));
              }}
              className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-2 px-3.5 rounded-full transition shadow-lg cursor-pointer"
            >
              <User className="w-3.5 h-3.5" />
              <span>Acceder con Google</span>
            </button>
          )}

          {/* Google Style Profile Dropdown menu */}
          {isProfileOpen && currentUser && (
            <div className="absolute right-0 mt-2 w-72 bg-[#0f172a] border border-[#1e293b] rounded-2xl shadow-2xl p-4 z-50 animate-fadeIn backdrop-blur-md">
              <div className="flex flex-col items-center text-center pb-3 border-b border-slate-800">
                <div className="w-12 h-12 rounded-full bg-blue-600 text-lg font-bold text-white flex items-center justify-center mb-2 uppercase shadow">
                  {currentUser.avatar || currentUser.email[0]}
                </div>
                <h4 className="text-sm font-bold text-slate-100">{currentUser.name}</h4>
                <p className="text-xs text-slate-400 font-mono">{currentUser.email}</p>
                
                {isAdmin ? (
                  <span className="mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    <Shield className="w-2.5 h-2.5 mr-1" />
                    ADMINISTRADOR (Google)
                  </span>
                ) : (
                  <span className="mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                    <User className="w-2.5 h-2.5 mr-1" />
                    USUARIO NORMAL
                  </span>
                )}
              </div>

              {/* Account Quick Switch */}
              <div className="py-3 space-y-2 border-b border-slate-800">
                <p className="text-[9px] uppercase font-bold text-slate-500 tracking-wider text-left">Cambiar cuenta para pruebas:</p>
                
                {/* Admin account */}
                <button
                  onClick={() => {
                    const u = { email: 'hugocesarlemuscortes@gmail.com', name: 'Hugo César Lemus Cortés', avatar: 'H' };
                    setCurrentUser(u);
                    localStorage.setItem('google_user', JSON.stringify(u));
                    setIsProfileOpen(false);
                  }}
                  className={`w-full flex items-center justify-between p-2 rounded-xl text-left transition text-xs cursor-pointer ${
                    isAdmin 
                      ? 'bg-blue-600/10 border border-blue-500/30 text-white font-semibold' 
                      : 'hover:bg-slate-900 border border-transparent text-slate-300'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <span className="w-5 h-5 rounded-full bg-rose-600 text-white font-bold text-[10px] flex items-center justify-center">H</span>
                    <div className="min-w-0">
                      <p className="leading-tight truncate">hugocesarlemuscortes@gmail.com</p>
                      <p className="text-[9px] text-slate-400 font-mono">Administrador</p>
                    </div>
                  </div>
                </button>

                {/* Normal account */}
                <button
                  onClick={() => {
                    const u = { email: 'bunkerhrv@gmail.com', name: 'Bunker HRV', avatar: 'B' };
                    setCurrentUser(u);
                    localStorage.setItem('google_user', JSON.stringify(u));
                    setIsProfileOpen(false);
                  }}
                  className={`w-full flex items-center justify-between p-2 rounded-xl text-left transition text-xs cursor-pointer ${
                    currentUser.email === 'bunkerhrv@gmail.com' 
                      ? 'bg-blue-600/10 border border-blue-500/30 text-white font-semibold' 
                      : 'hover:bg-slate-900 border border-transparent text-slate-300'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-600 text-white font-bold text-[10px] flex items-center justify-center">B</span>
                    <div className="min-w-0">
                      <p className="leading-tight truncate">bunkerhrv@gmail.com</p>
                      <p className="text-[9px] text-slate-400 font-mono">Usuario Normal</p>
                    </div>
                  </div>
                </button>
              </div>

              {/* Manual Custom Email Form */}
              <div className="py-3 border-b border-slate-800 space-y-2">
                <p className="text-[9px] uppercase font-bold text-slate-500 tracking-wider text-left">Probar con otro correo de Google:</p>
                <div className="flex items-center space-x-1.5">
                  <input
                    type="email"
                    placeholder="ejemplo@gmail.com"
                    value={customEmailInput}
                    onChange={(e) => setCustomEmailInput(e.target.value)}
                    className="flex-1 bg-slate-950 text-xs px-2.5 py-1.5 rounded-lg border border-slate-800 text-slate-200 outline-none focus:border-slate-600"
                  />
                  <button
                    onClick={() => {
                      if (customEmailInput.trim().includes('@')) {
                        const email = customEmailInput.trim().toLowerCase();
                        const isHugo = email === 'hugocesarlemuscortes@gmail.com';
                        const u = { 
                          email, 
                          name: isHugo ? 'Hugo César Lemus Cortés' : email.split('@')[0], 
                          avatar: email[0].toUpperCase() 
                        };
                        setCurrentUser(u);
                        localStorage.setItem('google_user', JSON.stringify(u));
                        setIsProfileOpen(false);
                        setCustomEmailInput('');
                      }
                    }}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg transition cursor-pointer"
                  >
                    Usar
                  </button>
                </div>
              </div>

              <button
                onClick={() => {
                  setCurrentUser(null);
                  localStorage.removeItem('google_user');
                  setIsProfileOpen(false);
                }}
                className="w-full mt-3 flex items-center justify-center space-x-1.5 py-2 text-xs text-slate-400 hover:text-rose-400 bg-slate-900 hover:bg-rose-950/20 rounded-xl transition cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Cerrar sesión de Google</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        
        {/* LEFT PANEL: Controls & Data list */}
        {isAdmin && (
          <aside className="w-full md:w-[320px] flex-shrink-0 border-b md:border-b-0 md:border-r border-[#1e293b] flex flex-col bg-[#0f172a] max-h-[45vh] md:max-h-full">
          
          {/* Sidebar Header */}
          <div className="p-4 border-b border-[#1e293b] flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="p-1.5 bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/20 rounded-lg">
                <MapIcon className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-bold text-slate-100 text-xs tracking-wide">Áreas & Capas</h2>
                <span className="text-[10px] text-[#64748b] font-mono leading-none block">Geometría KML</span>
              </div>
            </div>
            {kmlDoc && (
              <button 
                onClick={() => {
                  setKmlDoc(null);
                  setSelectedFeature(null);
                  localStorage.removeItem('persisted_kml_content');
                  localStorage.removeItem('persisted_kml_name');
                }}
                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 rounded-lg transition"
                title="Cerrar documento actual"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Scrollable content areas */}
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            
            {/* 1. If NO KML file loaded, prompt to load or select sample */}
            {!kmlDoc && (
              <div className="space-y-4">
                <div 
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={triggerFileSelect}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center space-y-3 ${
                    dragActive 
                      ? 'border-blue-500 bg-blue-500/5' 
                      : 'border-slate-800 hover:border-slate-700 hover:bg-slate-800/45'
                  }`}
                >
                  <div className="p-3 bg-slate-800 rounded-full border border-slate-700 text-slate-300">
                    <Upload className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-200">Sube tu archivo KML</p>
                    <p className="text-xs text-[#64748b] mt-1">Arrastra tu archivo aquí o haz clic para subir</p>
                  </div>
                </div>

                <div className="relative flex items-center justify-center my-4">
                  <span className="absolute bg-[#0f172a] px-3 text-[10px] text-slate-500 uppercase tracking-wider font-bold">o carga un ejemplo libre</span>
                  <div className="w-full border-t border-slate-800"></div>
                </div>

                <div className="space-y-2.5">
                  {SAMPLES.map(sample => (
                    <button
                      key={sample.id}
                      onClick={() => loadSampleKml(sample.content, true)}
                      className="w-full text-left p-3 bg-[#1e293b]/50 hover:bg-[#1e293b]/90 border border-slate-800 hover:border-slate-700 rounded-xl transition flex flex-col space-y-1 group"
                    >
                      <span className="text-xs font-semibold text-slate-200 flex items-center justify-between">
                        {sample.name}
                        <Sparkles className="w-3 h-3 text-blue-400 opacity-0 group-hover:opacity-100 transition" />
                      </span>
                      <span className="text-[10px] text-[#94a3b8] line-clamp-2 leading-normal">{sample.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 2. Document details & controls when loaded */}
            {kmlDoc && (
              <div className="space-y-4">
                <div className="p-3 bg-[#1e293b] border border-[#334155] rounded-xl flex items-start space-x-2.5">
                  <FileText className="w-4 h-4 text-[#3b82f6] mt-0.5" />
                  <div className="space-y-0.5 animate-fadeIn">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Documento activo:</p>
                    <h3 className="text-xs font-bold text-slate-200 leading-tight truncate w-56">{kmlDoc.name}</h3>
                    <p className="text-[10px] text-[#94a3b8]">
                      {filterSeccionesActive && hasSeccionProperties 
                        ? `${activeFeatures.length} de ${kmlDoc.features.length} secciones` 
                        : `${kmlDoc.features.length} elementos geográficos.`
                      }
                    </p>
                  </div>
                </div>

                {/* Server persistence option for Admins */}
                {isAdmin && (
                  <div className="bg-blue-950/25 border border-blue-900/40 rounded-xl p-3.5 space-y-2.5 animate-fadeIn">
                    <div className="flex items-center space-x-2">
                      <Database className="w-4 h-4 text-blue-400" />
                      <span className="text-[11px] font-bold text-slate-200 uppercase tracking-wide">Base de Datos Servidor</span>
                    </div>
                    <p className="text-[10px] text-slate-300 leading-normal">
                      Como Administrador, puedes guardar este mapa en el servidor de forma que sea la capa predeterminada para todos los usuarios normales al ingresar.
                    </p>
                    
                    {serverSaveMessage && (
                      <div className={`p-2 rounded text-[10px] font-semibold leading-normal ${
                        serverSaveMessage.type === 'success' 
                          ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/40 animate-pulse' 
                          : 'bg-rose-950/40 text-rose-400 border border-rose-900/40'
                      }`}>
                        {serverSaveMessage.text}
                      </div>
                    )}

                    <button
                      onClick={saveKmlToServer}
                      disabled={isSavingToServer}
                      className="w-full flex items-center justify-center space-x-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-bold py-2 px-3 rounded-lg text-xs transition cursor-pointer select-none"
                    >
                      {isSavingToServer ? (
                        <span>Guardando en el Servidor...</span>
                      ) : (
                        <>
                          <Upload className="w-3.5 h-3.5" />
                          <span>Guardar en el Servidor</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Advanced coloring controls */}
                <div className="bg-[#1e293b]/40 border border-[#334155]/60 rounded-xl p-3.5 space-y-3">
                  <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300">
                    <Sliders className="w-3.5 h-3.5 text-blue-400" />
                    <span>Estilos de Visualización</span>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold text-[#64748b] tracking-wider">Colorear Por</label>
                    <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px]">
                      <button
                        onClick={() => setColoringMode('kml')}
                        className={`py-1 rounded text-center transition font-semibold ${coloringMode === 'kml' ? 'bg-[#3b82f6] text-white' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        Original
                      </button>
                      <button
                        onClick={() => setColoringMode('random')}
                        className={`py-1 rounded text-center transition font-semibold ${coloringMode === 'random' ? 'bg-[#3b82f6] text-white' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        Al Azar
                      </button>
                      <button
                        disabled={extendedKeys.length === 0}
                        onClick={() => setColoringMode('property')}
                        className={`py-1 rounded text-center transition font-semibold ${coloringMode === 'property' ? 'bg-[#3b82f6] text-white' : 'text-slate-400 hover:text-slate-200'} disabled:opacity-30`}
                      >
                        Atributo
                      </button>
                    </div>
                  </div>

                  {coloringMode === 'property' && extendedKeys.length > 0 && (
                    <div className="space-y-1.5 animate-fadeIn">
                      <label className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Seleccionar propiedad:</label>
                      <select
                        value={colorByProperty}
                        onChange={(e) => setColorByProperty(e.target.value)}
                        className="w-full text-xs bg-slate-950 text-slate-200 border border-slate-800 rounded-lg p-2 focus:ring-1 focus:ring-blue-500 outline-none"
                      >
                        {extendedKeys.map(k => (
                          <option key={k} value={k}>{k}</option>
                        ))}
                      </select>

                      {/* Category Legend */}
                      {propertyUniqueValues.length > 0 && (
                        <div className="mt-2 bg-slate-950 border border-slate-900 rounded-lg p-2 max-h-24 overflow-y-auto space-y-1">
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Leyenda ({propertyUniqueValues.length} val.)</p>
                          <div className="space-y-1">
                            {propertyUniqueValues.map((val, idx) => {
                              const total = propertyUniqueValues.length;
                              const hue = total > 1 ? (idx * (360 / total)) : 140;
                              const col = `hsl(${hue}, 75%, 45%)`;
                              return (
                                <div key={val} className="flex items-center space-x-1.5 text-xxs">
                                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: col }}></span>
                                  <span className="text-slate-300 truncate">{val}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 30 Secciones Filter Card */}
                {hasSeccionProperties && (
                  <div className="bg-[#1e293b]/40 border border-[#334155]/60 rounded-xl p-3.5 space-y-2.5 shadow-md animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300">
                        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                        <span>Filtro de Secciones</span>
                      </div>
                      <span className="text-[10px] bg-blue-950/80 text-blue-400 font-extrabold px-1.5 py-0.5 rounded border border-blue-900/30">
                        {activeFeatures.length} / {kmlDoc.features.length}
                      </span>
                    </div>

                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      Se filtran automáticamente los polígonos para mantener visible únicamente las 30 secciones autorizadas.
                    </p>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Filtrar por Lista</span>
                      <button
                        onClick={() => setFilterSeccionesActive(!filterSeccionesActive)}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-md border transition-all ${
                          filterSeccionesActive 
                            ? 'bg-blue-600/20 text-blue-400 border-blue-500/30 hover:bg-blue-600/30' 
                            : 'bg-slate-950 text-slate-500 border-slate-850 hover:text-slate-300'
                        }`}
                      >
                        {filterSeccionesActive ? 'ACTIVO' : 'DESACTIVADO'}
                      </button>
                    </div>

                    {/* Show preview of allowed sections */}
                    {filterSeccionesActive && (
                      <div className="pt-2 border-t border-slate-800/80">
                        <p className="text-[9px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5">Secciones Permitidas (30):</p>
                        <div className="flex flex-wrap gap-1 max-h-[70px] overflow-y-auto pr-1">
                          {ALLOWED_SECCIONES.map(sec => (
                            <span key={sec} className="text-[9px] font-mono px-1.5 py-0.5 bg-slate-950/80 text-[#94a3b8] rounded border border-slate-900/40">
                              {sec}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Upload secondary KML */}
                <div className="flex gap-2">
                  <button
                    onClick={triggerFileSelect}
                    className="flex-1 py-2 px-3 bg-[#1e293b] hover:bg-[#2d3748] border border-[#334155] text-xs font-semibold rounded-lg text-slate-200 transition flex items-center justify-center space-x-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Cargar otro KML</span>
                  </button>
                  <button
                    onClick={() => setFitAllTrigger(prev => prev + 1)}
                    className="py-2 px-3 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-xs font-semibold rounded-lg text-slate-300 transition flex items-center justify-center"
                    title="Ajustar vista a todos los elementos"
                  >
                    <Compass className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* List Search & Features */}
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Buscar áreas o propiedades..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-slate-950 text-xs text-slate-200 border border-slate-850 pl-8 pr-3 py-2 rounded-lg outline-none focus:border-slate-750"
                    />
                  </div>

                  <div className="space-y-1.5 max-h-[22vh] md:max-h-[35vh] overflow-y-auto pr-1">
                    {filteredFeatures.map(f => {
                      const isSelected = selectedFeature?.id === f.id;
                      const style = getFeatureStyle(f);
                      const isPolygon = f.geometryType === 'Polygon';
                      const isLine = f.geometryType === 'LineString';
                      const isPoint = f.geometryType === 'Point';

                      return (
                        <div
                          key={f.id}
                          onClick={() => {
                            setSelectedFeature(f);
                            setFitBoundsTrigger(prev => prev + 1);
                          }}
                          className={`w-full text-left p-2.5 rounded-lg border text-xs transition cursor-pointer flex items-center justify-between group ${
                            isSelected 
                              ? 'bg-[#1e293b] border-[#3b82f6] text-slate-100' 
                              : 'bg-slate-950/45 border-slate-900 hover:border-[#334155] text-slate-300'
                          }`}
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            {/* Color Legend indicator */}
                            <span 
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-black/10" 
                              style={{ 
                                backgroundColor: isPolygon ? style.fillColor : style.color
                              }}
                            ></span>
                            <div className="min-w-0">
                              <p className="font-semibold truncate leading-snug">{f.name}</p>
                              <p className="text-[10px] text-[#64748b] font-mono leading-none mt-0.5">
                                {isPolygon ? 'Polígono' : isLine ? 'Línea' : isPoint ? 'Punto' : 'Desconocido'}
                              </p>
                            </div>
                          </div>

                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFeature(f);
                              setFitBoundsTrigger(prev => prev + 1);
                            }}
                            className="p-1 text-slate-500 hover:text-blue-400 rounded transition opacity-0 group-hover:opacity-100"
                            title="Enfocar en mapa"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}

                    {filteredFeatures.length === 0 && (
                      <div className="p-4 text-center border border-dashed border-slate-800 rounded-lg text-xs text-slate-500">
                        No se encontraron resultados para la búsqueda.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar Footer */}
          <div className="p-3 border-t border-[#1e293b] bg-slate-950 text-center text-[10px] text-[#64748b]">
            Visualizador de Áreas KML · {new Date().getFullYear()}
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

          {/* Floating Map Controls overlay */}
          <div className="absolute top-4 right-4 z-[999] flex flex-col space-y-2">
            <div className="bg-[#0f172a]/95 border border-[#1e293b] rounded-xl p-1.5 shadow-2xl backdrop-blur-md flex items-center space-x-1">
              <span className="text-[9px] font-bold text-slate-400 px-1.5">MAPA:</span>
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
              style={{ width: '100%', height: '100%', background: '#020617' }}
            >
              {/* Dynamic Map Base Tile Layer */}
              {mapBase === 'satellite' ? (
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

              {/* Map Reactive bounds controller */}
              <MapController 
                selectedFeature={selectedFeature} 
                fitBoundsTrigger={fitBoundsTrigger}
                allFeatures={filteredFeatures}
                fitAllTrigger={fitAllTrigger}
              />

              {/* Render vector features */}
              {filteredFeatures.map(f => {
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
                      <Polygon
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
                      >
                        {sectionVal && (
                          <Tooltip 
                            permanent={true} 
                            direction="center" 
                            className="leaflet-tooltip-own"
                          >
                            {sectionVal}
                          </Tooltip>
                        )}
                      </Polygon>
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

                return null;
              })}
            </MapContainer>
          </div>

          {/* Bottom Property Overlay Details Panel */}
          {selectedFeature && (
            <div className="absolute bottom-4 right-4 left-4 md:left-auto md:w-96 max-h-[75%] bg-[#0f172a]/95 border border-[#1e293b] rounded-2xl p-4 shadow-2xl flex flex-col space-y-4 backdrop-blur-md animate-slideUp z-[999] overflow-hidden">
              
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2.5">
                  <span className="p-2 bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/20 rounded-xl">
                    {selectedFeature.geometryType === 'Polygon' ? <Grid className="w-4 h-4" /> : <Database className="w-4 h-4" />}
                  </span>
                  <div>
                    <h3 className="font-bold text-slate-100 text-sm truncate leading-tight w-60">{selectedFeature.name}</h3>
                    <p className="text-[10px] text-slate-400">
                      Tipo de elemento: <span className="font-mono text-blue-400 font-bold">{selectedFeature.geometryType}</span>
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedFeature(null)}
                  className="text-slate-400 hover:text-white transition p-1 bg-slate-800/50 hover:bg-slate-800 rounded-lg"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-0.5">
                
                {/* Description */}
                {selectedFeature.description && (
                  <div className="p-3 bg-slate-950/60 border border-slate-900 rounded-xl text-slate-300 text-xs leading-relaxed max-h-24 overflow-y-auto">
                    <p className="font-bold text-[#64748b] text-[9px] uppercase tracking-wider mb-1 flex items-center space-x-1">
                      <Info className="w-3 h-3 text-blue-400" />
                      <span>Descripción</span>
                    </p>
                    {selectedFeature.description}
                  </div>
                )}

                {/* Calculated geodetic metrics */}
                {metrics && (
                  <div className="grid grid-cols-2 gap-2">
                    {metrics.areaHectares && (
                      <div className="p-2.5 bg-slate-950/40 border border-slate-900 rounded-xl flex flex-col">
                        <span className="text-[9px] text-[#64748b] font-bold uppercase tracking-wider">Área calculada</span>
                        <span className="text-sm font-extrabold text-[#3b82f6] mt-1">{metrics.areaHectares} ha</span>
                        <span className="text-[9px] text-slate-400 font-mono mt-0.5">{metrics.areaSqKm} km²</span>
                      </div>
                    )}
                    {metrics.lengthKm && (
                      <div className="p-2.5 bg-slate-950/40 border border-slate-900 rounded-xl flex flex-col">
                        <span className="text-[9px] text-[#64748b] font-bold uppercase tracking-wider">
                          {selectedFeature.geometryType === 'Polygon' ? 'Perímetro' : 'Longitud'}
                        </span>
                        <span className="text-sm font-extrabold text-[#3b82f6] mt-1">
                          {parseFloat(metrics.lengthKm) < 1.0 ? `${metrics.lengthMeters} m` : `${metrics.lengthKm} km`}
                        </span>
                        <span className="text-[9px] text-slate-400 font-mono mt-0.5">En metros: {metrics.lengthMeters}</span>
                      </div>
                    )}
                    <div className="p-2.5 bg-slate-950/40 border border-slate-900 rounded-xl flex flex-col col-span-2">
                      <span className="text-[9px] text-[#64748b] font-bold uppercase tracking-wider">Complejidad geométrica</span>
                      <span className="text-xs font-semibold text-slate-200 mt-0.5">{metrics.vertices} coordenadas geográficas</span>
                    </div>
                  </div>
                )}

                {/* Attribute viewer */}
                <div className="space-y-2">
                  <p className="text-[9px] font-bold text-[#64748b] uppercase tracking-wider flex items-center space-x-1">
                    <Database className="w-3.5 h-3.5 text-blue-400" />
                    <span>Propiedades del KML ({Object.keys(selectedFeature.properties).length})</span>
                  </p>
                  {Object.keys(selectedFeature.properties).length > 0 ? (
                    <div className="border border-slate-900 rounded-xl overflow-hidden text-xs">
                      <div className="max-h-48 overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-950/80 border-b border-slate-900">
                              <th className="p-2 text-[9px] font-bold text-[#64748b] uppercase">Clave</th>
                              <th className="p-2 text-[9px] font-bold text-[#64748b] uppercase">Valor</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-900">
                            {Object.entries(selectedFeature.properties).map(([key, val]) => (
                              <tr key={key} className="hover:bg-[#1e293b]/40 transition">
                                <td className="p-2 font-mono text-[10px] text-blue-400 font-semibold break-all w-1/3">{key}</td>
                                <td className="p-2 text-slate-300 break-all">{val}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 text-center border border-dashed border-slate-900 rounded-xl text-[10px] text-slate-500">
                      Este elemento no contiene atributos estructurados de metadatos.
                    </div>
                  )}
                </div>
              </div>

              {/* Focus action */}
              <div className="pt-2 border-t border-[#1e293b] flex gap-2">
                <button 
                  onClick={() => setFitBoundsTrigger(prev => prev + 1)}
                  className="flex-1 py-2 px-3 bg-[#3b82f6] hover:bg-blue-500 text-white font-semibold text-xs rounded-lg transition flex items-center justify-center space-x-1.5"
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>Enfocar en Mapa</span>
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
