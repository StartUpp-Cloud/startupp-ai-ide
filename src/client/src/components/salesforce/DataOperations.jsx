import { useState } from 'react';
import { Table2, Plus, Pencil, Trash2, Loader, CheckCircle, AlertTriangle, X } from 'lucide-react';

export default function DataOperations({ projectId, connection }) {
  const [operation, setOperation] = useState('create'); // create | update | delete
  const [objectName, setObjectName] = useState('');
  const [recordId, setRecordId] = useState('');
  const [fieldsText, setFieldsText] = useState('{\n  "Name": ""\n}');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const execute = async () => {
    if (!objectName.trim()) { setError('Object name is required'); return; }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      let fields;
      if (operation !== 'delete') {
        try {
          fields = JSON.parse(fieldsText);
        } catch {
          throw new Error('Fields must be valid JSON');
        }
      }

      let res;
      if (operation === 'create') {
        res = await fetch('/api/salesforce/data/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, objectName, fields }),
        });
      } else if (operation === 'update') {
        if (!recordId.trim()) throw new Error('Record ID is required for update');
        res = await fetch('/api/salesforce/data/update', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, objectName, recordId, fields }),
        });
      } else if (operation === 'delete') {
        if (!recordId.trim()) throw new Error('Record ID is required for delete');
        if (!confirmDelete) { setConfirmDelete(true); setLoading(false); return; }
        res = await fetch('/api/salesforce/data/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, objectName, recordId }),
        });
        setConfirmDelete(false);
      }

      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Operation failed');
      setResult({ success: true, data: data.data, operation });
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  if (!connection?.connected) {
    return <div className="p-6 text-surface-500">Connect to a Salesforce org to manage data.</div>;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Table2 size={18} className="text-sky-400" />
        <h2 className="text-lg font-semibold">Data Operations</h2>
      </div>

      {/* Operation selector */}
      <div className="flex gap-1 bg-surface-800 rounded-lg p-1">
        <button onClick={() => { setOperation('create'); setConfirmDelete(false); }} className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${operation === 'create' ? 'bg-emerald-500/20 text-emerald-300' : 'text-surface-400 hover:text-surface-200'}`}>
          <Plus size={14} /> Create
        </button>
        <button onClick={() => { setOperation('update'); setConfirmDelete(false); }} className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${operation === 'update' ? 'bg-sky-500/20 text-sky-300' : 'text-surface-400 hover:text-surface-200'}`}>
          <Pencil size={14} /> Update
        </button>
        <button onClick={() => { setOperation('delete'); setConfirmDelete(false); }} className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${operation === 'delete' ? 'bg-red-500/20 text-red-300' : 'text-surface-400 hover:text-surface-200'}`}>
          <Trash2 size={14} /> Delete
        </button>
      </div>

      {/* Form */}
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-surface-400 mb-1">Object API Name</label>
          <input
            type="text"
            value={objectName}
            onChange={(e) => setObjectName(e.target.value)}
            placeholder="Account, Contact, Custom_Object__c"
            className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-surface-200 placeholder-surface-600"
          />
        </div>

        {(operation === 'update' || operation === 'delete') && (
          <div>
            <label className="block text-xs text-surface-400 mb-1">Record ID</label>
            <input
              type="text"
              value={recordId}
              onChange={(e) => { setRecordId(e.target.value); setConfirmDelete(false); }}
              placeholder="001xx000000xxxxx"
              className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm font-mono text-surface-200 placeholder-surface-600"
            />
          </div>
        )}

        {operation !== 'delete' && (
          <div>
            <label className="block text-xs text-surface-400 mb-1">Fields (JSON)</label>
            <textarea
              value={fieldsText}
              onChange={(e) => setFieldsText(e.target.value)}
              rows={6}
              className="w-full bg-surface-800 border border-surface-600 rounded-lg px-4 py-3 text-sm font-mono text-surface-200 placeholder-surface-600 resize-y"
              placeholder='{"Name": "Test", "Industry": "Technology"}'
            />
          </div>
        )}

        {operation === 'delete' && confirmDelete && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={16} className="text-red-400" />
              <span className="font-medium text-red-300">Confirm Deletion</span>
            </div>
            <p className="text-sm text-surface-400 mb-3">
              This will permanently delete the {objectName} record with ID {recordId}. This action cannot be undone.
            </p>
          </div>
        )}

        <button
          onClick={execute}
          disabled={loading || !objectName.trim()}
          className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            operation === 'delete'
              ? confirmDelete
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-red-500/20 hover:bg-red-500/30 text-red-300'
              : operation === 'create'
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-sky-600 hover:bg-sky-500 text-white'
          } disabled:bg-surface-700 disabled:text-surface-500`}
        >
          {loading ? <Loader size={14} className="animate-spin" /> : null}
          {operation === 'create' ? 'Create Record' : operation === 'update' ? 'Update Record' : confirmDelete ? 'Yes, Delete Record' : 'Delete Record'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={16} className="text-emerald-400" />
            <span className="font-medium text-emerald-300">
              {result.operation === 'create' ? 'Record Created' : result.operation === 'update' ? 'Record Updated' : 'Record Deleted'}
            </span>
          </div>
          {result.data?.id && <div className="text-sm text-surface-300">ID: <span className="font-mono text-sky-300">{result.data.id}</span></div>}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300 flex items-center gap-2">
          <X size={14} /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-xs hover:text-red-200">dismiss</button>
        </div>
      )}
    </div>
  );
}
