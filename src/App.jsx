import { useState, useRef, useEffect } from 'react';
import { SYSTEM_PROMPT } from './systemPrompt.js';

// ─── MODE PREFIXES ──────────────────────────────────────────────────────────
const MODE_PREFIX = {
  dream: `\n\nACTIVE MODE: DREAM\nThe user has selected Dream mode. Lead with the dream reading framework. Do not open with synchronicity framing.`,
  sync:  `\n\nACTIVE MODE: SYNCHRONICITY\nThe user has selected Synchronicity mode. Lead with the synchronicity reading framework. Do not open with dream reading framing.`,
};

// ─── FEEDBACK SURVEY ────────────────────────────────────────────────────────
// Replace the text below with your real Google Form link once you've made one.
// Until you do, this feature stays silently off — no banner will appear.
const SURVEY_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfujAdi_LmTHgylMCEGEeipeKzSeG27OfzU6t-bi3Y45BZhag/viewform';
const SURVEY_TRIGGER_SESSIONS = 30; // number of completed journal entries before the prompt appears

// ─── COLOURS ────────────────────────────────────────────────────────────────
const C = {
  gold:   '#C9A84C',
  bg:     '#0D0D14',
  bgAi:   'rgba(42,31,61,0.5)',
  text:   '#E8DFC8',
  muted:  '#8A8A9A',
  border: 'rgba(201,168,76,0.15)',
};

// ─── JOURNAL STORAGE ────────────────────────────────────────────────────────
function loadJournal() {
  try {
    const raw = localStorage.getItem('dreamwork_journal');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveJournal(entries) {
  try {
    localStorage.setItem('dreamwork_journal', JSON.stringify(entries));
  } catch (e) { console.error('Save failed', e); }
}

// ─── ACTIVE SESSION TRACKING ─────────────────────────────────────────────────
// Tracks the session currently in progress, separate from the permanent journal,
// so a session can be resumed if the app is closed without an explicit "New session".
function loadActiveSession() {
  try {
    const raw = localStorage.getItem('dreamwork_active_session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveActiveSession(session) {
  try {
    localStorage.setItem('dreamwork_active_session', JSON.stringify(session));
  } catch (e) { console.error('Active session save failed', e); }
}

function clearActiveSession() {
  try {
    localStorage.removeItem('dreamwork_active_session');
  } catch (e) { console.error('Active session clear failed', e); }
}

// ─── DRAFT TEXT ──────────────────────────────────────────────────────────────
// Saves whatever is currently typed in the input box, even before it's sent,
// so nothing is lost if the app is closed mid-thought.
function loadDraft() {
  try {
    const raw = localStorage.getItem('dreamwork_draft');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveDraft(text, mode) {
  try {
    if (!text) {
      localStorage.removeItem('dreamwork_draft');
    } else {
      localStorage.setItem('dreamwork_draft', JSON.stringify({ text, mode, savedAt: Date.now() }));
    }
  } catch (e) { console.error('Draft save failed', e); }
}

// ─── API KEY STORAGE ─────────────────────────────────────────────────────────
// The user's own Anthropic API key, kept only on this device. Never sent
// anywhere except directly to Anthropic when making a request.
function loadApiKey() {
  try {
    return localStorage.getItem('dreamwork_api_key') || '';
  } catch { return ''; }
}

function saveApiKey(key) {
  try {
    if (!key) {
      localStorage.removeItem('dreamwork_api_key');
    } else {
      localStorage.setItem('dreamwork_api_key', key);
    }
  } catch (e) { console.error('API key save failed', e); }
}

// ─── SURVEY DISMISSAL ─────────────────────────────────────────────────────────
// Whether this person has already closed the feedback banner, so it doesn't
// keep reappearing once they've seen it. The survey stays reachable from
// Settings either way, in case they want to come back to it later.
function loadSurveyDismissed() {
  try {
    return localStorage.getItem('dreamwork_survey_dismissed') === 'true';
  } catch { return false; }
}

function saveSurveyDismissed() {
  try {
    localStorage.setItem('dreamwork_survey_dismissed', 'true');
  } catch (e) { console.error('Survey dismissal save failed', e); }
}

// ─── TEXT RENDERER ───────────────────────────────────────────────────────────
function renderText(text) {
  const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  return blocks.map((block, bi) => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const allNumbered = lines.length >= 2 && lines.every(l => /^[1-3]\.\s/.test(l));
    if (allNumbered) {
      return (
        <div key={bi} style={{ marginTop: bi > 0 ? 14 : 0 }}>
          {lines.map((line, li) => {
            const m = line.match(/^([1-3])\.\s+(.+)$/);
            if (!m) return null;
            return (
              <div key={li} style={{ display:'flex', gap:12, alignItems:'flex-start', marginBottom: li < lines.length-1 ? 10 : 0 }}>
                <span style={{ color:C.gold, fontFamily:'system-ui,sans-serif', fontSize:11, fontWeight:600, letterSpacing:'0.06em', marginTop:3, opacity:0.7, flexShrink:0, minWidth:14 }}>{m[1]}</span>
                <p style={{ margin:0, fontSize:16, lineHeight:1.8, color:C.text, fontStyle:'italic' }}>{m[2]}</p>
              </div>
            );
          })}
        </div>
      );
    }
    const qm = block.match(/^([1-3])\.\s+(.+)$/s);
    if (qm) {
      return (
        <div key={bi} style={{ display:'flex', gap:12, alignItems:'flex-start', marginTop: bi > 0 ? 10 : 0 }}>
          <span style={{ color:C.gold, fontFamily:'system-ui,sans-serif', fontSize:11, fontWeight:600, letterSpacing:'0.06em', marginTop:3, opacity:0.7, flexShrink:0, minWidth:14 }}>{qm[1]}</span>
          <p style={{ margin:0, fontSize:16, lineHeight:1.8, color:C.text, fontStyle:'italic' }}>{qm[2]}</p>
        </div>
      );
    }
    const parts = [];
    const re = /\*([^*]+)\*/g;
    let last = 0, m2;
    while ((m2 = re.exec(block)) !== null) {
      if (m2.index > last) parts.push(block.slice(last, m2.index));
      parts.push(<em key={m2.index} style={{ color:C.gold, fontStyle:'italic', opacity:0.9 }}>{m2[1]}</em>);
      last = re.lastIndex;
    }
    if (last < block.length) parts.push(block.slice(last));
    return <p key={bi} style={{ margin:0, marginTop: bi > 0 ? 16 : 0, fontSize:17, lineHeight:1.85, color:C.text }}>{parts}</p>;
  });
}

// ─── JOURNAL DIGEST ──────────────────────────────────────────────────────────
function buildJournalDigest(entries) {
  if (!entries.length) return '';
  const recent = entries.slice(-8);
  const lines = recent.map(e => {
    const d = new Date(e.savedAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
    const parts = [`[${d}]`];
    if (e.title) parts.push(`Title: ${e.title}`);
    if (e.dreamText) parts.push(`Dream: ${e.dreamText.slice(0, 300)}${e.dreamText.length > 300 ? '…' : ''}`);
    if (e.stage) parts.push(`Stage: ${e.stage}`);
    if (e.closingWord) parts.push(`Closing word: ${e.closingWord}`);
    return parts.join('\n');
  });
  return `\n\n─────────────────────────────\nPREVIOUS SESSIONS — JOURNAL DIGEST\n─────────────────────────────\n\nThe dreamer has had ${entries.length} previous session${entries.length > 1 ? 's' : ''}. Here are the most recent entries. Use this to notice recurring symbols, figures, emotional tones, or alchemical stages across sessions. If a pattern is visible, name it gently once, as an observation, not a verdict.\n\n${lines.join('\n\n')}`;
}

// ─── JOURNAL COMPONENTS ──────────────────────────────────────────────────────
function EntryCard({ entry, onOpen, onDelete }) {
  const date = new Date(entry.savedAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  const preview = entry.dreamText ? entry.dreamText.slice(0, 120) + (entry.dreamText.length > 120 ? '…' : '') : '';
  return (
    <div
      onClick={() => onOpen(entry)}
      style={{ background:'rgba(255,255,255,0.02)', border:`1px solid ${C.border}`, borderRadius:10, padding:'14px 16px', marginBottom:10, cursor:'pointer' }}
      onMouseEnter={e => e.currentTarget.style.borderColor='rgba(201,168,76,0.35)'}
      onMouseLeave={e => e.currentTarget.style.borderColor=C.border}
    >
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
        <div style={{ fontFamily:'system-ui,sans-serif', fontSize:11, color:C.gold, letterSpacing:'0.07em', opacity:0.7 }}>{date}</div>
        <button onClick={e => { e.stopPropagation(); onDelete(entry.id); }} style={{ background:'none', border:'none', color:'rgba(138,138,154,0.35)', fontSize:14, cursor:'pointer', lineHeight:1, padding:'0 0 0 8px' }}>×</button>
      </div>
      <div style={{ fontSize:14, color:C.text, marginBottom: preview ? 6 : 0, lineHeight:1.4 }}>{entry.title || 'Untitled dream'}</div>
      {preview && <div style={{ fontSize:12, color:C.muted, lineHeight:1.6, fontFamily:'system-ui,sans-serif' }}>{preview}</div>}
      {entry.stage && <div style={{ marginTop:8, fontSize:11, fontFamily:'system-ui,sans-serif', color:'rgba(201,168,76,0.5)', letterSpacing:'0.06em' }}>{entry.stage}</div>}
    </div>
  );
}

function EntryDetail({ entry, onBack, onSave }) {
  const [title, setTitle] = useState(entry.title || '');
  const [dateStr, setDateStr] = useState(() => new Date(entry.savedAt).toISOString().slice(0, 10));
  const [dirty, setDirty] = useState(false);

  function save() {
    onSave({ ...entry, title, savedAt: new Date(dateStr).getTime() || entry.savedAt });
    setDirty(false);
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={{ padding:'14px 16px 12px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
          <button onClick={onBack} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:18, lineHeight:1, padding:0 }}>←</button>
          <span style={{ fontFamily:'system-ui,sans-serif', fontSize:11, color:C.muted, letterSpacing:'0.06em' }}>Journal entry</span>
        </div>
        <input value={title} onChange={e => { setTitle(e.target.value); setDirty(true); }} placeholder="Title…" style={{ width:'100%', background:'none', border:'none', outline:'none', color:C.text, fontFamily:'Georgia,serif', fontSize:18, marginBottom:6 }} />
        <input type="date" value={dateStr} onChange={e => { setDateStr(e.target.value); setDirty(true); }} style={{ background:'none', border:'none', outline:'none', color:C.muted, fontFamily:'system-ui,sans-serif', fontSize:11 }} />
        {dirty && <button onClick={save} style={{ marginLeft:12, background:'rgba(201,168,76,0.12)', border:`1px solid rgba(201,168,76,0.3)`, color:C.gold, fontSize:11, fontFamily:'system-ui,sans-serif', padding:'3px 10px', borderRadius:4, cursor:'pointer' }}>Save</button>}
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'16px' }}>
        {entry.dreamText && (
          <div style={{ marginBottom:20 }}>
            <div style={{ fontFamily:'system-ui,sans-serif', fontSize:10, color:'rgba(201,168,76,0.5)', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:8 }}>Dream</div>
            <div style={{ fontSize:14, color:'#C8C0B0', lineHeight:1.7, fontFamily:'system-ui,sans-serif', whiteSpace:'pre-wrap' }}>{entry.dreamText}</div>
          </div>
        )}
        {entry.stage && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontFamily:'system-ui,sans-serif', fontSize:10, color:'rgba(201,168,76,0.5)', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:6 }}>Alchemical stage</div>
            <div style={{ fontSize:13, color:C.gold, fontFamily:'system-ui,sans-serif', opacity:0.8 }}>{entry.stage}</div>
          </div>
        )}
        {entry.closingWord && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontFamily:'system-ui,sans-serif', fontSize:10, color:'rgba(201,168,76,0.5)', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:6 }}>Closing word</div>
            <div style={{ fontSize:14, color:C.text, fontStyle:'italic' }}>{entry.closingWord}</div>
          </div>
        )}
        {entry.messages && entry.messages.length > 0 && (
          <div>
            <div style={{ fontFamily:'system-ui,sans-serif', fontSize:10, color:'rgba(201,168,76,0.5)', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:12 }}>Session</div>
            {entry.messages.map((m, i) => (
              <div key={i} style={{ marginBottom:14 }}>
                {m.role === 'user'
                  ? <div style={{ display:'flex', justifyContent:'flex-end' }}><div style={{ maxWidth:'85%', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:'10px 10px 2px 10px', padding:'9px 13px', fontSize:13, color:'#C8C0B0', fontFamily:'system-ui,sans-serif', whiteSpace:'pre-wrap', lineHeight:1.6 }}>{m.content}</div></div>
                  : <div style={{ fontSize:14, lineHeight:1.75, fontFamily:'Georgia,serif', borderLeft:'2px solid rgba(201,168,76,0.2)', paddingLeft:14 }}>{renderText(m.content)}</div>
                }
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SETTINGS TAB ─────────────────────────────────────────────────────────────
function SettingsPanel({ apiKey, onSave, journalCount }) {
  const [keyInput, setKeyInput] = useState(apiKey || '');
  const [saved, setSaved] = useState(false);
  const [showGuide, setShowGuide] = useState(!apiKey);

  function handleSave() {
    onSave(keyInput.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleRemove() {
    setKeyInput('');
    onSave('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{ flex:1, overflowY:'auto', padding:'20px' }}>
      <div style={{ fontFamily:'system-ui,sans-serif', fontSize:11, color:'rgba(201,168,76,0.5)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:16 }}>Your API key</div>

      <div style={{ fontSize:14, fontFamily:'system-ui,sans-serif', color:C.muted, lineHeight:1.7, marginBottom:18 }}>
        Dreamwork connects directly from this device to Claude using your own key — never through a server, never seen by anyone else. It's stored only in this browser, the same way your journal is.
      </div>

      <label style={{ display:'block', fontSize:11, fontFamily:'system-ui,sans-serif', color:C.gold, letterSpacing:'0.06em', marginBottom:8 }}>API KEY</label>
      <input
        type="password"
        value={keyInput}
        onChange={e => setKeyInput(e.target.value)}
        placeholder="sk-ant-..."
        style={{ width:'100%', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(201,168,76,0.22)', borderRadius:8, padding:'12px 14px', color:C.text, fontFamily:'monospace', fontSize:13, outline:'none', marginBottom:12 }}
      />

      <div style={{ display:'flex', gap:10, marginBottom:24 }}>
        <button onClick={handleSave} style={{ background:'rgba(201,168,76,0.12)', border:'1px solid rgba(201,168,76,0.4)', color:C.gold, fontSize:13, fontFamily:'system-ui,sans-serif', padding:'9px 18px', borderRadius:8, cursor:'pointer' }}>Save key</button>
        {apiKey && <button onClick={handleRemove} style={{ background:'none', border:'1px solid rgba(201,168,76,0.2)', color:C.muted, fontSize:13, fontFamily:'system-ui,sans-serif', padding:'9px 18px', borderRadius:8, cursor:'pointer' }}>Remove key</button>}
        {saved && <span style={{ fontSize:12, fontFamily:'system-ui,sans-serif', color:'rgba(201,168,76,0.6)', alignSelf:'center' }}>✓ Saved</span>}
      </div>

      <button onClick={() => setShowGuide(s => !s)} style={{ background:'none', border:'none', color:'rgba(201,168,76,0.6)', fontSize:12, fontFamily:'system-ui,sans-serif', cursor:'pointer', padding:0, marginBottom:14 }}>
        {showGuide ? '− Hide guide' : "+ How do I get an API key?"}
      </button>

      {showGuide && (
        <div style={{ background:'rgba(255,255,255,0.02)', border:`1px solid ${C.border}`, borderRadius:10, padding:'16px 18px', fontSize:13, fontFamily:'system-ui,sans-serif', color:'#C8C0B0', lineHeight:1.8 }}>
          <p style={{ margin:'0 0 12px' }}>This isn't a subscription — you only pay for what you actually use. Most personal use costs a few dollars a month at most.</p>
          <ol style={{ margin:0, paddingLeft:18 }}>
            <li style={{ marginBottom:8 }}>Go to <span style={{ color:C.gold }}>console.anthropic.com</span></li>
            <li style={{ marginBottom:8 }}>Create a free account with your email</li>
            <li style={{ marginBottom:8 }}>Add a payment method (pay-as-you-go, not a flat fee)</li>
            <li style={{ marginBottom:8 }}>Click "API Keys" in the left menu, then "Create Key"</li>
            <li style={{ marginBottom:8 }}>Give it any name (e.g. "Dreamwork") and click Create</li>
            <li style={{ marginBottom:8 }}>Copy the long code it shows you — you won't see it again after leaving the page</li>
            <li>Paste it into the field above and click "Save key"</li>
          </ol>
          <p style={{ margin:'12px 0 0', color:C.muted }}>Treat this key like a password. Dreamwork only ever stores it on this device.</p>
        </div>
      )}

      {SURVEY_URL && SURVEY_URL !== 'PASTE_YOUR_GOOGLE_FORM_LINK_HERE' && (
        <>
          <div style={{ fontFamily:'system-ui,sans-serif', fontSize:11, color:'rgba(201,168,76,0.5)', letterSpacing:'0.08em', textTransform:'uppercase', margin:'32px 0 12px' }}>Feedback</div>
          {journalCount >= SURVEY_TRIGGER_SESSIONS ? (
            <a href={SURVEY_URL} target="_blank" rel="noopener noreferrer" style={{ display:'inline-block', background:'rgba(201,168,76,0.12)', border:'1px solid rgba(201,168,76,0.4)', color:C.gold, fontSize:13, fontFamily:'system-ui,sans-serif', padding:'9px 18px', borderRadius:8, textDecoration:'none' }}>Share feedback</a>
          ) : (
            <div style={{ fontSize:13, fontFamily:'system-ui,sans-serif', color:C.muted, lineHeight:1.6 }}>
              The feedback survey unlocks after {SURVEY_TRIGGER_SESSIONS} sessions — you're at {journalCount} so far.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [journal, setJournal] = useState(() => loadJournal());
  const [openEntry, setOpenEntry] = useState(null);
  const [sessionSaved, setSessionSaved] = useState(false);
  const [mode, setMode] = useState(null);
  const [currentEntryId, setCurrentEntryId] = useState(null);
  const [resumeAvailable, setResumeAvailable] = useState(null); // holds the pending active session, if any
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [surveyDismissed, setSurveyDismissed] = useState(() => loadSurveyDismissed());
  const [editingIdx, setEditingIdx] = useState(null);
  const [editText, setEditText] = useState('');
  const bottomRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // On load, check for an unfinished session to offer resuming
  useEffect(() => {
    const active = loadActiveSession();
    if (active && active.messages && active.messages.length > 0) {
      setResumeAvailable(active);
    }
    // Restore any unsent typed text regardless — it belongs to whichever
    // session (new or resumed) the person ends up in
    const draft = loadDraft();
    if (draft && draft.text) {
      setInput(draft.text);
      if (!active && draft.mode) setMode(draft.mode);
    }
  }, []);

  // Save draft text as it's typed, debounced slightly
  useEffect(() => {
    const timer = setTimeout(() => {
      saveDraft(input, mode);
    }, 300);
    return () => clearTimeout(timer);
  }, [input, mode]);

  // Keep textarea height in sync with content, including when restored from a draft
  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = '48px';
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 140) + 'px';
    }
  }, [input]);

  function resumeSession() {
    if (!resumeAvailable) return;
    setMessages(resumeAvailable.messages);
    setMode(resumeAvailable.mode || null);
    setCurrentEntryId(resumeAvailable.entryId || null);
    setResumeAvailable(null);
  }

  function dismissResume() {
    clearActiveSession();
    setResumeAvailable(null);
  }

  function handleSaveApiKey(key) {
    saveApiKey(key);
    setApiKey(key);
  }

  // Sends a given message history to Claude and handles the reply.
  // Separated from send() so a failed attempt can be retried with the
  // exact same history, without the person needing to retype anything.
  async function callClaude(history) {
    setErrorMsg('');
    setLoading(true);

    const modePrefix = mode ? MODE_PREFIX[mode] : '';
    const digest = buildJournalDigest(journal);
    const system = SYSTEM_PROMPT + modePrefix + digest;

    try {
      // Calls Claude directly from this device, using the user's own key.
      // No server sits in between — this is what makes the app work with
      // zero backend cost, and keeps the key on this device only.
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 3000,
          system,
          messages: history.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        if (res.status === 401) {
          throw new Error('Your API key was rejected. Check it in Settings and try again.');
        }
        throw new Error(`${res.status}: ${err.slice(0, 200)}`);
      }

      const data = await res.json();
      const reply = data?.content?.[0]?.text ?? '';
      if (!reply) throw new Error('Empty reply');

      const finalMessages = [...history, { role: 'assistant', content: reply }];
      setMessages(finalMessages);
      upsertSession(finalMessages);
    } catch (e) {
      setErrorMsg(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    if (!apiKey) {
      setErrorMsg('Add your API key in Settings before starting a session.');
      return;
    }

    setInput('');
    setSessionSaved(false);

    const history = [...messages, { role: 'user', content: text }];
    setMessages(history);
    callClaude(history);
  }

  // Resends the last message exactly as it was, after a failed attempt —
  // no retyping or re-pasting needed.
  function retry() {
    if (loading) return;
    if (!messages.length || messages[messages.length - 1].role !== 'user') return;
    callClaude(messages);
  }

  // Editing is only offered on the most recent message someone sent, to
  // keep things simple. Saving an edit drops anything that came after it
  // (i.e. the old reply, if there was one) and asks Claude to respond
  // fresh to the corrected version — same as fixing a typo before you'd
  // sent it in the first place.
  function startEdit(idx) {
    if (loading) return;
    setEditingIdx(idx);
    setEditText(messages[idx].content);
  }

  function cancelEdit() {
    setEditingIdx(null);
    setEditText('');
  }

  function saveEdit() {
    const text = editText.trim();
    if (!text) return;
    const corrected = [...messages.slice(0, editingIdx), { role: 'user', content: text }];
    setMessages(corrected);
    setEditingIdx(null);
    setEditText('');
    setSessionSaved(false);
    callClaude(corrected);
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function upsertSession(msgs) {
    if (msgs.length < 2) return;
    const dreamText = msgs[0]?.role === 'user' ? msgs[0].content : '';
    const allText = msgs.map(m => m.content).join(' ').toLowerCase();
    const stageMap = [
      ['Nigredo', ['nigredo','blackening','darkness','dissolution','descent']],
      ['Albedo',  ['albedo','whitening','silver','reflection','first light']],
      ['Citrinitas', ['citrinitas','yellowing','solar']],
      ['Rubedo',  ['rubedo','reddening','integration','sacred marriage','wholeness']],
    ];
    let stage = '';
    for (const [name, keywords] of stageMap) {
      if (keywords.some(k => allText.includes(k))) { stage = name; break; }
    }
    const lastUser = [...msgs].reverse().find(m => m.role === 'user' && msgs.indexOf(m) > 0);
    const closingWord = lastUser && lastUser.content.split(' ').length <= 8 ? lastUser.content : '';

    setJournal(prevJournal => {
      let updated;
      if (currentEntryId && prevJournal.some(e => e.id === currentEntryId)) {
        // Update existing entry in place
        updated = prevJournal.map(e => e.id === currentEntryId
          ? { ...e, messages: msgs, stage, closingWord }
          : e
        );
      } else {
        // Create new entry
        const newId = Date.now().toString();
        const entry = {
          id: newId,
          savedAt: Date.now(),
          title: dreamText.split(' ').slice(0, 6).join(' ') + '…',
          dreamText,
          messages: msgs,
          stage,
          closingWord,
          mode,
        };
        updated = [...prevJournal, entry];
        setCurrentEntryId(newId);
      }
      saveJournal(updated);
      // Track this as the in-progress session, so it can be resumed if the app is closed
      const entryIdForActive = currentEntryId && prevJournal.some(e => e.id === currentEntryId)
        ? currentEntryId
        : updated[updated.length - 1].id;
      saveActiveSession({ entryId: entryIdForActive, messages: msgs, mode });
      return updated;
    });
    setSessionSaved(true);
  }

  function newSession() {
    setMessages([]);
    setInput('');
    setErrorMsg('');
    setSessionSaved(false);
    setMode(null);
    setCurrentEntryId(null);
    setResumeAvailable(null);
    clearActiveSession();
    saveDraft('', null);
    if (taRef.current) { taRef.current.style.height = '48px'; }
  }

  function updateEntry(updated) {
    const newJournal = journal.map(e => e.id === updated.id ? updated : e);
    setJournal(newJournal);
    setOpenEntry(updated);
    saveJournal(newJournal);
  }

  function deleteEntry(id) {
    const newJournal = journal.filter(e => e.id !== id);
    setJournal(newJournal);
    saveJournal(newJournal);
    if (openEntry?.id === id) setOpenEntry(null);
  }

  function dismissSurvey() {
    saveSurveyDismissed();
    setSurveyDismissed(true);
  }

  const hasMessages = messages.length > 0;
  let lastUserMsgIdx = -1;
  for (let idx = messages.length - 1; idx >= 0; idx--) {
    if (messages[idx].role === 'user') { lastUserMsgIdx = idx; break; }
  }
  // Only turns on once a real link has been pasted in above, and once
  // someone has reached the session count — never before either is true.
  const surveyConfigured = SURVEY_URL && SURVEY_URL !== 'PASTE_YOUR_GOOGLE_FORM_LINK_HERE';
  const surveyEligible = surveyConfigured && journal.length >= SURVEY_TRIGGER_SESSIONS;
  const showSurveyBanner = surveyEligible && !surveyDismissed;

  return (
    <div style={{ background:C.bg, color:C.text, minHeight:'100dvh', fontFamily:'Georgia,serif', display:'flex', flexDirection:'column', maxWidth:700, margin:'0 auto' }}>

      {/* Header */}
      <div style={{ padding:'18px 20px 0', flexShrink:0 }}>
        <div style={{ height:1, background:`linear-gradient(90deg,transparent,${C.gold},transparent)`, marginBottom:12 }} />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingBottom:12, borderBottom:`1px solid ${C.border}` }}>
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            <span style={{ color:C.gold, fontSize:16, letterSpacing:'0.14em', textTransform:'uppercase', fontWeight:300 }}>Dreamwork</span>
            {hasMessages && mode && (
              <span style={{ fontSize:10, fontFamily:'system-ui,sans-serif', color:'rgba(201,168,76,0.45)', letterSpacing:'0.1em', textTransform:'uppercase' }}>
                {mode === 'dream' ? 'Dream session' : 'Synchronicity session'}
              </span>
            )}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {['chat','journal','settings'].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ background: tab===t ? 'rgba(201,168,76,0.12)' : 'none', border:`1px solid ${tab===t ? 'rgba(201,168,76,0.35)' : 'rgba(201,168,76,0.15)'}`, color: tab===t ? C.gold : (t === 'settings' && !apiKey ? '#D0A050' : C.muted), fontSize:11, letterSpacing:'0.07em', textTransform:'uppercase', padding:'4px 12px', borderRadius:4, cursor:'pointer', fontFamily:'inherit' }}>
                {t === 'journal' ? `Journal${journal.length ? ` (${journal.length})` : ''}` : t === 'settings' ? `Settings${!apiKey ? ' •' : ''}` : 'Dream'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Feedback survey banner — shown once, on whichever tab someone is on */}
      {showSurveyBanner && (
        <div style={{ margin:'12px 20px 0', padding:'12px 14px', background:'rgba(201,168,76,0.08)', border:'1px solid rgba(201,168,76,0.3)', borderRadius:8, display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
          <div style={{ flex:1, fontSize:12, fontFamily:'system-ui,sans-serif', color:'#C8C0B0', lineHeight:1.5 }}>
            You've had {journal.length} sessions with Dreamwork — I'd love to hear how it's been.
          </div>
          <a href={SURVEY_URL} target="_blank" rel="noopener noreferrer" onClick={dismissSurvey} style={{ background:'rgba(201,168,76,0.15)', border:'1px solid rgba(201,168,76,0.4)', color:C.gold, fontSize:11, fontFamily:'system-ui,sans-serif', padding:'6px 12px', borderRadius:6, textDecoration:'none', whiteSpace:'nowrap', flexShrink:0 }}>Share feedback</a>
          <button onClick={dismissSurvey} style={{ background:'none', border:'none', color:'rgba(138,138,154,0.5)', fontSize:16, cursor:'pointer', lineHeight:1, padding:0, flexShrink:0 }}>×</button>
        </div>
      )}

      {/* Chat tab */}
      {tab === 'chat' && (
        <>
          <div style={{ flex:1, overflowY:'auto', padding:'20px' }}>
            {!hasMessages && (
              <div style={{ textAlign:'center', padding:'40px 16px' }}>
                <div style={{ fontSize:34, opacity:0.2, marginBottom:18 }}>◯</div>
                {!apiKey ? (
                  <>
                    <div style={{ fontSize:22, fontWeight:300, marginBottom:10 }}>Add your key to begin</div>
                    <div style={{ width:36, height:1, background:'rgba(201,168,76,0.3)', margin:'0 auto 16px' }} />
                    <div style={{ fontSize:13, fontFamily:'system-ui,sans-serif', color:C.muted, lineHeight:1.7, maxWidth:300, margin:'0 auto 20px' }}>
                      Dreamwork connects directly from your device to Claude using your own API key — no server, no cost to anyone but you for what you use.
                    </div>
                    <button onClick={() => setTab('settings')} style={{ background:'rgba(201,168,76,0.12)', border:'1px solid rgba(201,168,76,0.4)', color:C.gold, fontSize:13, fontFamily:'system-ui,sans-serif', padding:'9px 18px', borderRadius:8, cursor:'pointer' }}>Go to Settings</button>
                  </>
                ) : resumeAvailable ? (
                  <>
                    <div style={{ fontSize:22, fontWeight:300, marginBottom:8 }}>Continue where you left off?</div>
                    <div style={{ width:36, height:1, background:'rgba(201,168,76,0.3)', margin:'0 auto 16px' }} />
                    <div style={{ fontSize:13, fontFamily:'system-ui,sans-serif', color:C.muted, lineHeight:1.7, maxWidth:320, margin:'0 auto 18px' }}>
                      It looks like a {resumeAvailable.mode === 'sync' ? 'synchronicity' : 'dream'} session was still open when you last closed Dreamwork.
                      {resumeAvailable.messages[0]?.content && (
                        <div style={{ marginTop:10, fontSize:12, color:'rgba(200,192,176,0.7)', fontStyle:'italic', lineHeight:1.6 }}>
                          "{resumeAvailable.messages[0].content.slice(0, 100)}{resumeAvailable.messages[0].content.length > 100 ? '…' : ''}"
                        </div>
                      )}
                    </div>
                    <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
                      <button onClick={resumeSession} style={{ background:'rgba(201,168,76,0.12)', border:'1px solid rgba(201,168,76,0.4)', color:C.gold, fontSize:13, fontFamily:'system-ui,sans-serif', padding:'9px 18px', borderRadius:8, cursor:'pointer' }}>Continue session</button>
                      <button onClick={dismissResume} style={{ background:'none', border:'1px solid rgba(201,168,76,0.2)', color:C.muted, fontSize:13, fontFamily:'system-ui,sans-serif', padding:'9px 18px', borderRadius:8, cursor:'pointer' }}>Start fresh</button>
                    </div>
                  </>
                ) : !mode ? (
                  <>
                    <div style={{ fontSize:22, fontWeight:300, marginBottom:8 }}>What would you like to bring?</div>
                    <div style={{ width:36, height:1, background:'rgba(201,168,76,0.3)', margin:'0 auto 20px' }} />
                    <div style={{ display:'flex', gap:12, justifyContent:'center', marginBottom:24 }}>
                      {[
                        { key:'dream', label:'A dream', sub:'Describe what you saw, felt, and experienced' },
                        { key:'sync',  label:'A coincidence', sub:'Something in the outer world that felt meaningful' },
                      ].map(({ key, label, sub }) => (
                        <button key={key} onClick={() => setMode(key)} style={{ background:'rgba(201,168,76,0.06)', border:`1px solid rgba(201,168,76,0.25)`, borderRadius:10, padding:'16px 18px', cursor:'pointer', textAlign:'left', width:160 }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(201,168,76,0.5)'; e.currentTarget.style.background='rgba(201,168,76,0.1)'; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(201,168,76,0.25)'; e.currentTarget.style.background='rgba(201,168,76,0.06)'; }}
                        >
                          <div style={{ color:C.gold, fontSize:15, fontFamily:'Georgia,serif', fontWeight:300, marginBottom:6 }}>{label}</div>
                          <div style={{ color:C.muted, fontSize:11, fontFamily:'system-ui,sans-serif', lineHeight:1.5 }}>{sub}</div>
                        </button>
                      ))}
                    </div>
                    {journal.length > 0 && <div style={{ fontSize:11, fontFamily:'system-ui,sans-serif', color:'rgba(201,168,76,0.35)', letterSpacing:'0.05em' }}>{journal.length} session{journal.length > 1 ? 's' : ''} in your journal</div>}
                  </>
                ) : (
                  <>
                    <div style={{ fontSize:22, fontWeight:300, marginBottom:10 }}>{mode === 'dream' ? 'Tell me your dream.' : 'Describe the coincidence.'}</div>
                    <div style={{ width:36, height:1, background:'rgba(201,168,76,0.3)', margin:'0 auto 14px' }} />
                    <div style={{ fontSize:13, fontFamily:'system-ui,sans-serif', color:C.muted, lineHeight:1.7, maxWidth:320, margin:'0 auto 14px' }}>
                      {mode === 'dream' ? 'Describe it as it was — not what you think it means, but what happened, what you saw, what you felt.' : 'What happened? When did it strike you as significant? What were you thinking or feeling at the time?'}
                    </div>
                    <div style={{ fontSize:14, fontStyle:'italic', color:'rgba(201,168,76,0.55)', marginBottom:14 }}>
                      {mode === 'dream' ? 'The dream does not conceal. It reveals.' : 'Treat it exactly as you would a dream — stay with the image.'}
                    </div>
                    <button onClick={() => setMode(null)} style={{ background:'none', border:'none', color:'rgba(138,138,154,0.4)', fontSize:11, fontFamily:'system-ui,sans-serif', cursor:'pointer' }}>← change</button>
                  </>
                )}
              </div>
            )}

            {messages.map((m, i) => {
              // The most recent user message stays editable even after it's
              // been answered — not just when a send has failed.
              const isLastUserMsg = i === lastUserMsgIdx;
              const isEditing = editingIdx === i;
              return (
                <div key={i} style={{ marginBottom:24 }}>
                  {m.role === 'user'
                    ? isEditing
                      ? <div>
                          <textarea
                            value={editText}
                            onChange={e => setEditText(e.target.value)}
                            autoFocus
                            rows={3}
                            style={{ width:'100%', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(201,168,76,0.35)', borderRadius:8, padding:'11px 15px', fontSize:14, lineHeight:1.6, fontFamily:'system-ui,sans-serif', color:C.text, resize:'vertical', outline:'none' }}
                          />
                          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:8 }}>
                            <button onClick={cancelEdit} style={{ background:'none', border:'1px solid rgba(201,168,76,0.2)', color:C.muted, fontSize:12, fontFamily:'system-ui,sans-serif', padding:'6px 14px', borderRadius:6, cursor:'pointer' }}>Cancel</button>
                            <button onClick={saveEdit} disabled={!editText.trim()} style={{ background:'rgba(201,168,76,0.12)', border:'1px solid rgba(201,168,76,0.4)', color:C.gold, fontSize:12, fontFamily:'system-ui,sans-serif', padding:'6px 14px', borderRadius:6, cursor:'pointer', opacity: editText.trim() ? 1 : 0.4 }}>Save & re-interpret</button>
                          </div>
                        </div>
                      : <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end' }}>
                          <div style={{ maxWidth:'80%', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:'12px 12px 2px 12px', padding:'11px 15px', fontSize:14, lineHeight:1.6, fontFamily:'system-ui,sans-serif', color:'#C8C0B0', whiteSpace:'pre-wrap' }}>{m.content}</div>
                          {isLastUserMsg && !loading && (
                            <button onClick={() => startEdit(i)} style={{ background:'none', border:'none', color:'rgba(201,168,76,0.45)', fontSize:11, fontFamily:'system-ui,sans-serif', cursor:'pointer', padding:'4px 2px 0' }}>✎ Edit</button>
                          )}
                        </div>
                    : <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                        <div style={{ width:24, height:24, borderRadius:'50%', flexShrink:0, marginTop:4, background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.25)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:C.gold }}>◈</div>
                        <div style={{ flex:1, background:C.bgAi, border:'1px solid rgba(201,168,76,0.12)', borderRadius:'2px 12px 12px 12px', padding:'16px 20px' }}>{renderText(m.content)}</div>
                      </div>
                  }
                </div>
              );
            })}

            {loading && (
              <div style={{ display:'flex', gap:12, alignItems:'flex-start', marginBottom:20 }}>
                <div style={{ width:24, height:24, borderRadius:'50%', flexShrink:0, background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.25)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:C.gold }}>◈</div>
                <div style={{ background:C.bgAi, border:'1px solid rgba(201,168,76,0.12)', borderRadius:'2px 12px 12px 12px', padding:'15px 18px', display:'flex', gap:5, alignItems:'center' }}>
                  {[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:'50%', background:'rgba(201,168,76,0.5)', animation:'pulse 1.4s ease-in-out infinite', animationDelay:`${i*0.2}s` }} />)}
                </div>
              </div>
            )}

            {errorMsg && <div style={{ margin:'0 0 20px 36px', padding:'10px 14px', background:'rgba(180,60,60,0.12)', border:'1px solid rgba(180,60,60,0.3)', borderRadius:6, fontSize:12, color:'#D08080', fontFamily:'monospace', wordBreak:'break-all' }}>{errorMsg}</div>}

            {sessionSaved && !loading && <div style={{ textAlign:'center', margin:'0 0 16px', fontSize:11, fontFamily:'system-ui,sans-serif', color:'rgba(201,168,76,0.4)', letterSpacing:'0.06em' }}>✓ Saved to journal</div>}

            <div ref={bottomRef} />
          </div>

          <div style={{ padding:'0 20px 20px', flexShrink:0 }}>
            <div style={{ height:1, background:`linear-gradient(90deg,transparent,${C.border},transparent)`, marginBottom:12 }} />
            {hasMessages && (
              <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
                <button onClick={newSession} style={{ background:'none', border:'1px solid rgba(201,168,76,0.2)', color:'rgba(201,168,76,0.5)', fontSize:10, letterSpacing:'0.07em', textTransform:'uppercase', padding:'3px 10px', borderRadius:4, cursor:'pointer', fontFamily:'inherit' }}>New session</button>
              </div>
            )}
            <div style={{ display:'flex', gap:8, alignItems:'flex-end', opacity: editingIdx !== null ? 0.35 : 1, pointerEvents: editingIdx !== null ? 'none' : 'auto' }}>
              <textarea ref={taRef} value={input}
                onChange={e => { setInput(e.target.value); e.target.style.height='48px'; e.target.style.height=Math.min(e.target.scrollHeight,140)+'px'; }}
                onKeyDown={handleKey}
                disabled={editingIdx !== null}
                placeholder={mode === 'sync' ? 'Describe the coincidence — what happened, when it struck you, what you were feeling…' : 'Describe your dream — what happened, what you saw, what you felt…'}
                rows={1}
                style={{ flex:1, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(201,168,76,0.22)', borderRadius:8, padding:'12px 14px', color:C.text, fontFamily:'Georgia,serif', fontSize:15, resize:'none', outline:'none', minHeight:48, maxHeight:140, lineHeight:1.5 }}
              />
              <button onClick={send} disabled={!input.trim() || loading || editingIdx !== null} style={{ width:44, height:44, borderRadius:8, border:'1px solid rgba(201,168,76,0.3)', background:'rgba(201,168,76,0.1)', color:C.gold, cursor:'pointer', fontSize:20, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, opacity:(!input.trim() || loading) ? 0.3 : 1 }}>↑</button>
            </div>
            {editingIdx !== null && <div style={{ marginTop:6, fontSize:11, color:'rgba(201,168,76,0.4)', textAlign:'center', fontFamily:'system-ui,sans-serif' }}>Finish editing above before sending a new message</div>}

            {/* Shown only when the last message never got a reply — lets the
                person resend exactly what they wrote without retyping it. */}
            {!loading && errorMsg && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
              <div style={{ display:'flex', justifyContent:'center', marginTop:10 }}>
                <button onClick={retry} style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.35)', color:C.gold, fontSize:12, fontFamily:'system-ui,sans-serif', padding:'7px 16px', borderRadius:8, cursor:'pointer' }}>
                  <span style={{ fontSize:14 }}>↻</span> Try sending that again
                </button>
              </div>
            )}

            <div style={{ marginTop:7, fontSize:11, color:'rgba(138,138,154,0.3)', textAlign:'center', fontFamily:'system-ui,sans-serif' }}>Enter to send · Shift+Enter for new line</div>
          </div>
        </>
      )}

      {/* Journal tab */}
      {tab === 'journal' && (
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          {openEntry ? (
            <EntryDetail entry={openEntry} onBack={() => setOpenEntry(null)} onSave={updateEntry} />
          ) : (
            <div style={{ flex:1, overflowY:'auto', padding:'20px' }}>
              {journal.length === 0 ? (
                <div style={{ textAlign:'center', padding:'48px 16px' }}>
                  <div style={{ fontSize:30, opacity:0.2, marginBottom:16 }}>◯</div>
                  <div style={{ fontSize:16, fontWeight:300, marginBottom:10 }}>No entries yet.</div>
                  <div style={{ fontSize:13, fontFamily:'system-ui,sans-serif', color:C.muted, lineHeight:1.7, maxWidth:280, margin:'0 auto' }}>Sessions are saved here after you work through a dream.</div>
                </div>
              ) : (
                <>
                  <div style={{ fontFamily:'system-ui,sans-serif', fontSize:11, color:'rgba(201,168,76,0.5)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:14 }}>{journal.length} session{journal.length > 1 ? 's' : ''}</div>
                  {[...journal].reverse().map(entry => <EntryCard key={entry.id} entry={entry} onOpen={setOpenEntry} onDelete={deleteEntry} />)}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Settings tab */}
      {tab === 'settings' && (
        <SettingsPanel apiKey={apiKey} onSave={handleSaveApiKey} journalCount={journal.length} />
      )}

      <style>{`
        @keyframes pulse { 0%,80%,100%{opacity:.3;transform:scale(.8)}40%{opacity:1;transform:scale(1.1)} }
        textarea{-webkit-appearance:none;}
        textarea::placeholder{color:rgba(138,138,154,0.4);}
        *{-webkit-tap-highlight-color:transparent;box-sizing:border-box;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:rgba(201,168,76,0.2);border-radius:2px;}
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.4);}
      `}</style>
    </div>
  );
}
