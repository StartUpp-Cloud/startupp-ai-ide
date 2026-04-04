import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, ArrowLeft, User, Palette, Code, MessageSquare } from 'lucide-react';

const TONE_OPTIONS = [
  { id: 'concise', label: 'Concise', desc: 'Short, direct responses' },
  { id: 'detailed', label: 'Detailed', desc: 'Thorough explanations' },
  { id: 'casual', label: 'Casual', desc: 'Relaxed, conversational' },
  { id: 'formal', label: 'Formal', desc: 'Professional, structured' },
];

export default function Profile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState({
    name: '', role: '', tone: 'concise', preferences: '', codeStyle: '', languages: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(data => setProfile(prev => ({ ...prev, ...data })))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {}
    setSaving(false);
  };

  if (loading) return <div className="min-h-screen bg-surface-900 flex items-center justify-center text-surface-500">Loading...</div>;

  return (
    <div className="min-h-screen bg-surface-900 text-surface-200">
      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-surface-800 text-surface-400 hover:text-surface-200">
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-xl font-display font-bold">Profile & Preferences</h1>
        </div>

        <div className="space-y-6">
          {/* Identity */}
          <section className="bg-surface-850 rounded-xl border border-surface-700 p-5">
            <div className="flex items-center gap-2 mb-4">
              <User size={16} className="text-primary-400" />
              <h2 className="text-sm font-semibold">Identity</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] text-surface-500 uppercase mb-1 block">Name</label>
                <input
                  value={profile.name}
                  onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
                  placeholder="Your name"
                  className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 outline-none focus:border-primary-500/50"
                />
              </div>
              <div>
                <label className="text-[11px] text-surface-500 uppercase mb-1 block">Role</label>
                <input
                  value={profile.role}
                  onChange={e => setProfile(p => ({ ...p, role: e.target.value }))}
                  placeholder="e.g., Frontend Developer, Full Stack, Data Scientist"
                  className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 outline-none focus:border-primary-500/50"
                />
              </div>
            </div>
          </section>

          {/* Tone */}
          <section className="bg-surface-850 rounded-xl border border-surface-700 p-5">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare size={16} className="text-primary-400" />
              <h2 className="text-sm font-semibold">Response Tone</h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {TONE_OPTIONS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setProfile(p => ({ ...p, tone: t.id }))}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                    profile.tone === t.id
                      ? 'bg-primary-500/10 border-primary-500/30 text-primary-300'
                      : 'bg-surface-800 border-surface-700 text-surface-400 hover:text-surface-200'
                  }`}
                >
                  <div className="text-[12px] font-medium">{t.label}</div>
                  <div className="text-[10px] text-surface-500">{t.desc}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Code Preferences */}
          <section className="bg-surface-850 rounded-xl border border-surface-700 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Code size={16} className="text-primary-400" />
              <h2 className="text-sm font-semibold">Code Preferences</h2>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-surface-500 uppercase mb-1 block">Languages & Frameworks</label>
                <input
                  value={profile.languages}
                  onChange={e => setProfile(p => ({ ...p, languages: e.target.value }))}
                  placeholder="e.g., TypeScript, React, Node.js, Python"
                  className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 outline-none focus:border-primary-500/50"
                />
              </div>
              <div>
                <label className="text-[11px] text-surface-500 uppercase mb-1 block">Code Style</label>
                <textarea
                  value={profile.codeStyle}
                  onChange={e => setProfile(p => ({ ...p, codeStyle: e.target.value }))}
                  placeholder="e.g., Prefer functional components, minimal comments, use ES modules..."
                  rows={3}
                  className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 outline-none focus:border-primary-500/50 resize-none"
                />
              </div>
            </div>
          </section>

          {/* General Preferences */}
          <section className="bg-surface-850 rounded-xl border border-surface-700 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Palette size={16} className="text-primary-400" />
              <h2 className="text-sm font-semibold">General Preferences</h2>
            </div>
            <textarea
              value={profile.preferences}
              onChange={e => setProfile(p => ({ ...p, preferences: e.target.value }))}
              placeholder="Any other preferences for how AI tools should interact with you..."
              rows={4}
              className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 outline-none focus:border-primary-500/50 resize-none"
            />
          </section>

          {/* Save button */}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-surface-950 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Profile'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
