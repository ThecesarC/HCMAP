import fs from 'fs';
import path from 'path';

function createPolyCoords(centerLat, centerLng, widthLat = 0.004, heightLng = 0.006) {
  const halfW = widthLat / 2;
  const halfH = heightLng / 2;

  const p1 = `${(centerLng - halfH).toFixed(6)},${(centerLat - halfW).toFixed(6)},0`;
  const p2 = `${(centerLng + halfH * 0.9).toFixed(6)},${(centerLat - halfW * 1.1).toFixed(6)},0`;
  const p3 = `${(centerLng + halfH * 1.1).toFixed(6)},${(centerLat + halfW * 0.9).toFixed(6)},0`;
  const p4 = `${(centerLng - halfH * 0.8).toFixed(6)},${(centerLat + halfW * 1.0).toFixed(6)},0`;
  const p5 = p1;

  return `${p1} ${p2} ${p3} ${p4} ${p5}`;
}

const brigada1Secciones = [
  { sec: "1206", lat: 19.7160, lng: -101.2010, w: 0.007, h: 0.008 },
  { sec: "977",  lat: 19.7090, lng: -101.1930, w: 0.005, h: 0.006 },
  { sec: "976",  lat: 19.7065, lng: -101.1910, w: 0.004, h: 0.005 },
  { sec: "978",  lat: 19.7055, lng: -101.1880, w: 0.005, h: 0.006 },
  { sec: "969",  lat: 19.7030, lng: -101.1960, w: 0.005, h: 0.006 },
  { sec: "971",  lat: 19.7010, lng: -101.1920, w: 0.004, h: 0.005 },
  { sec: "987",  lat: 19.6990, lng: -101.1870, w: 0.005, h: 0.006 },
  { sec: "994",  lat: 19.6960, lng: -101.1980, w: 0.005, h: 0.007 },
  { sec: "991",  lat: 19.6980, lng: -101.1930, w: 0.004, h: 0.005 },
  { sec: "992",  lat: 19.6970, lng: -101.1910, w: 0.004, h: 0.005 },
  { sec: "993",  lat: 19.6960, lng: -101.1890, w: 0.004, h: 0.005 },
  { sec: "1001", lat: 19.6940, lng: -101.1950, w: 0.005, h: 0.006 },
  { sec: "1002", lat: 19.6930, lng: -101.1930, w: 0.004, h: 0.005 },
  { sec: "1003", lat: 19.6920, lng: -101.1910, w: 0.004, h: 0.005 },
  { sec: "1004", lat: 19.6910, lng: -101.1890, w: 0.004, h: 0.005 },
];

const brigada2Secciones = [
  { sec: "979",  lat: 19.7130, lng: -101.1850, w: 0.006, h: 0.007 },
  { sec: "980",  lat: 19.7140, lng: -101.1800, w: 0.006, h: 0.008 },
  { sec: "981",  lat: 19.7100, lng: -101.1810, w: 0.005, h: 0.007 },
  { sec: "982",  lat: 19.7060, lng: -101.1820, w: 0.005, h: 0.006 },
  { sec: "983",  lat: 19.7050, lng: -101.1760, w: 0.006, h: 0.008 },
  { sec: "984",  lat: 19.7220, lng: -101.1550, w: 0.012, h: 0.025 },
  { sec: "985",  lat: 19.7000, lng: -101.1800, w: 0.006, h: 0.008 },
  { sec: "1109", lat: 19.6800, lng: -101.1680, w: 0.006, h: 0.008 },
  { sec: "1110", lat: 19.6780, lng: -101.1650, w: 0.005, h: 0.007 },
  { sec: "1111", lat: 19.6760, lng: -101.1620, w: 0.005, h: 0.007 },
  { sec: "1112", lat: 19.6740, lng: -101.1600, w: 0.005, h: 0.007 },
  { sec: "1113", lat: 19.6720, lng: -101.1580, w: 0.005, h: 0.007 },
];

function buildPlacemarks(docTitle, secciones, colorHex) {
  return secciones.map(s => `
    <Placemark>
      <name>Sección ${s.sec}</name>
      <description>Sección electoral ${s.sec} - ${docTitle}</description>
      <ExtendedData>
        <Data name="seccion">
          <value>${s.sec}</value>
        </Data>
        <Data name="distrito">
          <value>11</value>
        </Data>
      </ExtendedData>
      <Style>
        <PolyStyle>
          <color>80${colorHex.substring(5,7)}${colorHex.substring(3,5)}${colorHex.substring(1,3)}</color>
        </PolyStyle>
        <LineStyle>
          <color>ff${colorHex.substring(5,7)}${colorHex.substring(3,5)}${colorHex.substring(1,3)}</color>
          <width>2</width>
        </LineStyle>
      </Style>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              ${createPolyCoords(s.lat, s.lng, s.w, s.h)}
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  `).join('\n');
}

function buildKmlDoc(docTitle, placemarksXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${docTitle}</name>
    <description>Capa del ${docTitle}</description>
    ${placemarksXml}
  </Document>
</kml>`;
}

const b1Placemarks = buildPlacemarks("BRIGADA 1 DT11", brigada1Secciones, "#16a34a");
const b2Placemarks = buildPlacemarks("BRIGADA 2 DT11", brigada2Secciones, "#8b4513");

const b1KmlText = buildKmlDoc("BRIGADA 1 DT11", b1Placemarks);
const b2KmlText = buildKmlDoc("BRIGADA 2 DT11", b2Placemarks);
const combinedKmlText = buildKmlDoc("DISTRITO 11 MORELIA", b1Placemarks + "\n" + b2Placemarks);

// Write files
fs.writeFileSync(path.join(process.cwd(), "src", "data", "brigada1.kml"), b1KmlText);
fs.writeFileSync(path.join(process.cwd(), "src", "data", "brigada2.kml"), b2KmlText);
fs.writeFileSync(path.join(process.cwd(), "src", "data", "current.kml"), combinedKmlText);

console.log("KML files regenerated cleanly!");
