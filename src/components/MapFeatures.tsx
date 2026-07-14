/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';

interface MapPolygonProps {
  paths: google.maps.LatLngLiteral[][];
  options?: google.maps.PolygonOptions;
  onClick?: (e: google.maps.MapMouseEvent) => void;
  key?: string | number;
}

export function MapPolygon({ paths, options, onClick }: MapPolygonProps) {
  const map = useMap();
  const polygonRef = useRef<google.maps.Polygon | null>(null);

  // Keep options up to date without destroying/recreating the polygon if possible
  useEffect(() => {
    if (polygonRef.current) {
      polygonRef.current.setOptions(options || {});
    }
  }, [options]);

  useEffect(() => {
    if (!map) return;

    const polygon = new google.maps.Polygon({
      paths,
      ...options,
    });

    polygon.setMap(map);
    polygonRef.current = polygon;

    let listener: google.maps.MapsEventListener | null = null;
    if (onClick) {
      listener = google.maps.event.addListener(polygon, 'click', (e: google.maps.MapMouseEvent) => {
        onClick(e);
      });
    }

    return () => {
      if (listener) {
        google.maps.event.removeListener(listener);
      }
      polygon.setMap(null);
      polygonRef.current = null;
    };
  }, [map, paths, onClick]);

  return null;
}

interface MapPolylineProps {
  path: google.maps.LatLngLiteral[];
  options?: google.maps.PolylineOptions;
  onClick?: (e: google.maps.MapMouseEvent) => void;
  key?: string | number;
}

export function MapPolyline({ path, options, onClick }: MapPolylineProps) {
  const map = useMap();
  const polylineRef = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (polylineRef.current) {
      polylineRef.current.setOptions(options || {});
    }
  }, [options]);

  useEffect(() => {
    if (!map) return;

    const polyline = new google.maps.Polyline({
      path,
      ...options,
    });

    polyline.setMap(map);
    polylineRef.current = polyline;

    let listener: google.maps.MapsEventListener | null = null;
    if (onClick) {
      listener = google.maps.event.addListener(polyline, 'click', (e: google.maps.MapMouseEvent) => {
        onClick(e);
      });
    }

    return () => {
      if (listener) {
        google.maps.event.removeListener(listener);
      }
      polyline.setMap(null);
      polylineRef.current = null;
    };
  }, [map, path, onClick]);

  return null;
}
