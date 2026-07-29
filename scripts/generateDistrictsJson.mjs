import fs from 'fs';
import path from 'path';

const b1Text = fs.readFileSync(path.join(process.cwd(), "src", "data", "brigada1.kml"), "utf-8");
const b2Text = fs.readFileSync(path.join(process.cwd(), "src", "data", "brigada2.kml"), "utf-8");

const defaultDistricts = [
  {
    id: 'distrito-11',
    name: 'Distrito 11',
    description: 'Polígonos y capas correspondientes al Distrito 11',
    enabled: true,
    color: '#16a34a',
    kmlFiles: [
      {
        id: 'd11-brigada1-kml',
        name: 'BRIGADA 1 DT11.kml',
        brigade: 'Brigada 1',
        enabled: true,
        kmlText: b1Text,
        uploadedAt: new Date().toLocaleDateString('es-MX')
      },
      {
        id: 'd11-brigada2-kml',
        name: 'BRIGADA 2 DT11.kml',
        brigade: 'Brigada 2',
        enabled: true,
        kmlText: b2Text,
        uploadedAt: new Date().toLocaleDateString('es-MX')
      }
    ]
  }
];

fs.writeFileSync(
  path.join(process.cwd(), "src", "data", "districts.json"),
  JSON.stringify(defaultDistricts, null, 2),
  "utf-8"
);

console.log("districts.json generated successfully!");
