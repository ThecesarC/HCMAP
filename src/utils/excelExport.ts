import * as XLSX from 'xlsx';

export interface BrigadeExportData {
  brigade1Sections: string[];
  brigade2Sections: string[];
  districtName?: string;
  additionalBrigades?: { name: string; sections: string[] }[];
}

/**
 * Genera y descarga un archivo de Excel (.xlsx) con:
 * - Columna 1: BRIGADA 1 y sus secciones electorales
 * - Columna 2: BRIGADA 2 y sus secciones electorales
 * - Fila resumen de totales al final
 */
export function exportBrigadesToExcel(
  data: BrigadeExportData, 
  filename = 'Brigadas_1_y_2_Secciones.xlsx'
) {
  const sortNumeric = (arr: string[]) => 
    [...arr].sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));

  const b1 = sortNumeric(data.brigade1Sections);
  const b2 = sortNumeric(data.brigade2Sections);

  // Column headers: Exactamente Columna 1 = BRIGADA 1, Columna 2 = BRIGADA 2
  const headers: string[] = ['BRIGADA 1', 'BRIGADA 2'];
  const columnsData: (string | number)[][] = [b1, b2];

  if (data.additionalBrigades && data.additionalBrigades.length > 0) {
    data.additionalBrigades.forEach(b => {
      headers.push(b.name.toUpperCase());
      columnsData.push(sortNumeric(b.sections));
    });
  }

  const maxRows = Math.max(...columnsData.map(col => col.length), 0);

  const rows: (string | number)[][] = [headers];

  for (let r = 0; r < maxRows; r++) {
    const row: (string | number)[] = [];
    for (let c = 0; c < columnsData.length; c++) {
      const val = columnsData[c][r];
      if (val !== undefined && val !== null && val !== '') {
        const num = Number(val);
        row.push(!isNaN(num) && String(num) === String(val) ? num : val);
      } else {
        row.push('');
      }
    }
    rows.push(row);
  }

  // Fila resumen con el total de secciones por brigada
  const totalsRow: string[] = columnsData.map(col => `Total: ${col.length} secciones`);
  rows.push(totalsRow);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Configurar anchos de columna amplios para visualización clara en Excel
  ws['!cols'] = headers.map(() => ({ wch: 24 }));

  const wb = XLSX.utils.book_new();
  const sheetName = (data.districtName || 'Distrito 11').substring(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  if (typeof window !== 'undefined') {
    try {
      XLSX.writeFile(wb, filename);
      return true;
    } catch (err) {
      console.warn('XLSX.writeFile fallback to Blob URL:', err);
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    }
  } else {
    // Node environment export
    XLSX.writeFile(wb, filename);
    return true;
  }
}
