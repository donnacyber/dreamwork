import { useState, useRef, useEffect } from 'react';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { idbGetAllEntries, idbPutEntry, idbDeleteEntry, idbUpsertMany, migrateLegacyJournalIfNeeded } from './journalStore.js';

// ─── MODE PREFIXES ──────────────────────────────────────────────────────────
const MODE_PREFIX = {
  dream: `\n\nACTIVE MODE: DREAM\nThe user has selected Dream mode. Lead with the dream reading framework. Do not open with synchronicity framing.`,
  sync:  `\n\nACTIVE MODE: SYNCHRONICITY\nThe user has selected Synchronicity mode. Lead with the synchronicity reading framework. Do not open with dream reading framing.`,
};

// ─── EXPERIENCE LEVEL PREFIXES ──────────────────────────────────────────────
// A calibration note based on how familiar this person said they are with
// Jungian psychology / dream work. Adjusts register and pacing, not the
// underlying framework — these are firm behavioral instructions, not a
// general tone suggestion, since a single soft line tends to get outweighed
// by the density of the framework material earlier in the prompt.
const EXPERIENCE_PREFIX = {
  beginner: `\n\nDREAMER'S EXPERIENCE LEVEL: NEW TO THIS\nThis person is new to Jungian psychology and dream work. Treat the following as firm behavioral rules for this whole session, not general tone guidance.\n\nPlain language, always: the moment a technical term (archetype, shadow, individuation, complex, the name of an alchemical stage, etc.) would appear, either replace it with a plain-language equivalent or ground it in one plain sentence before continuing. Never assume prior familiarity with any framework in this prompt.\n\nFirst message of a new session: this person often writes out a long, detailed account before you've asked anything, because sitting with the images and getting the detail out took real effort. Honour that. Do not open with only an orienting question. Instead, briefly and warmly reflect back each significant symbol, image, or figure they named, in the order they named it — one or two plain sentences each — so they feel the dream was actually received before anything else happens. Keep this brief per symbol; this is acknowledgment, not full interpretation. Then close with exactly one simple, plain-language question, never more than one.\n\nPace for the rest of the session: one simple question per response, always. Do not stack multiple frameworks, alchemical stages, or archetypal lenses into a single response. Prefer a shorter response that leaves something unexplored over a comprehensive one that overwhelms.`,
  some: `\n\nDREAMER'S EXPERIENCE LEVEL: SOME FAMILIARITY\nThis person has some familiarity with this material. Use the framework's vocabulary naturally, but briefly ground any less common term the first time it appears in a session.\n\nFirst message of a new session: briefly reflect back the one or two most prominent symbols or images they named, in plain terms, before moving into questions — so the dream feels received rather than immediately queued for interrogation. After that, a moderate pace is fine: it's fine to move a little more quickly than with a newcomer, but keep each response focused on one thread rather than piling several frameworks into a single turn.`,
  experienced: `\n\nDREAMER'S EXPERIENCE LEVEL: VERY FAMILIAR\nThis person is very familiar with Jungian psychology and dream work. Use the full vocabulary of the framework freely, without pausing to define standard terms.`,
};

// ─── FEEDBACK SURVEY ────────────────────────────────────────────────────────
// Replace the text below with your real Google Form link once you've made one.
// Until you do, this feature stays silently off — no banner will appear.
const SURVEY_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfujAdi_LmTHgylMCEGEeipeKzSeG27OfzU6t-bi3Y45BZhag/viewform';
const SURVEY_TRIGGER_SESSIONS = 30; // number of completed journal entries before the prompt appears

// ─── OPENING SCREEN REMINDER ────────────────────────────────────────────────
// A short, standing reminder shown under the "dream / coincidence" choice,
// every time — not a one-time popup. Edit the text below any time; it
// updates for everyone the next time you deploy.
const REMINDER_TEXT = `A gentle reminder: it takes patience to sit with an image long enough for it to speak. However odd, fragmentary, or insignificant it feels — even just a snippet, or only a trace of feeling with no image at all — it's still worth bringing here. You may be surprised what the symbols reveal. Take your time, stay open, and be easy on yourself.`;

// ─── DISCLAIMER ──────────────────────────────────────────────────────────────
// Shown once, in full, before anyone's first session — they have to
// acknowledge it to continue. Always stays readable afterward, in Settings.
//
// To edit later: change the text below. If you make a meaningful change
// (not just fixing a typo), bump DISCLAIMER_VERSION (e.g. 'v1' to 'v2') so
// everyone has to see and acknowledge the new version, even people who
// already accepted an earlier one.
const DISCLAIMER_VERSION = 'v1';
const DISCLAIMER_TEXT = `Dreamwork is a personal reflection tool inspired by Jungian psychology. It works with the symbols, images, and patterns that dreams and meaningful coincidences bring up — it does not diagnose, treat, or provide medical or mental health advice, and it is not a substitute for care from a qualified professional.

Sitting with a dream can occasionally bring up something intense or unexpected. If that happens, and it feels like more than you can hold alone, please reach out to a real person — a friend, a therapist, a doctor, or a crisis service. In the UK, Samaritans are reachable anytime on 116 123. In the US and Canada, you can call or text 988. Wherever you are, your local emergency number is always a valid place to start.

This app is meant for general adult reflection. Whatever it reflects back to you is an invitation to think and feel further — not a verdict, and not the final word on what something means. You remain the person who knows your own life best.`;

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
// The journal itself now lives in IndexedDB (see journalStore.js) instead of
// localStorage — see the functions imported above. Everything else on this
// device (API key, drafts, the in-progress session, settings) is small and
// fixed in size, so it stays in localStorage exactly as before; only the
// journal, which grows without bound, needed the larger, more efficient store.

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

// ─── DISCLAIMER ACKNOWLEDGMENT ─────────────────────────────────────────────────
// Which version of the disclaimer this device has already acknowledged.
// Compared against DISCLAIMER_VERSION so a meaningful rewrite can require
// everyone to see and accept it again.
function loadAcknowledgedDisclaimerVersion() {
  try {
    return localStorage.getItem('dreamwork_disclaimer_ack') || '';
  } catch { return ''; }
}

function saveAcknowledgedDisclaimerVersion(version) {
  try {
    localStorage.setItem('dreamwork_disclaimer_ack', version);
  } catch (e) { console.error('Disclaimer acknowledgment save failed', e); }
}

// ─── EXPERIENCE LEVEL ─────────────────────────────────────────────────────────
// How familiar this person said they are with Jungian psychology / dream
// work — 'beginner', 'some', or 'experienced'. Empty string means they
// haven't been asked (or chose to skip) yet.
function loadExperienceLevel() {
  try {
    return localStorage.getItem('dreamwork_experience_level') || '';
  } catch { return ''; }
}

function saveExperienceLevel(level) {
  try {
    localStorage.setItem('dreamwork_experience_level', level);
  } catch (e) { console.error('Experience level save failed', e); }
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
function SettingsPanel({ apiKey, onSave, journalCount, experienceLevel, onChooseExperienceLevel, onExport, onImport }) {
  const [keyInput, setKeyInput] = useState(apiKey || '');
  const [saved, setSaved] = useState(false);
  const [showGuide, setShowGuide] = useState(!apiKey);
  const [importStatus, setImportStatus] = useState(null);

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

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so importing the same filename again still fires onChange
    if (!file) return;
    setImportStatus({ type: 'pending', text: 'Importing…' });
    const result = await onImport(file);
    setImportStatus(
      result.ok
        ? { type: 'ok', text: `Imported ${result.count} ${result.count === 1 ? 'entry' : 'entries'}.` }
        : { type: 'error', text: result.error }
    );
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

      <div style={{ fontFamily:'system-ui,sans-serif', fontSize:11, color:'rgba(201,168,76,0.5)', letterSpacing:'0.08em', textTransform:'uppercase', margin:'32px 0 12px' }}>Experience level</div>
      <div style={{ fontSize:13, fontFamily:'system-ui,sans-serif', color:C.muted, lineHeight:1.6, marginBottom:14 }}>
        How familiar you are with Jungian psychology or dream work — this changes how much Dreamwork explains as it goes.
      </div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {[
          { key:'beginner', label:'New to this' },
          { key:'some', label:'Some familiarity' },
          { key:'experienced', label:'Very familiar' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => onChooseExperienceLevel(key)} style={{ background: experienceLevel===key ? 'rgba(201,168,76,0.15)' : 'none', border:`1px solid ${experienceLevel===key ? 'rgba(201,168,76,0.5)' : 'rgba(201,168,76,0.25)'}`, color: experienceLevel===key ? C.gold : C.muted, fontSize:12, fontFamily:'system-ui,sans-serif', padding:'8px 14px', borderRadius:8, cursor:'pointer' }}>{label}</button>
        ))}
      </div>

      <div style={{ fontFamily:'system-ui,sans-serif', fontSize:11, color:'rgba(201,168,76,0.5)', letterSpacing:'0.08em', textTransform:'uppercase', margin:'32px 0 12px' }}>Backup</div>
      <div style={{ fontSize:13, fontFamily:'system-ui,sans-serif', color:C.muted, lineHeight:1.7, marginBottom:14 }}>
        Your journal lives only on this device. Export it to a file any time — save that file to Sync, Dropbox, iCloud Drive, an external drive, wherever you like — and import it back in later, here or on another device.
      </div>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
        <button
          onClick={onExport}
          disabled={journalCount === 0}
          style={{ background:'rgba(201,168,76,0.12)', border:'1px solid rgba(201,168,76,0.4)', color:C.gold, fontSize:13, fontFamily:'system-ui,sans-serif', padding:'9px 18px', borderRadius:8, cursor: journalCount === 0 ? 'default' : 'pointer', opacity: journalCount === 0 ? 0.4 : 1 }}
        >
          Export journal{journalCount ? ` (${journalCount})` : ''}
        </button>
        <label style={{ background:'none', border:'1px solid rgba(201,168,76,0.2)', color:C.muted, fontSize:13, fontFamily:'system-ui,sans-serif', padding:'9px 18px', borderRadius:8, cursor:'pointer', display:'inline-block' }}>
          Import journal
          <input type="file" accept="application/json" onChange={handleFileChange} style={{ display:'none' }} />
        </label>
      </div>
      {importStatus && (
        <div style={{ marginTop:10, fontSize:12, fontFamily:'system-ui,sans-serif', color: importStatus.type === 'error' ? '#D08080' : 'rgba(201,168,76,0.7)' }}>
          {importStatus.type === 'error' ? '⚠ ' : importStatus.type === 'ok' ? '✓ ' : ''}{importStatus.text}
        </div>
      )}

      <div style={{ fontFamily:'system-ui,sans-serif', fontSize:11, color:'rgba(201,168,76,0.5)', letterSpacing:'0.08em', textTransform:'uppercase', margin:'32px 0 12px' }}>Disclaimer</div>
      <div style={{ fontSize:13, fontFamily:'system-ui,sans-serif', color:'#C8C0B0', lineHeight:1.75, whiteSpace:'pre-wrap' }}>{DISCLAIMER_TEXT}</div>
    </div>
  );
}

// ─── ABOUT TAB CONTENT ──────────────────────────────────────────────────────
// Edit any of the text below any time — it's plain strings, no logic involved.
// Paragraphs are separated by a blank line (\n\n) and rendered automatically.

const ABOUT_WHY_BUILT = `Over the past year I've worked intensively with language models — Grok, ChatGPT, Claude — specifically through the lens of Jungian psychology and the interpretation of alchemical symbols. What I kept running into was a tone. These models sound like a buddy. They pat you on the back. And I think that's dangerous — not just unhelpful, but genuinely dangerous, because it isn't giving you a real interpretation through that lens at all. It's giving you something softer, sometimes distorted, sometimes outright hallucinated.

That realization led me somewhere deeper: we don't actually know ourselves. And every time we hand a dream, a coincidence, a piece of our own inner life over to something external and let it tell us who we are, we're handing over a responsibility that was never anyone else's to carry.

So I built Dreamwork's framework specifically around the literature of Jung and his collaborators — much of it published by Inner City Books, a real backlog of studies and papers by Jungian analysts who spent their lives with this material. When you actually sit down and read it, you start to see what they were pointing at.

Our culture teaches us that dreams are nonsense, that they don't mean anything — that coincidences are just random noise. But the closer I've looked, the more closely I've listened to what these analysts rediscovered, the more it's revealed something real about our nature and our reality. Through my own journey — paying close attention to what's happening within me and around me — I've come to understand that what we've been taught simply isn't true.

In Jungian psychology, a dream is a compensation for where you actually are on your path of individuation. The psyche doesn't waste a single image — every image is communication, telling you something about where you stand.

We've lost the ability to recognize our own symbolic life. But look closely, even at the surface of our culture, and symbols are everywhere — in royal families, in nations, in the military, in Greek myths, in fairy tales, even in Disney movies. We're surrounded by this language, and most of us have forgotten how to read it.

This app is a tool for self-reflection. A year of working intensively with this material is what's let me start to recognize what these Jungian analysts were actually touching on — something we've all forgotten, distracted as we are by the immediate, external world.

The other reason I built this: everything Jung and his collaborators produced would take lifetimes to work through alone. This app exists to speed that up — not to replace the work, but to give you a structured way into it.

At its core, Dreamwork is a journal. It tracks your dreams and your coincidences — not just in a straight line, but with real consideration for the irrational alongside the rational, holding both instead of collapsing into one. And it picks out patterns according to a structured framework, built directly from the books and papers of the Jungian analysts who came before.

That's why this exists. Typing your dream into a generic language model isn't going to give you a true reading through this lens — it's going to hand you something distorted. I've taken on the responsibility of building a structured framework instead, so I'm not relying on some AI to pat me on the back and tell me I'm doing a good job. That feels wrong. It feels dangerous. Understanding who I am, what my difficulties are, and why they are what they are — that's my responsibility. Not something to hand off.`;

const ABOUT_QUESTION_BANK_INTRO = `Dreamwork never makes questions up on the spot. Every question it can ask you is written in advance, sitting in what the app calls the question bank. There are seven stages, roughly following how a real conversation about a dream tends to unfold — and only ever one question at a time.`;

const ABOUT_QUESTION_BANK_OUTRO = `Why bother pre-writing them, rather than letting Claude improvise? So it can't invent a meaning that isn't there, can't rush you, and never buries you in more than one question at once.`;

const ABOUT_QUESTION_BANK_STAGES = [
  { name: '1. Orientation', def: "The first questions, asked before any interpreting begins. How did the dream feel? Where do you feel it in your body? Which single image won't let go?" },
  { name: '2. Symbol', def: 'A close look at one image at a time — water, fire, an animal, a house — rather than trying to cover the whole dream at once.' },
  { name: '3. Figure', def: 'A close look at one person or presence in the dream at a time — a frightening figure, a wise one, a child.' },
  { name: '4. Alchemical stage', def: 'Naming which mood the dream seems to sit in: darkness, first clarity, new possibility, or coming-together (see the glossary below for what these mean).' },
  { name: '5. Type', def: "Used only sometimes, when it's fairly clear how your mind naturally works — asking what your dream might be trying to balance out." },
  { name: '6. Looking back', def: 'Only appears once you have some journal history. Connects this dream to a pattern in earlier ones.' },
  { name: '7. Closing', def: 'Always one last question, to help something from the session stay with you without over-analysing it.' },
];

const ABOUT_GLOSSARY = [
  { term: 'Archetype', def: "A universal pattern or figure that shows up across cultures and individuals — not learned, but built into how the human mind seems to work. The shadow, the wise old figure, and the great mother are all archetypes." },
  { term: 'The unconscious / collective unconscious', def: "The unconscious is everything happening in your mind that you're not consciously aware of. The collective unconscious is Jung's term for a deeper layer of it that isn't personal to you at all — a layer shared across humanity, where archetypes live." },
  { term: 'Shadow', def: "The parts of yourself you've rejected, denied, or never developed — not necessarily \"bad,\" just unfamiliar or unacceptable to the person you've decided to be. In dreams it often shows up as a threatening or disturbing figure." },
  { term: 'Anima / Animus', def: "Jung's terms for an inner figure carrying a psychological quality opposite to your conscious personality — traditionally described as a woman's inner masculine or a man's inner feminine, though what matters is the quality it carries (feeling and imagination, or direction and discrimination), not literal gender." },
  { term: 'Individuation', def: 'The lifelong process of becoming who you actually are, rather than who you were shaped or pressured to be. Not a destination you arrive at, but an ongoing unfolding.' },
  { term: 'Complex', def: 'A cluster of emotionally charged memories and associations that acts almost like a separate personality inside you, with its own logic and its own triggers. When a complex is activated, it can make you react far more strongly than the situation seems to call for.' },
  { term: 'Self (capital S)', def: 'Not your ego or everyday sense of "I," but the deeper organising centre of your whole psyche, conscious and unconscious together. Symbols like gold, a circle, or a wise figure often represent the Self.' },
  { term: 'Compensation', def: "Jung's idea that dreams exist partly to balance out what your conscious life has been ignoring or overdoing. A dream isn't random noise — it's often correcting something." },
  { term: 'Inflation', def: 'When a person becomes identified with something bigger than themselves — a sense of special destiny, cosmic importance, or grandiosity — rather than staying in a respectful, conscious relationship to it.' },
  { term: 'Numinous', def: "Rudolf Otto's word (borrowed by Jung) for the felt quality of something sacred, awe-inspiring, or larger than ordinary life. Big dreams tend to carry this quality; ordinary dreams usually don't." },
  { term: 'Synchronicity', def: "A meaningful coincidence between something happening inside you (a thought, feeling, dream) and something happening in the outer world, where the two can't be explained as cause and effect but still feel connected." },
  { term: 'The four alchemical stages', def: "An old alchemical map for how a big change tends to unfold: Nigredo, a necessary darkness. Albedo, the first clarity after it. Citrinitas, something new becoming possible. Rubedo, everything coming together into something more whole." },
  { term: 'The seven alchemical operations (Edinger)', def: "Smaller, recurring moves that can show up at any point, not just once. Calcinatio — burning away what's no longer needed. Solutio — dissolving something too rigid. Coagulatio — making something real and lived-in rather than just an idea. Sublimatio — rising to see things more clearly. Mortificatio — a hard ending that clears space. Separatio — telling two tangled things apart. Coniunctio — two opposites coming together as one." },
];

const ABOUT_BOOKS = [
  {
    group: 'The core five — present in nearly every reading',
    items: [
      { title: 'C.G. Jung', text: "The founder of this whole tradition. His core ideas — the unconscious, archetypes, individuation, compensation — run underneath everything Dreamwork does." },
      { title: 'Marie-Louise von Franz', text: "Jung's closest collaborator, and the main source for the alchemical and fairy-tale material, plus almost everything Dreamwork knows about synchronicity." },
      { title: 'James Hillman — Re-Visioning Psychology, The Dream and the Underworld', text: "A later, more radical voice. His work pushes against interpreting a dream image too quickly, treating dream figures as having their own reality rather than as your personal traits in costume." },
      { title: 'Edward Edinger — Ego and Archetype, Anatomy of the Psyche, the Mysterium Lectures', text: 'The main source for the alchemical operations (calcinatio, solutio, coagulatio, and others) and for the "ego-Self axis" — the relationship between your everyday sense of self and the deeper organising centre of the psyche.' },
      { title: 'Robert Moore', text: 'His "Dragon Laws" are the framework Dreamwork uses to recognise inflation and grandiosity — gently, as an observation, when they show up.' },
    ],
  },
  {
    group: 'Widening the picture — added later',
    items: [
      { title: "Jung — Psychological Types", text: "The basis for Dreamwork's typological questions: what your dominant psychological function is, and what your least-developed one might be trying to bring you through your dreams." },
      { title: 'Edinger — The Creation of Consciousness', text: 'Adds a section on what Jung called the unconscious God-image, for the rare dream that produces something genuinely too large to be personal.' },
      { title: 'Robert Johnson — She, He, We', text: 'Three short books reading old myths (Eros and Psyche, the Grail legend, Tristan and Iseult) as maps of how "the feminine," "the masculine," and romantic love mature psychologically. This isn\'t about gender roles — everyone carries both capacities.' },
      { title: 'James Hollis — What Matters Most, Finding Meaning in the Second Half of Life', text: "More plainly-spoken reflections on adult life: the old fears still running the show, the difference between a career and a genuine calling, what to do with the parts of a life that can't be fixed." },
      { title: 'Clarissa Pinkola Estés — Women Who Run With the Wolves', text: 'Fairy tales and myths read as a map of instinct, intuition, and creative fire — the part of the psyche most people are taught to tame or apologise for.' },
      { title: 'Marion Woodman — The Pregnant Virgin', text: 'On the body-soul connection, and on the space of not-yet-formed possibility that comes before something new is ready to be born.' },
      { title: 'Sylvia Brinton Perera — Descent to the Goddess', text: "A map for a specific, harder kind of dream: a dark, indifferent, non-nurturing feminine power that can't be talked round or defeated, only met on its own terms." },
      { title: 'Marion Woodman — Addiction to Perfection', text: 'Used narrowly, as a pattern — the disciplined, high-achieving persona and the ravenous energy building underneath it — rather than through its own case material, which centres on eating disorders. Dreamwork deliberately keeps this lens away from any dream involving food, weight, or body image.' },
    ],
  },
  {
    group: "Working quietly in the background — shaping how the interpreter behaves, not directly quoted",
    items: [
      { title: 'Barbara Hannah — Encounters with the Soul', text: "The reason Dreamwork never walks you through active imagination (talking back to a dream figure, continuing an encounter). Hannah's firsthand accounts of working alongside Jung show how genuinely risky that technique is without a trained analyst present in real time." },
      { title: 'Donald Kalsched — The Inner World of Trauma', text: 'Shapes how the interpreter recognises when a "protector" figure in a dream has turned harmful — asking it to slow down rather than push toward the usual questions, and to soften and point toward the app\'s crisis resources if anything reads as real distress rather than dream material.' },
    ],
  },
];

function AboutSection({ title, open, onToggle, children }) {
  return (
    <div style={{ marginBottom: 14, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: open ? 'rgba(201,168,76,0.08)' : 'rgba(255,255,255,0.02)', border: 'none', padding: '14px 18px', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ fontFamily: 'system-ui,sans-serif', fontSize: 13, letterSpacing: '0.04em', color: C.gold }}>{title}</span>
        <span style={{ color: 'rgba(201,168,76,0.5)', fontSize: 13 }}>{open ? '−' : '+'}</span>
      </button>
      {open && <div style={{ padding: '4px 18px 18px' }}>{children}</div>}
    </div>
  );
}

function AboutPanel() {
  const [openKey, setOpenKey] = useState('why');
  const toggle = key => setOpenKey(k => (k === key ? null : key));

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
      <div style={{ fontFamily: 'system-ui,sans-serif', fontSize: 11, color: 'rgba(201,168,76,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>About Dreamwork</div>

      <AboutSection title="Why I built this" open={openKey === 'why'} onToggle={() => toggle('why')}>
        {ABOUT_WHY_BUILT.split('\n\n').map((p, i) => (
          <p key={i} style={{ fontSize: 14, fontFamily: 'Georgia,serif', color: '#C8C0B0', lineHeight: 1.8, margin: '0 0 14px' }}>{p}</p>
        ))}
      </AboutSection>

      <AboutSection title="Jungian terms, plainly explained" open={openKey === 'glossary'} onToggle={() => toggle('glossary')}>
        {ABOUT_GLOSSARY.map((g, i) => (
          <div key={i} style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: 'system-ui,sans-serif', fontSize: 13, color: C.gold, marginBottom: 4 }}>{g.term}</div>
            <div style={{ fontSize: 14, fontFamily: 'system-ui,sans-serif', color: C.muted, lineHeight: 1.7 }}>{g.def}</div>
          </div>
        ))}
      </AboutSection>

      <AboutSection title="The books & papers behind it" open={openKey === 'books'} onToggle={() => toggle('books')}>
        {ABOUT_BOOKS.map((group, gi) => (
          <div key={gi} style={{ marginBottom: 22 }}>
            <div style={{ fontFamily: 'system-ui,sans-serif', fontSize: 11, color: 'rgba(201,168,76,0.55)', letterSpacing: '0.05em', marginBottom: 10 }}>{group.group}</div>
            {group.items.map((b, bi) => (
              <div key={bi} style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: 'system-ui,sans-serif', fontSize: 13, color: C.gold, marginBottom: 4 }}>{b.title}</div>
                <div style={{ fontSize: 14, fontFamily: 'system-ui,sans-serif', color: C.muted, lineHeight: 1.7 }}>{b.text}</div>
              </div>
            ))}
          </div>
        ))}
      </AboutSection>

      <AboutSection title="How the question bank works" open={openKey === 'bank'} onToggle={() => toggle('bank')}>
        <p style={{ fontSize: 14, fontFamily: 'system-ui,sans-serif', color: C.muted, lineHeight: 1.8, margin: '0 0 16px' }}>{ABOUT_QUESTION_BANK_INTRO}</p>
        {ABOUT_QUESTION_BANK_STAGES.map((s, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: 'system-ui,sans-serif', fontSize: 13, color: C.gold, marginBottom: 4 }}>{s.name}</div>
            <div style={{ fontSize: 14, fontFamily: 'system-ui,sans-serif', color: C.muted, lineHeight: 1.7 }}>{s.def}</div>
          </div>
        ))}
        <p style={{ fontSize: 14, fontFamily: 'system-ui,sans-serif', color: C.muted, lineHeight: 1.8, margin: '16px 0 0' }}>{ABOUT_QUESTION_BANK_OUTRO}</p>
      </AboutSection>
    </div>
  );
}

// ─── TIPS TAB CONTENT ───────────────────────────────────────────────────────
// TIPS_GENERAL is a plain array of strings — add a new tip any time by adding
// a new line to the array. No other changes needed.

const TIPS_TECHNIQUES = [
  {
    title: 'Capture the dream before it fades',
    description: "The moment you wake up is when a dream is most alive — and the fastest thing to fade. Set up your phone's voice recorder so it's one tap away, right from your lock screen or the pull-down panel, and speak the dream out loud while you're still half in it. Don't worry about making it coherent. Most recorders will transcribe it for you afterward — not perfectly, but that raw, jumbled transcript is often more useful than a tidy summary written once you're fully awake, because it still carries the shape and feeling of the dream. Copy that transcript straight into Dreamwork's journal.",
    iphone: [
      'Open Settings, then tap Control Center',
      'Find Voice Memos in the list and tap the green + to add it',
      'From now on, swipe down from the top-right corner of your screen (or up from the bottom edge on older iPhones) to open Control Center',
      'Tap the Voice Memos icon to start recording immediately',
      'Afterward, open the recording in Voice Memos and copy the transcript (or just play it back and type as you listen)',
      'Paste it into a new entry in Dreamwork',
    ],
    android: [
      'Pull down twice from the top of the screen to open Quick Settings, then tap the pencil/edit icon',
      'Look for "Voice Recorder" or "Sound Recorder" in the tile list and drag it into your active tiles',
      "If it's not available as a tile on your phone, add a Recorder widget to your home screen instead",
      'Pull down twice and tap the tile to start recording straight away',
      'Most recorder apps (including Google\'s Recorder app on Pixel phones) transcribe automatically — open the recording afterward and copy the text',
      'Paste it into a new entry in Dreamwork',
    ],
  },
  {
    title: 'Hear your interpretation read aloud',
    description: "Your phone can read any screen out loud, hands-free — useful lying in bed, or simply as another way of taking in an interpretation besides reading it.",
    iphone: [
      'Open Settings, then Accessibility, then Spoken Content',
      'Turn on "Speak Screen"',
      '(Optional) adjust the speaking rate on the same screen',
      'On any screen you want read aloud, swipe down with two fingers from the very top of the screen',
      'A small control bar appears — tap play to keep listening, or pause and skip as you like',
    ],
    android: [
      'Open Settings, then Accessibility, then Select to Speak (naming may vary slightly by phone)',
      'Turn it on',
      'A small floating icon appears on your screen',
      'Tap it, then tap the play control to read the whole screen — or drag your finger over specific text to hear just that part',
      'Exact wording varies a little between Android versions and phone brands — look under Accessibility if these steps don\'t match exactly',
    ],
  },
];

const TIPS_GENERAL = [
  "If an interpretation doesn't quite land, just ask for it again in simpler words. There's no benefit to nodding along with something you didn't really follow.",
  "Before ending a session, read back through the full interpretation once more. Often something only lands on a second pass, once you're not mid-conversation anymore.",
  "If something does land — a feeling, a memory, an image rising up — pause and actually sit with it for a moment rather than rushing past it.",
  "If you can, bring whatever surfaced back into the conversation. Telling Dreamwork what just came up is often where the most useful part of a session happens.",
];

function StepList({ items }) {
  return (
    <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
      {items.map((s, i) => (
        <li key={i} style={{ fontSize: 14, fontFamily: 'system-ui,sans-serif', color: C.muted, lineHeight: 1.7, marginBottom: 6 }}>{s}</li>
      ))}
    </ol>
  );
}

function TipsPanel() {
  const [openKey, setOpenKey] = useState('t0');
  const toggle = key => setOpenKey(k => (k === key ? null : key));

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
      <div style={{ fontFamily: 'system-ui,sans-serif', fontSize: 11, color: 'rgba(201,168,76,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>Tips</div>

      {TIPS_TECHNIQUES.map((t, ti) => (
        <AboutSection key={ti} title={t.title} open={openKey === `t${ti}`} onToggle={() => toggle(`t${ti}`)}>
          <p style={{ fontSize: 14, fontFamily: 'system-ui,sans-serif', color: C.muted, lineHeight: 1.8, margin: '0 0 16px' }}>{t.description}</p>
          <div style={{ fontFamily: 'system-ui,sans-serif', fontSize: 13, color: C.gold, marginBottom: 2 }}>On iPhone</div>
          <StepList items={t.iphone} />
          <div style={{ fontFamily: 'system-ui,sans-serif', fontSize: 13, color: C.gold, margin: '18px 0 2px' }}>On Android</div>
          <StepList items={t.android} />
        </AboutSection>
      ))}

      <AboutSection title="More tips from experience" open={openKey === 'general'} onToggle={() => toggle('general')}>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {TIPS_GENERAL.map((tip, i) => (
            <li key={i} style={{ fontSize: 14, fontFamily: 'system-ui,sans-serif', color: C.muted, lineHeight: 1.8, marginBottom: 12 }}>{tip}</li>
          ))}
        </ul>
      </AboutSection>
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
  const [journal, setJournal] = useState([]);
  const [journalLoaded, setJournalLoaded] = useState(false);
  const [openEntry, setOpenEntry] = useState(null);
  const [sessionSaved, setSessionSaved] = useState(false);
  const [mode, setMode] = useState(null);
  const [currentEntryId, setCurrentEntryId] = useState(null);
  const [resumeAvailable, setResumeAvailable] = useState(null); // holds the pending active session, if any
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [surveyDismissed, setSurveyDismissed] = useState(() => loadSurveyDismissed());
  const [disclaimerAckVersion, setDisclaimerAckVersion] = useState(() => loadAcknowledgedDisclaimerVersion());
  const [experienceLevel, setExperienceLevel] = useState(() => loadExperienceLevel());
  const [editingIdx, setEditingIdx] = useState(null);
  const [editText, setEditText] = useState('');
  const bottomRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Load the journal from IndexedDB on startup, migrating anything still
  // sitting in the old localStorage store first (a one-time, automatic step
  // — see journalStore.js for details).
  useEffect(() => {
    (async () => {
      try {
        await migrateLegacyJournalIfNeeded();
        const entries = await idbGetAllEntries();
        entries.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
        setJournal(entries);
      } catch (e) {
        console.error('Journal load failed', e);
      } finally {
        setJournalLoaded(true);
      }
    })();
  }, []);

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
    const experiencePrefix = experienceLevel ? EXPERIENCE_PREFIX[experienceLevel] : '';
    const digest = buildJournalDigest(journal);
    const system = SYSTEM_PROMPT + modePrefix + experiencePrefix + digest;

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
          // Automatic prompt caching: the system prompt here is large (tens
          // of thousands of tokens), and without this, every single message
          // in a session would re-process the whole thing at full price.
          // With this on, the system prompt (and the growing conversation
          // history) gets cached after the first call in a session, and
          // subsequent calls read most of that from cache at a fraction of
          // the cost — no change in behavior or output, just cost and speed.
          cache_control: { type: 'ephemeral' },
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
      let changedEntry;
      if (currentEntryId && prevJournal.some(e => e.id === currentEntryId)) {
        // Update existing entry in place
        updated = prevJournal.map(e => {
          if (e.id !== currentEntryId) return e;
          changedEntry = { ...e, messages: msgs, stage, closingWord };
          return changedEntry;
        });
      } else {
        // Create new entry
        const newId = Date.now().toString();
        changedEntry = {
          id: newId,
          savedAt: Date.now(),
          title: dreamText.split(' ').slice(0, 6).join(' ') + '…',
          dreamText,
          messages: msgs,
          stage,
          closingWord,
          mode,
        };
        updated = [...prevJournal, changedEntry];
        setCurrentEntryId(newId);
      }
      // Only the entry that actually changed gets written — the point of
      // IndexedDB over the old localStorage blob is exactly this: a single
      // dream's worth of data touched per save, not the whole journal.
      idbPutEntry(changedEntry);
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
    idbPutEntry(updated);
  }

  function deleteEntry(id) {
    const newJournal = journal.filter(e => e.id !== id);
    setJournal(newJournal);
    idbDeleteEntry(id);
    if (openEntry?.id === id) setOpenEntry(null);
  }

  // ─── EXPORT / IMPORT ────────────────────────────────────────────────────
  // Lets someone get their journal off this one device — save the exported
  // file anywhere they like (a cloud sync folder, an external drive, a USB
  // stick) and bring it back in later, here or on another device. Nothing
  // about this talks to any third-party service directly; it's just a file.
  async function exportJournal() {
    const payload = {
      app: 'dreamwork',
      exportedAt: new Date().toISOString(),
      version: 1,
      entries: journal,
    };
    const json = JSON.stringify(payload, null, 2);
    const filename = `dreamwork-journal-${new Date().toISOString().slice(0, 10)}.json`;

    // On mobile — and especially inside an installed/PWA context — a plain
    // blob download link is unreliable: some browsers silently fail to
    // download it and instead navigate to it as if it were a normal page,
    // which can land in a separate browsing context with its own storage
    // (hence the disclaimer reappearing, as if it were a brand new visit).
    // The native share sheet is the reliable way to hand a file off on
    // mobile, and it's exactly what lets someone save straight into Files,
    // iCloud Drive, Sync, Dropbox, or anywhere else they choose.
    try {
      const file = new File([json], filename, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Dreamwork journal export' });
        return;
      }
    } catch (e) {
      // Cancelling the share sheet throws an AbortError — that's just the
      // person changing their mind, not a real failure, so don't fall
      // through to a second, duplicate download attempt in that case.
      if (e && e.name === 'AbortError') return;
      console.error('Share export failed, falling back to direct download', e);
    }

    // Fallback for browsers without file-sharing support (most desktop
    // browsers): a normal download link.
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Imports a previously exported file, merging by entry id so importing
  // the same file twice (or restoring onto a device that already has some
  // of these entries) is harmless rather than creating duplicates. Returns
  // a result object the Settings panel uses to show a success or error message.
  async function importJournalFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.entries) ? parsed.entries
        : null;

      if (!incoming) {
        throw new Error("That file doesn't look like a Dreamwork journal export.");
      }
      const looksValid = incoming.every(e => e && typeof e === 'object' && e.id && e.savedAt);
      if (!looksValid) {
        throw new Error("That file doesn't look like a Dreamwork journal export.");
      }

      const byId = new Map(journal.map(e => [e.id, e]));
      incoming.forEach(e => byId.set(e.id, e));
      const merged = [...byId.values()].sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));

      await idbUpsertMany(incoming);
      setJournal(merged);
      return { ok: true, count: incoming.length };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  function dismissSurvey() {
    saveSurveyDismissed();
    setSurveyDismissed(true);
  }

  function acknowledgeDisclaimer() {
    saveAcknowledgedDisclaimerVersion(DISCLAIMER_VERSION);
    setDisclaimerAckVersion(DISCLAIMER_VERSION);
  }

  function chooseExperienceLevel(level) {
    saveExperienceLevel(level);
    setExperienceLevel(level);
  }

  const mustShowDisclaimer = disclaimerAckVersion !== DISCLAIMER_VERSION;
  // Only asked once the disclaimer is out of the way, and only if nobody's
  // answered (or skipped) it yet on this device.
  const mustAskExperience = !mustShowDisclaimer && !experienceLevel;

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

      {/* Disclaimer gate — has to be acknowledged before anything else is usable */}
      {mustShowDisclaimer && (
        <div style={{ position:'fixed', inset:0, background:C.bg, display:'flex', alignItems:'center', justifyContent:'center', padding:24, zIndex:100 }}>
          <div style={{ maxWidth:480, width:'100%', maxHeight:'85vh', overflowY:'auto', border:`1px solid rgba(201,168,76,0.3)`, borderRadius:12, padding:'28px 26px' }}>
            <div style={{ fontSize:11, fontFamily:'system-ui,sans-serif', color:'rgba(201,168,76,0.6)', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:16 }}>Before you begin</div>
            <div style={{ fontSize:14, fontFamily:'system-ui,sans-serif', color:'#C8C0B0', lineHeight:1.8, whiteSpace:'pre-wrap', marginBottom:24 }}>{DISCLAIMER_TEXT}</div>
            <button onClick={acknowledgeDisclaimer} style={{ background:'rgba(201,168,76,0.12)', border:'1px solid rgba(201,168,76,0.4)', color:C.gold, fontSize:13, fontFamily:'system-ui,sans-serif', padding:'10px 22px', borderRadius:8, cursor:'pointer' }}>I understand</button>
          </div>
        </div>
      )}

      {/* Experience level — asked once, right after the disclaimer, skippable */}
      {mustAskExperience && (
        <div style={{ position:'fixed', inset:0, background:C.bg, display:'flex', alignItems:'center', justifyContent:'center', padding:24, zIndex:100 }}>
          <div style={{ maxWidth:420, width:'100%', textAlign:'center' }}>
            <div style={{ fontSize:20, fontWeight:300, marginBottom:10 }}>How familiar are you with Jungian psychology or dream work?</div>
            <div style={{ fontSize:13, fontFamily:'system-ui,sans-serif', color:C.muted, lineHeight:1.6, marginBottom:24 }}>This just helps Dreamwork meet you where you are — you can change it anytime in Settings.</div>
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:18 }}>
              {[
                { key:'beginner', label:'New to this' },
                { key:'some', label:'Some familiarity' },
                { key:'experienced', label:'Very familiar' },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => chooseExperienceLevel(key)} style={{ background:'rgba(201,168,76,0.08)', border:'1px solid rgba(201,168,76,0.3)', color:C.gold, fontSize:14, fontFamily:'system-ui,sans-serif', padding:'12px 16px', borderRadius:8, cursor:'pointer' }}>{label}</button>
              ))}
            </div>
            <button onClick={() => chooseExperienceLevel('some')} style={{ background:'none', border:'none', color:'rgba(138,138,154,0.5)', fontSize:12, fontFamily:'system-ui,sans-serif', cursor:'pointer' }}>Skip for now</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ padding:'20px 20px 0', paddingTop:'calc(env(safe-area-inset-top, 0px) + 30px)', flexShrink:0 }}>
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
            {['chat','journal','about','tips','settings'].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ background: tab===t ? 'rgba(201,168,76,0.12)' : 'none', border:`1px solid ${tab===t ? 'rgba(201,168,76,0.35)' : 'rgba(201,168,76,0.15)'}`, color: tab===t ? C.gold : (t === 'settings' && !apiKey ? '#D0A050' : C.muted), fontSize:11, letterSpacing:'0.07em', textTransform:'uppercase', padding:'9px 14px', minHeight:38, borderRadius:6, cursor:'pointer', fontFamily:'inherit' }}>
                {t === 'journal' ? `Journal${journal.length ? ` (${journal.length})` : ''}` : t === 'settings' ? `Settings${!apiKey ? ' •' : ''}` : t === 'about' ? 'About' : t === 'tips' ? 'Tips' : 'Dream'}
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
                    <div style={{ fontSize:12, fontFamily:'system-ui,sans-serif', color:'rgba(200,192,176,0.55)', lineHeight:1.7, fontStyle:'italic', maxWidth:360, margin:'0 auto 18px' }}>{REMINDER_TEXT}</div>
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
              {!journalLoaded ? null : journal.length === 0 ? (
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

      {/* About tab */}
      {tab === 'about' && <AboutPanel />}

      {/* Tips tab */}
      {tab === 'tips' && <TipsPanel />}

      {/* Settings tab */}
      {tab === 'settings' && (
        <SettingsPanel apiKey={apiKey} onSave={handleSaveApiKey} journalCount={journal.length} experienceLevel={experienceLevel} onChooseExperienceLevel={chooseExperienceLevel} onExport={exportJournal} onImport={importJournalFile} />
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
