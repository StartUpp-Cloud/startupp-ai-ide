import { useState, useEffect, useMemo } from 'react';
import { Database, Search, Loader, ChevronRight, AlertTriangle, Trash2, RefreshCw, ArrowRight, ExternalLink } from 'lucide-react';

export default function SchemaExplorer({ projectId, connection }) {
  const [objects, setObjects] = useState([]);
  const [selectedObject, setSelectedObject] = useState(null);
  const [describe, setDescribe] = useState(null);
  const [filter, setFilter] = useState('');
  const [fieldFilter, setFieldFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [describeLoading, setDescribeLoading] = useState(false);
  const [error, setError] = useState(null);

  // Dependency analysis
  const [depTarget, setDepTarget] = useState(null);
  const [depResult, setDepResult] = useState(null);
  const [depLoading, setDepLoading] = useState(false);

  const [showCustomOnly, setShowCustomOnly] = useState(false);

  useEffect(() => {
    if (connection?.connected) loadObjects();
  }, [connection?.connected]);

  const loadObjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/salesforce/schema/objects?projectId=${projectId}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Failed to load objects');
      setObjects(data.data.objects || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const loadDescribe = async (objectName) => {
    setSelectedObject(objectName);
    setDescribeLoading(true);
    setDescribe(null);
    setDepTarget(null);
    setDepResult(null);
    try {
      const res = await fetch(`/api/salesforce/schema/objects/${objectName}?projectId=${projectId}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Failed to describe object');
      setDescribe(data.data);
    } catch (err) {
      setError(err.message);
    }
    setDescribeLoading(false);
  };

  const analyzeDependency = async (objectName, fieldName) => {
    setDepTarget({ objectName, fieldName });
    setDepLoading(true);
    setDepResult(null);
    try {
      const res = await fetch('/api/salesforce/dependencies/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, objectName, fieldName }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Analysis failed');
      setDepResult(data.data);
    } catch (err) {
      setDepResult({ error: err.message });
    }
    setDepLoading(false);
  };

  const filteredObjects = useMemo(() => {
    let list = objects;
    if (showCustomOnly) list = list.filter((o) => o.custom);
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter((o) => o.name.toLowerCase().includes(q) || o.label?.toLowerCase().includes(q));
    }
    return list.slice(0, 300);
  }, [objects, filter, showCustomOnly]);

  const filteredFields = useMemo(() => {
    if (!describe?.fields) return [];
    if (!fieldFilter) return describe.fields;
    const q = fieldFilter.toLowerCase();
    return describe.fields.filter((f) => f.name.toLowerCase().includes(q) || f.label?.toLowerCase().includes(q));
  }, [describe?.fields, fieldFilter]);

  const riskColor = { blocking: 'text-red-400', high: 'text-orange-400', medium: 'text-amber-400', low: 'text-surface-400' };

  if (!connection?.connected) {
    return <div className="p-6 text-surface-500">Connect to a Salesforce org to browse schema.</div>;
  }

  return (
    <div className="flex h-full">
      {/* Object list panel */}
      <div className="w-72 border-r border-surface-700 flex flex-col">
        <div className="p-3 border-b border-surface-700 space-y-2">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-sky-400" />
            <h3 className="text-sm font-semibold">Objects</h3>
            <span className="ml-auto text-xs text-surface-500">{objects.length}</span>
            <button onClick={loadObjects} className="p-1 hover:bg-surface-700 rounded" title="Refresh">
              <RefreshCw size={12} className="text-surface-400" />
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2 text-surface-500" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter objects..."
              className="w-full bg-surface-800 border border-surface-600 rounded pl-8 pr-3 py-1.5 text-xs text-surface-200 placeholder-surface-600"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-surface-400">
            <input type="checkbox" checked={showCustomOnly} onChange={(e) => setShowCustomOnly(e.target.checked)} className="rounded" />
            Custom only
          </label>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 flex items-center justify-center"><Loader size={16} className="animate-spin text-surface-400" /></div>
          ) : (
            filteredObjects.map((obj) => (
              <button
                key={obj.name}
                onClick={() => loadDescribe(obj.name)}
                className={`w-full text-left px-3 py-2 text-xs border-b border-surface-800 hover:bg-surface-800 transition-colors flex items-center gap-2 ${selectedObject === obj.name ? 'bg-sky-500/10 text-sky-300' : 'text-surface-300'}`}
              >
                <span className="flex-1 truncate">{obj.name}</span>
                {obj.custom && <span className="text-[10px] text-amber-400 shrink-0">custom</span>}
                <ChevronRight size={12} className="shrink-0 text-surface-600" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* Object detail panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedObject ? (
          <div className="flex-1 flex items-center justify-center text-surface-500 text-sm">
            Select an object to view its fields
          </div>
        ) : describeLoading ? (
          <div className="flex-1 flex items-center justify-center"><Loader size={20} className="animate-spin text-surface-400" /></div>
        ) : describe ? (
          <>
            {/* Object header */}
            <div className="p-4 border-b border-surface-700">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold">{describe.name}</h3>
                <span className="text-sm text-surface-400">{describe.label}</span>
                {describe.custom && <span className="text-xs bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">Custom</span>}
              </div>
              <div className="flex gap-4 mt-1 text-xs text-surface-500">
                <span>{describe.fields?.length || 0} fields</span>
                <span>{describe.childRelationships?.length || 0} child relationships</span>
                {describe.keyPrefix && <span>Key prefix: {describe.keyPrefix}</span>}
              </div>
            </div>

            {/* Field filter */}
            <div className="p-3 border-b border-surface-700">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2 text-surface-500" />
                <input
                  type="text"
                  value={fieldFilter}
                  onChange={(e) => setFieldFilter(e.target.value)}
                  placeholder="Filter fields..."
                  className="w-full bg-surface-800 border border-surface-600 rounded pl-8 pr-3 py-1.5 text-xs text-surface-200 placeholder-surface-600"
                />
              </div>
            </div>

            {/* Fields table */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-surface-800 sticky top-0">
                  <tr className="text-surface-400">
                    <th className="text-left px-3 py-2 font-medium">Field Name</th>
                    <th className="text-left px-3 py-2 font-medium">Label</th>
                    <th className="text-left px-3 py-2 font-medium">Type</th>
                    <th className="text-left px-3 py-2 font-medium">Props</th>
                    <th className="text-left px-3 py-2 font-medium w-20">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFields.map((field) => (
                    <tr key={field.name} className="border-b border-surface-800 hover:bg-surface-800/50">
                      <td className="px-3 py-2 font-mono text-sky-300">
                        {field.name}
                        {field.custom && <span className="ml-1 text-[10px] text-amber-400">*</span>}
                      </td>
                      <td className="px-3 py-2 text-surface-300">{field.label}</td>
                      <td className="px-3 py-2">
                        <span className="text-violet-300">{field.type}</span>
                        {field.length > 0 && <span className="text-surface-500">({field.length})</span>}
                        {field.referenceTo?.length > 0 && (
                          <span className="ml-1 text-sky-400 cursor-pointer" onClick={() => loadDescribe(field.referenceTo[0])} title={`Go to ${field.referenceTo[0]}`}>
                            <ArrowRight size={10} className="inline" /> {field.referenceTo[0]}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 space-x-1">
                        {!field.nillable && <span className="text-[10px] bg-red-500/20 text-red-300 px-1 rounded">required</span>}
                        {field.unique && <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1 rounded">unique</span>}
                        {field.externalId && <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1 rounded">extId</span>}
                        {field.calculated && <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1 rounded">formula</span>}
                      </td>
                      <td className="px-3 py-2">
                        {field.custom && (
                          <button
                            onClick={() => analyzeDependency(describe.name, field.name)}
                            className="p-1 hover:bg-surface-700 rounded text-surface-500 hover:text-red-400 transition-colors"
                            title="Analyze field dependencies for safe deletion"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Dependency analysis panel */}
            {depTarget && (
              <div className="border-t border-surface-700 p-4 max-h-80 overflow-y-auto bg-surface-900">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={16} className="text-amber-400" />
                  <h4 className="font-medium text-sm">
                    Deletion Analysis: {depTarget.objectName}.{depTarget.fieldName}
                  </h4>
                  <button onClick={() => setDepTarget(null)} className="ml-auto text-xs text-surface-500 hover:text-surface-300">Close</button>
                </div>

                {depLoading ? (
                  <div className="flex items-center gap-2 text-sm text-surface-400"><Loader size={14} className="animate-spin" /> Analyzing dependencies...</div>
                ) : depResult?.error ? (
                  <div className="text-sm text-red-400">{depResult.error}</div>
                ) : depResult ? (
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center gap-3">
                      <span className={`font-medium ${riskColor[depResult.risk] || 'text-surface-300'}`}>
                        Risk: {depResult.risk?.toUpperCase()}
                      </span>
                      <span className="text-surface-500">{depResult.referenceCount} reference(s)</span>
                    </div>

                    {depResult.references?.length > 0 && (
                      <div>
                        <h5 className="text-xs font-medium text-surface-400 mb-1">References:</h5>
                        <div className="space-y-1">
                          {depResult.references.slice(0, 15).map((ref, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <span className={`w-16 shrink-0 ${riskColor[ref.risk]}`}>[{ref.risk}]</span>
                              <span className="text-surface-500">{ref.type}</span>
                              <span className="text-surface-300 truncate">{ref.filePath}</span>
                              <span className="text-surface-600">{ref.matchCount} match(es)</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {depResult.plan && (
                      <div>
                        <h5 className="text-xs font-medium text-surface-400 mb-1">Deletion Plan:</h5>
                        <div className="bg-surface-800 rounded p-3 text-xs text-surface-300 whitespace-pre-wrap">{depResult.plan}</div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </>
        ) : null}
      </div>

      {error && (
        <div className="absolute bottom-4 right-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300 max-w-md">
          {error}
        </div>
      )}
    </div>
  );
}
