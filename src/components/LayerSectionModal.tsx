/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  X, 
  Trash2, 
  Plus, 
  Search, 
  MapPin, 
  Layers, 
  ArrowRightLeft, 
  Check, 
  AlertCircle,
  FileText,
  Eye,
  Sparkles,
  ShieldAlert
} from 'lucide-react';
import { District, DistrictKmlFile, KmlFeature } from '../types';
import { serializeKml } from '../utils/kmlParser';

interface LayerSectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  district: District;
  file: DistrictKmlFile;
  allDistricts: District[];
  featureBank: Map<string, KmlFeature>; // Map of sectionNumber -> KmlFeature for geometry lookup
  onUpdateFile: (districtId: string, updatedFile: DistrictKmlFile) => void;
  onMoveFeatureToFile?: (sourceDistrictId: string, sourceFileId: string, targetDistrictId: string, targetFileId: string, featureId: string) => void;
  onFocusFeatureOnMap: (feature: KmlFeature) => void;
  getSeccionValue: (feature: KmlFeature) => string | null;
}

export const LayerSectionModal: React.FC<LayerSectionModalProps> = ({
  isOpen,
  onClose,
  district,
  file,
  allDistricts,
  featureBank,
  onUpdateFile,
  onMoveFeatureToFile,
  onFocusFeatureOnMap,
  getSeccionValue
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [newSectionInput, setNewSectionInput] = useState('');
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [confirmDeleteFeatureId, setConfirmDeleteFeatureId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const showNotice = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 3500);
  };

  // Extract sections and features currently in this file
  const currentFeatures = file.kmlDoc?.features || [];

  const sectionsList = useMemo(() => {
    return currentFeatures.map(f => {
      const secVal = getSeccionValue(f);
      return {
        feature: f,
        sectionNumber: secVal || f.name || 'Sin Sección',
        numericVal: parseInt(secVal || f.name || '0', 10) || 0
      };
    }).sort((a, b) => a.numericVal - b.numericVal);
  }, [currentFeatures, getSeccionValue]);

  // Filtered sections based on search input
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return sectionsList;
    const query = searchQuery.trim().toLowerCase();
    return sectionsList.filter(item => 
      item.sectionNumber.toLowerCase().includes(query) ||
      (item.feature.name && item.feature.name.toLowerCase().includes(query)) ||
      (item.feature.description && item.feature.description.toLowerCase().includes(query))
    );
  }, [sectionsList, searchQuery]);

  // Set of section numbers currently inside this file
  const currentSectionNumbersSet = useMemo(() => {
    const s = new Set<string>();
    sectionsList.forEach(item => {
      if (item.sectionNumber && item.sectionNumber !== 'Sin Sección') {
        s.add(item.sectionNumber);
      }
    });
    return s;
  }, [sectionsList]);

  // Suggestions of available sections from the feature bank that are NOT in this file
  const availableSuggestions = useMemo(() => {
    const available: string[] = [];
    featureBank.forEach((_, secNum) => {
      if (!currentSectionNumbersSet.has(secNum)) {
        available.push(secNum);
      }
    });
    return available.sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
  }, [featureBank, currentSectionNumbersSet]);

  if (!isOpen) return null;

  // 1. Delete a section / feature from this KML layer
  const handleDeleteSection = (featureId: string, sectionNumber: string) => {
    const updatedFeatures = currentFeatures.filter(f => f.id !== featureId);
    const updatedDoc = {
      ...file.kmlDoc,
      features: updatedFeatures
    };
    const updatedKmlText = serializeKml(updatedDoc);

    const updatedFile: DistrictKmlFile = {
      ...file,
      kmlDoc: updatedDoc,
      kmlText: updatedKmlText
    };

    onUpdateFile(district.id, updatedFile);
    setConfirmDeleteFeatureId(null);
    showNotice(`Sección ${sectionNumber} eliminada de ${file.name}`);
  };

  // 2. Add a section into this KML layer
  const handleAddSection = (secNumRaw: string) => {
    const trimmed = secNumRaw.trim();
    if (!trimmed) return;

    // Handle multiple sections comma-separated (e.g. "988, 1038")
    const sectionsToAdd = trimmed.split(/[\s,]+/).filter(Boolean);

    let addedCount = 0;
    let newFeaturesList = [...currentFeatures];

    sectionsToAdd.forEach(secNum => {
      // Check if already in file
      if (newFeaturesList.some(f => getSeccionValue(f) === secNum || f.name.trim() === secNum)) {
        return;
      }

      // Check if we have polygon geometry in the bank
      const bankFeature = featureBank.get(secNum);

      const newId = 'feat-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);

      if (bankFeature) {
        // Clone bank feature with exact geometry
        const cloned: KmlFeature = {
          ...bankFeature,
          id: newId,
          name: secNum,
          description: `Sección Electoral ${secNum} (${file.brigade})`,
          properties: {
            ...(bankFeature.properties || {}),
            SECCION: secNum,
            BRIGADA: file.brigade
          }
        };
        newFeaturesList.push(cloned);
        addedCount++;
      } else {
        // Create placemark entry for section
        const newFeat: KmlFeature = {
          id: newId,
          name: secNum,
          description: `Sección Electoral ${secNum} (${file.brigade})`,
          geometryType: 'Point',
          polygons: [],
          lineStrings: [],
          points: [{ lat: 19.7025, lng: -101.1923 }], // default central Morelia coordinates
          properties: {
            SECCION: secNum,
            BRIGADA: file.brigade
          }
        };
        newFeaturesList.push(newFeat);
        addedCount++;
      }
    });

    if (addedCount > 0) {
      const updatedDoc = {
        ...file.kmlDoc,
        features: newFeaturesList
      };
      const updatedKmlText = serializeKml(updatedDoc);

      const updatedFile: DistrictKmlFile = {
        ...file,
        kmlDoc: updatedDoc,
        kmlText: updatedKmlText
      };

      onUpdateFile(district.id, updatedFile);
      setNewSectionInput('');
      showNotice(`${addedCount} ${addedCount === 1 ? 'sección añadida' : 'secciones añadidas'} a ${file.name}`);
    } else {
      showNotice(`La sección ya existe en esta capa o es inválida.`);
    }
  };

  // 3. Move section to another layer / file
  const handleMoveSection = (featureId: string, targetFileId: string, secNum: string) => {
    if (!onMoveFeatureToFile || targetFileId === file.id) return;

    // Find target district and file
    let targetDistrictId = district.id;
    for (const d of allDistricts) {
      if (d.kmlFiles.some(f => f.id === targetFileId)) {
        targetDistrictId = d.id;
        break;
      }
    }

    onMoveFeatureToFile(district.id, file.id, targetDistrictId, targetFileId, featureId);
    showNotice(`Sección ${secNum} movida a otra capa exitosamente.`);
  };

  // Find other available files across districts to move to
  const otherFiles = allDistricts.flatMap(d => 
    d.kmlFiles.filter(f => f.id !== file.id).map(f => ({
      fileId: f.id,
      fileName: f.name,
      brigade: f.brigade,
      districtName: d.name
    }))
  );

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-5">
      <div 
        className="bg-[#0f172a] border border-[#1e293b] rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-fadeIn text-slate-100"
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="p-2.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-xl flex-shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <h2 className="font-extrabold text-sm sm:text-base text-white truncate">
                  {file.name}
                </h2>
                <span className="text-[10px] font-mono font-bold bg-blue-900/60 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded-full flex-shrink-0">
                  {file.brigade || 'General'}
                </span>
                <span className="text-[10px] font-semibold bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full hidden sm:inline flex-shrink-0">
                  {district.name}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Panel Admin: Gestiona, añade o elimina secciones de esta capa KML
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
              title="Cerrar panel de secciones"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Temporary Action Toast Notification inside modal */}
        {actionNotice && (
          <div className="bg-emerald-950/90 border-b border-emerald-800/80 px-4 py-2 text-xs text-emerald-200 font-semibold flex items-center justify-between animate-fadeIn">
            <div className="flex items-center space-x-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>{actionNotice}</span>
            </div>
            <span className="text-[10px] font-mono text-emerald-400">Actualizado</span>
          </div>
        )}

        {/* Toolbar: Search & Add Section Toggle */}
        <div className="p-3.5 bg-slate-900/50 border-b border-slate-800/80 flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
          {/* Search box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Filtrar por número de sección (ej. 988, 1038)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 text-xs text-slate-200 border border-slate-800 pl-9 pr-8 py-2 rounded-xl outline-none focus:border-blue-500 transition"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300 text-xs px-1"
              >
                ✕
              </button>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowAddPanel(!showAddPanel)}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer select-none ${
                showAddPanel 
                  ? 'bg-blue-600 text-white shadow-md' 
                  : 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>{showAddPanel ? 'Ocultar Panel Añadir' : '+ Añadir Sección'}</span>
            </button>

            <span className="text-xs font-bold text-slate-400 bg-slate-950 border border-slate-800 px-2.5 py-1.5 rounded-xl whitespace-nowrap">
              {sectionsList.length} {sectionsList.length === 1 ? 'sección' : 'secciones'}
            </span>
          </div>
        </div>

        {/* Expandable Add Section Panel */}
        {showAddPanel && (
          <div className="p-4 bg-slate-950 border-b border-blue-900/40 space-y-3 animate-fadeIn">
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Escribir número de sección electoral a incorporar:
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    placeholder="Ej. 1040 (o varias: 1040, 1042)"
                    value={newSectionInput}
                    onChange={(e) => setNewSectionInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddSection(newSectionInput);
                      }
                    }}
                    className="flex-1 bg-slate-900 text-xs text-slate-100 border border-slate-700 px-3 py-2 rounded-xl outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                  <button
                    onClick={() => handleAddSection(newSectionInput)}
                    disabled={!newSectionInput.trim()}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1 cursor-pointer select-none"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Añadir a Capa</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Catalog Suggestions */}
            {availableSuggestions.length > 0 && (
              <div className="pt-2 border-t border-slate-900">
                <div className="flex items-center space-x-1.5 mb-2">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[11px] font-bold text-slate-300">
                    Secciones disponibles en catálogo (haz clic para añadir al instante con polígono completo):
                  </span>
                </div>
                <div className="max-h-24 overflow-y-auto flex flex-wrap gap-1.5 pr-1 custom-scrollbar">
                  {availableSuggestions.slice(0, 30).map(secNum => (
                    <button
                      key={secNum}
                      onClick={() => handleAddSection(secNum)}
                      className="text-[10px] font-mono font-bold px-2 py-1 bg-slate-900 hover:bg-blue-600 hover:text-white text-slate-300 border border-slate-800 hover:border-blue-500 rounded-lg transition flex items-center space-x-1 cursor-pointer select-none"
                      title={`Añadir sección ${secNum} a este archivo`}
                    >
                      <Plus className="w-3 h-3 text-blue-400" />
                      <span>{secNum}</span>
                    </button>
                  ))}
                  {availableSuggestions.length > 30 && (
                    <span className="text-[10px] text-slate-500 self-center pl-1 font-mono">
                      +{availableSuggestions.length - 30} más...
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sections List Table / Cards */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {filteredSections.length === 0 ? (
            <div className="py-12 text-center border-2 border-dashed border-slate-800/80 rounded-2xl">
              <AlertCircle className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-400">
                {searchQuery ? `No se encontraron secciones coincidentes con "${searchQuery}"` : 'No hay secciones en este archivo KML.'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Usa el botón "+ Añadir Sección" arriba para incorporar secciones a esta capa.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {filteredSections.map(({ feature, sectionNumber }) => {
                const isConfirming = confirmDeleteFeatureId === feature.id;

                return (
                  <div
                    key={feature.id}
                    className="p-3 bg-slate-900/80 hover:bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl transition flex flex-col justify-between space-y-2.5 group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-extrabold text-xs font-mono flex-shrink-0">
                          {sectionNumber.length <= 4 ? sectionNumber : sectionNumber.slice(0, 3)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-extrabold text-xs text-slate-100 truncate">
                            Sección {sectionNumber}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate mt-0.5">
                            {feature.name && feature.name !== sectionNumber ? feature.name : (feature.geometryType === 'Polygon' ? 'Polígono Electoral' : 'Punto Georreferenciado')}
                          </p>
                        </div>
                      </div>

                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                        {feature.geometryType === 'Polygon' ? 'Poli' : 'Punto'}
                      </span>
                    </div>

                    {/* Bottom Action Bar for each section */}
                    <div className="pt-2 border-t border-slate-800/70 flex items-center justify-between">
                      {/* View on Map */}
                      <button
                        onClick={() => {
                          onFocusFeatureOnMap(feature);
                          showNotice(`Sección ${sectionNumber} centrada en el mapa`);
                        }}
                        className="text-[10px] font-semibold text-blue-400 hover:text-blue-300 flex items-center space-x-1 cursor-pointer transition"
                        title="Ver y enfocar sección en el mapa"
                      >
                        <MapPin className="w-3 h-3" />
                        <span>Ver en mapa</span>
                      </button>

                      {/* Right buttons: Move to other file OR Delete */}
                      <div className="flex items-center space-x-1">
                        {/* Quick Transfer between layers */}
                        {otherFiles.length > 0 && (
                          <div className="relative inline-block">
                            <select
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleMoveSection(feature.id, e.target.value, sectionNumber);
                                  e.target.value = '';
                                }
                              }}
                              defaultValue=""
                              className="bg-slate-950 text-[10px] text-slate-400 border border-slate-800 rounded px-1.5 py-0.5 cursor-pointer outline-none hover:text-slate-200"
                              title="Mover esta sección a otra capa KML"
                            >
                              <option value="" disabled>Mover a...</option>
                              {otherFiles.map(of => (
                                <option key={of.fileId} value={of.fileId}>
                                  {of.fileName} ({of.brigade})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Delete Section */}
                        {isConfirming ? (
                          <div className="flex items-center space-x-1 animate-fadeIn">
                            <button
                              onClick={() => handleDeleteSection(feature.id, sectionNumber)}
                              className="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold cursor-pointer transition shadow"
                              title="Confirmar eliminación de esta sección"
                            >
                              Borrar
                            </button>
                            <button
                              onClick={() => setConfirmDeleteFeatureId(null)}
                              className="px-1.5 py-0.5 bg-slate-800 text-slate-400 hover:text-slate-200 rounded text-[10px] cursor-pointer"
                              title="Cancelar"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteFeatureId(feature.id)}
                            className="p-1 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-950/30 transition cursor-pointer"
                            title={`Eliminar sección ${sectionNumber} de esta capa`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 bg-slate-900 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2.5 flex-shrink-0">
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>
              Todos los cambios en secciones se actualizan automáticamente en la capa y en el mapa.
            </span>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition shadow cursor-pointer select-none"
            >
              Listo / Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
