export function parseFlowMetadata(xml, filePath = '') {
  const text = String(xml || '');
  const tag = (name) => text.match(new RegExp(`<${name}>([^<]+)</${name}>`, 'i'))?.[1]?.trim() || null;
  const collect = (pattern) => [...new Set([...text.matchAll(pattern)].map((match) => match[1]).filter(Boolean))];

  const flowName = filePath.split('/').pop()?.replace(/\.flow-meta\.xml$/i, '') || tag('fullName') || 'unknown';
  const fields = collect(/<field>([^<]+)<\/field>/gi);
  const objectRefs = collect(/<(?:object|sobjectType|sourceObject|targetObject)>([^<]+)<\/(?:object|sobjectType|sourceObject|targetObject)>/gi);
  const apexActions = collect(/<(?:name|actionName)>([^<]*Apex[^<]*)<\/(?:name|actionName)>/gi);
  const subflows = collect(/<flowName>([^<]+)<\/flowName>/gi);

  return {
    flowName,
    label: tag('label'),
    status: tag('status'),
    processType: tag('processType'),
    references: {
      objects: objectRefs,
      fields,
      apexActions,
      subflows,
    },
  };
}

export function flowMatches(entry, { q, object, field, action }) {
  const haystack = [
    entry.flowName,
    entry.label,
    entry.status,
    entry.processType,
    ...(entry.references?.objects || []),
    ...(entry.references?.fields || []),
    ...(entry.references?.apexActions || []),
    ...(entry.references?.subflows || []),
  ].filter(Boolean).join(' ').toLowerCase();

  if (q && !haystack.includes(String(q).toLowerCase())) return false;
  if (object && !(entry.references?.objects || []).some((value) => value.toLowerCase().includes(String(object).toLowerCase()))) return false;
  if (field && !(entry.references?.fields || []).some((value) => value.toLowerCase().includes(String(field).toLowerCase()))) return false;
  if (action && !(entry.references?.apexActions || []).some((value) => value.toLowerCase().includes(String(action).toLowerCase()))) return false;
  return true;
}
