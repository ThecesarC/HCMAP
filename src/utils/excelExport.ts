import * as XLSX from 'xlsx';

export interface CoordinatorSectionPair {
  coordinator: string;
  section: string;
}

export interface BrigadeExportData {
  brigade1Sections?: string[];
  brigade2Sections?: string[];
  districtName?: string;
  additionalBrigades?: { name: string; sections: string[] }[];
  coordinatorPairs?: CoordinatorSectionPair[];
  coordinatorGroups?: { name: string; sections: string[] }[];
}

/**
 * Genera y descarga un archivo de Excel (.xlsx) con:
 * - Hoja 1: Tabla idéntica a la imagen del usuario: Columna 1 "COORDINADOR", Columna 2 "SECCION".
 * - Hoja 2: Columnas organizadas por Coordinador / Brigada con sus secciones.
 */
export function exportBrigadesToExcel(
  data: BrigadeExportData, 
  filename = 'Coordinadores_y_Secciones_Distrito_11.xlsx'
) {
  const sortNumeric = (arr: string[]) => 
    [...arr].sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));

  const wb = XLSX.utils.book_new();

  // 1. Determinar si disponemos de grupos de coordinadores
  const coordGroups = data.coordinatorGroups || [];
  
  // Si no se pasaron coordinatorGroups explícitos pero sí brigade1 / brigade2 / additionalBrigades
  const allGroups: { name: string; sections: string[] }[] = [];
  if (coordGroups.length > 0) {
    allGroups.push(...coordGroups);
  } else {
    if (data.brigade1Sections && data.brigade1Sections.length > 0) {
      allGroups.push({ name: 'BRIGADA 1', sections: sortNumeric(data.brigade1Sections) });
    }
    if (data.brigade2Sections && data.brigade2Sections.length > 0) {
      allGroups.push({ name: 'BRIGADA 2', sections: sortNumeric(data.brigade2Sections) });
    }
    if (data.additionalBrigades) {
      data.additionalBrigades.forEach(b => {
        allGroups.push({ name: b.name.toUpperCase(), sections: sortNumeric(b.sections) });
      });
    }
  }

  // --- HOJA 1: FORMATO TABLA (COORDINADOR | SECCION) tal cual la imagen del usuario ---
  const tableRows: (string | number)[][] = [['COORDINADOR', 'SECCION']];
  
  if (data.coordinatorPairs && data.coordinatorPairs.length > 0) {
    data.coordinatorPairs.forEach(pair => {
      const num = Number(pair.section);
      tableRows.push([pair.coordinator, !isNaN(num) ? num : pair.section]);
    });
  } else {
    allGroups.forEach(g => {
      g.sections.forEach(sec => {
        const num = Number(sec);
        tableRows.push([g.name, !isNaN(num) ? num : sec]);
      });
    });
  }

  const wsTable = XLSX.utils.aoa_to_sheet(tableRows);
  wsTable['!cols'] = [{ wch: 22 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsTable, 'Coordinador y Sección');

  // --- HOJA 2: FORMATO POR COLUMNAS (Una columna por Coordinador / Brigada) ---
  if (allGroups.length > 0) {
    const headers = allGroups.map(g => g.name.toUpperCase());
    const columnsData = allGroups.map(g => g.sections);
    const maxRows = Math.max(...columnsData.map(col => col.length), 0);

    const matrixRows: (string | number)[][] = [headers];

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
      matrixRows.push(row);
    }

    const totalsRow: string[] = columnsData.map(col => `Total: ${col.length} secciones`);
    matrixRows.push(totalsRow);

    const wsColumns = XLSX.utils.aoa_to_sheet(matrixRows);
    wsColumns['!cols'] = headers.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, wsColumns, 'Columnas por Brigada');
  }

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
    XLSX.writeFile(wb, filename);
    return true;
  }
}
