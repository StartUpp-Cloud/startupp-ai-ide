const CLIENT_PALETTE = [
  { bg: "bg-sky-500/15", text: "text-sky-300", border: "border-sky-500/40", bar: "bg-sky-400" },
  { bg: "bg-violet-500/15", text: "text-violet-300", border: "border-violet-500/40", bar: "bg-violet-400" },
  { bg: "bg-emerald-500/15", text: "text-emerald-300", border: "border-emerald-500/40", bar: "bg-emerald-400" },
  { bg: "bg-amber-500/15", text: "text-amber-300", border: "border-amber-500/40", bar: "bg-amber-400" },
  { bg: "bg-rose-500/15", text: "text-rose-300", border: "border-rose-500/40", bar: "bg-rose-400" },
  { bg: "bg-cyan-500/15", text: "text-cyan-300", border: "border-cyan-500/40", bar: "bg-cyan-400" },
  { bg: "bg-fuchsia-500/15", text: "text-fuchsia-300", border: "border-fuchsia-500/40", bar: "bg-fuchsia-400" },
  { bg: "bg-lime-500/15", text: "text-lime-300", border: "border-lime-500/40", bar: "bg-lime-400" },
  { bg: "bg-orange-500/15", text: "text-orange-300", border: "border-orange-500/40", bar: "bg-orange-400" },
  { bg: "bg-indigo-500/15", text: "text-indigo-300", border: "border-indigo-500/40", bar: "bg-indigo-400" },
];

const UNGROUPED_COLOR = {
  bg: "bg-surface-700/40",
  text: "text-surface-400",
  border: "border-surface-600",
  bar: "bg-surface-500",
  neutral: true,
};

export function normalizeClient(value) {
  return typeof value === "string" ? value.trim() : "";
}

function defaultSortOrder(project) {
  if (Number.isFinite(Number(project?.sortOrder))) return Number(project.sortOrder);
  const created = Date.parse(project?.createdAt || "");
  return Number.isFinite(created) ? created : 0;
}

export function groupProjectsByClient(projects) {
  const groups = new Map();
  for (const project of projects || []) {
    const key = normalizeClient(project?.client);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(project);
  }

  const result = [...groups.entries()].map(([client, items]) => {
    items.sort((a, b) => {
      const sa = defaultSortOrder(a);
      const sb = defaultSortOrder(b);
      if (sa !== sb) return sa - sb;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    return {
      client,
      projects: items,
      sortOrder: items.length ? defaultSortOrder(items[0]) : 0,
    };
  });

  result.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.client.localeCompare(b.client);
  });
  return result;
}

export function clientColor(client) {
  const key = normalizeClient(client);
  if (!key) return { ...UNGROUPED_COLOR };

  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }
  const palette = CLIENT_PALETTE[Math.abs(hash) % CLIENT_PALETTE.length];
  return { ...palette, neutral: false };
}
