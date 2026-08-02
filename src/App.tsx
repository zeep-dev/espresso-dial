import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import { loadCollection, saveCollection, HISTORY_KEY, BAGS_KEY } from "./lib/storage";
import AuthScreen from "./components/AuthScreen";
import { OnboardingModal } from "./components/OnboardingModal";
import { ProfilePage } from "./components/ProfilePage";
import { loadEquipmentProfile, saveEquipmentProfile } from "./lib/equipment";

const GENERIC_DEFAULTS = {
  washed: { light: { niche: 14, dose: 18, yield: 36, time: 28 }, medium: { niche: 11, dose: 18, yield: 36, time: 27 }, dark: { niche: 8, dose: 18, yield: 36, time: 26 } },
  natural: { light: { niche: 16, dose: 18, yield: 36, time: 30 }, medium: { niche: 13, dose: 18, yield: 36, time: 28 }, dark: { niche: 9, dose: 18, yield: 36, time: 26 } },
  honey: { light: { niche: 15, dose: 18, yield: 36, time: 29 }, medium: { niche: 12, dose: 18, yield: 36, time: 27 }, dark: { niche: 9, dose: 18, yield: 36, time: 26 } },
};

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Read failed"));
    r.readAsDataURL(file);
  });
}

async function callClaude(messages: any[], systemPrompt?: string) {
  const body: any = { 
    model: "claude-sonnet-4-5", 
    max_tokens: 1000, 
    messages 
  };
  if (systemPrompt) body.system = systemPrompt;
 const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { 
    "Content-Type": "application/json",
    "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  },
  body: JSON.stringify(body),
});
  const data = await res.json();
  const raw = data.content?.map((b: any) => b.text || "").join("") || "";
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

async function extractBagInfo(images) {
  const system = `You extract coffee bag information from one or more photos (label, roast date stamp, bean close-up, etc.) and return ONLY valid JSON, no markdown, no preamble.
Return this exact shape:
{"roaster":"string","name":"string","origin":"string","process":"washed|natural|honey|unknown","roastLevel":"light|medium|dark|unknown","roastDate":"YYYY-MM-DD or null","notes":"any other relevant detail or empty string","details":{"varietal":"string or null","producer":"string or null","altitude":"string or null","roasterTastingNotes":"string or null","certifications":"string or null"}}
If you cannot read a field, use "unknown", null, or empty string as appropriate. Infer roast level using this priority order: (1) explicit label on bag e.g. "filter roast" = light, "omni roast" = medium, (2) bean colour in any bean photo — light brown/dry/visible crease = light, medium brown/dry = medium, dark brown/oily/shiny = dark. Only use "unknown" if you have no bag descriptors AND no bean photo. Today's date is ${new Date().toISOString().split('T')[0]}, so the current year is ${new Date().getFullYear()}. A roast date written as DD/MM, DD/M, or "14 MAY" or "14 May" or any variant with a written month name should always be interpreted as day/month of the current year unless a 4-digit year is explicitly visible on the bag. Never infer a past year from a roast date stamp.`;
  const imageBlocks = images.map(img => ({ type: "image", source: { type: "base64", media_type: img.type, data: img.base64 } }));
  const text = await callClaude([{
    role: "user",
    content: [...imageBlocks, { type: "text", text: "Extract the coffee information from these photos." }]
  }], system);
  try { return JSON.parse(text.trim()); }
  catch { return { roaster: "Unknown", name: "Unknown", origin: "Unknown", process: "unknown", roastLevel: "unknown", roastDate: null, notes: "" }; }
}

async function generateRecommendation(bagInfo, history) {
  const daysOff = bagInfo.roastDate ? Math.floor((Date.now() - new Date(bagInfo.roastDate)) / 86400000) : null;
  const historyContext = history.length > 0
    ? `The user's dialling-in history:\n${JSON.stringify(history.map(h => ({ ...h.bagInfo, niche: h.recipe.niche, dose: h.recipe.dose, yield: h.recipe.yield, time: h.recipe.time, verdict: h.verdict, tastingNote: h.tastingNote, daysOffRoast: h.daysOffRoast ?? null })), null, 2)}`
    : "No history yet.";

  const system = `You are an expert espresso consultant helping dial in espresso on a Sage Bambino Plus (fixed 9 bar, 94C) with a Niche Zero grinder, naked portafilter, and puck screen.

Niche Zero dial: lower = finer, higher = coarser. It is a stepless grinder — recommend to one decimal place (e.g. 12.5) where helpful. Typical espresso range is 7-18. Dose is usually 18g, yield 36g (1:2 ratio), time 25-32 seconds.

When history is available, reason from it carefully:
- PRIORITISE recipes marked "dialled-in" — these are ground truth for this setup
- Treat "slow" verdicts as negative signal: the grind was too fine — adjust coarser for similar coffees
- Treat "fast" verdicts as negative signal: the grind was too coarse — adjust finer for similar coffees
- Treat "acceptable" as weak positive signal — the recipe worked but was not optimal
- DISCOUNT recipes marked "didn't work" or "bad" — avoid similar parameters
- Look for patterns: if naturals consistently land at Niche 13-15, carry that forward
- Factor in days off roast: fresher beans (under 10 days) often need a coarser grind; older beans grind finer
- If multiple dialled-in shots exist for similar coffees, average or interpolate rather than picking just one
- Explicitly call out in your reasoning which historical shots informed the suggestion and why

If no relevant history exists, fall back to general espresso principles for the process and roast level.

Return ONLY valid JSON, no markdown:
{"niche":number,"dose":number,"yield":number,"time":number,"reasoning":"2-3 sentences referencing specific history where available","adjustmentTips":"specific advice for this coffee if too sour or too bitter"}`;

  const prompt = `New coffee to dial in:
${JSON.stringify({ ...bagInfo, daysOffRoast: daysOff })}

${historyContext}

Suggest a starting recipe. Where history exists, reason from it explicitly.`;

  const text = await callClaude([{ role: "user", content: prompt }], system);
  try { return JSON.parse(text.trim()); }
  catch {
    const p = bagInfo.process !== "unknown" ? bagInfo.process : "washed";
    const l = bagInfo.roastLevel !== "unknown" ? bagInfo.roastLevel : "medium";
    const def = GENERIC_DEFAULTS[p]?.[l] || GENERIC_DEFAULTS.washed.medium;
    return { ...def, reasoning: "Could not generate AI recommendation. Showing generic defaults.", adjustmentTips: "If sour: grind finer or increase time. If bitter: grind coarser or reduce time." };
  }
}

function verdictClass(v) {
  if (v === "dialled-in" || v === "good") return "verdict-good";
  if (v === "acceptable" || v === "ok") return "verdict-ok";
  return "verdict-bad";
}

function verdictLabel(v) {
  if (v === "dialled-in" || v === "good") return "Dialled in";
  if (v === "acceptable" || v === "ok") return "Acceptable";
  if (v === "slow") return "Too slow";
  if (v === "fast") return "Too fast";
  return "Didn't work";
}

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=DM+Mono:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0e0b09; --surface: #181210; --card: #1e1714; --border: #2e2420; --border-light: #3a2f2a;
    --cream: #e8ddd0; --cream-muted: #9e8f82; --accent: #c17f3a; --accent-dim: #8a5a28;
    --red: #c0392b; --green: #27ae60;
    --font-serif: 'Playfair Display', Georgia, serif; --font-mono: 'DM Mono', 'Courier New', monospace;
  }
  body { background: var(--bg); color: var(--cream); font-family: var(--font-mono); min-height: 100vh; }
  .app { max-width: 680px; margin: 0 auto; padding: 32px 20px 80px; }
  .header { text-align: center; margin-bottom: 48px; }
  .header h1 { font-family: var(--font-serif); font-size: 2rem; font-weight: 400; color: var(--cream); }
  .header h1 em { font-style: italic; color: var(--accent); }
  .header p { font-size: 0.72rem; color: var(--cream-muted); margin-top: 6px; letter-spacing: 0.12em; text-transform: uppercase; }
  .tabs { display: flex; gap: 2px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 3px; margin-bottom: 32px; }
  .tab { flex: 1; padding: 9px; font-family: var(--font-mono); font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; background: none; border: none; color: var(--cream-muted); cursor: pointer; border-radius: 4px; transition: all 0.15s; }
  .tab.active { background: var(--card); color: var(--cream); }
  .tab:hover:not(.active) { color: var(--cream); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 24px; margin-bottom: 20px; }
  .card-title { font-family: var(--font-serif); font-size: 1.1rem; font-weight: 400; margin-bottom: 16px; color: var(--cream); }
  .upload-zone { border: 1px dashed var(--border-light); border-radius: 6px; padding: 40px 20px; text-align: center; cursor: pointer; transition: all 0.2s; position: relative; }
  .upload-zone:hover { border-color: var(--accent); background: rgba(193,127,58,0.04); }
  .upload-zone input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
  .upload-zone .icon { font-size: 2rem; margin-bottom: 8px; }
  .upload-zone p { font-size: 0.75rem; color: var(--cream-muted); }
  .field { margin-bottom: 16px; }
  .field label { display: block; font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cream-muted); margin-bottom: 6px; }
  .field input, .field select, .field textarea { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; color: var(--cream); font-family: var(--font-mono); font-size: 0.82rem; padding: 8px 12px; transition: border-color 0.15s; }
  .field input:focus, .field select:focus, .field textarea:focus { outline: none; border-color: var(--accent); }
  .field select option { background: var(--surface); }
  .field textarea { resize: vertical; min-height: 70px; }
  .fields-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .fields-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .btn { font-family: var(--font-mono); font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; padding: 10px 20px; border-radius: 4px; border: none; cursor: pointer; transition: all 0.15s; }
  .btn-primary { background: var(--accent); color: var(--bg); font-weight: 500; }
  .btn-primary:hover { background: #d4903f; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-ghost { background: none; border: 1px solid var(--border-light); color: var(--cream-muted); }
  .btn-ghost:hover { border-color: var(--cream-muted); color: var(--cream); }
  .btn-full { width: 100%; }
  .recipe-card { background: var(--surface); border: 1px solid var(--accent-dim); border-radius: 8px; padding: 24px; margin: 20px 0; }
  .recipe-title { font-family: var(--font-serif); font-size: 0.85rem; font-style: italic; color: var(--accent); margin-bottom: 16px; }
  .recipe-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
  .recipe-stat { text-align: center; }
  .recipe-stat .value { font-family: var(--font-serif); font-size: 1.8rem; color: var(--cream); line-height: 1; }
  .recipe-stat .unit { font-size: 0.65rem; color: var(--accent); letter-spacing: 0.1em; text-transform: uppercase; margin-top: 2px; }
  .recipe-stat .label { font-size: 0.62rem; color: var(--cream-muted); letter-spacing: 0.08em; text-transform: uppercase; margin-top: 4px; }
  .recipe-reasoning { font-size: 0.78rem; color: var(--cream-muted); line-height: 1.6; margin-bottom: 10px; }
  .recipe-tips { font-size: 0.72rem; color: var(--accent); line-height: 1.5; padding: 10px 12px; background: rgba(193,127,58,0.08); border-radius: 4px; border-left: 2px solid var(--accent-dim); }
  .status { font-size: 0.75rem; color: var(--cream-muted); text-align: center; padding: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .spinner { width: 14px; height: 14px; border: 2px solid var(--border-light); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; flex-shrink: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
  .divider { height: 1px; background: var(--border); margin: 20px 0; }
  .history-empty { text-align: center; padding: 48px 20px; color: var(--cream-muted); font-size: 0.78rem; }
  .history-item { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 18px 20px; margin-bottom: 12px; cursor: pointer; transition: border-color 0.15s; }
  .history-item:hover { border-color: var(--border-light); }
  .history-item-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .history-item-name { font-family: var(--font-serif); font-size: 1rem; color: var(--cream); }
  .history-item-roaster { font-size: 0.7rem; color: var(--cream-muted); margin-top: 2px; }
  .history-item-verdict { font-size: 0.7rem; padding: 3px 8px; border-radius: 20px; }
  .verdict-good { background: rgba(39,174,96,0.15); color: var(--green); }
  .verdict-ok { background: rgba(193,127,58,0.15); color: var(--accent); }
  .verdict-bad { background: rgba(192,57,43,0.15); color: var(--red); }
  .history-item-recipe { display: flex; gap: 16px; font-size: 0.72rem; color: var(--cream-muted); }
  .history-item-recipe span { color: var(--cream); }
  .history-item-note { font-size: 0.72rem; color: var(--cream-muted); margin-top: 8px; font-style: italic; }
  .tag { display: inline-block; font-size: 0.62rem; letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 8px; border-radius: 3px; background: rgba(255,255,255,0.06); color: var(--cream-muted); margin-right: 4px; margin-top: 4px; }
  .tag-accent { background: rgba(193,127,58,0.12); color: var(--accent); }
  .section-label { font-size: 0.65rem; letter-spacing: 0.15em; text-transform: uppercase; color: var(--cream-muted); margin-bottom: 16px; }

  /* --- Equipment profile --- */
  .modal-overlay { position: fixed; inset: 0; background: rgba(8,6,5,0.82); display: flex; align-items: flex-start; justify-content: center; padding: 32px 20px; overflow-y: auto; z-index: 50; }
  .modal { background: var(--surface); border: 1px solid var(--border-light); border-radius: 10px; padding: 32px; width: 100%; max-width: 860px; margin: auto; }
  .modal-head { text-align: center; margin-bottom: 28px; }
  .modal-head h1 { font-family: var(--font-serif); font-size: 1.6rem; font-weight: 400; color: var(--cream); }
  .modal-head h1 em { font-style: italic; color: var(--accent); }
  .modal-head p { font-size: 0.8rem; color: var(--cream-muted); margin-top: 8px; line-height: 1.5; max-width: 420px; margin-left: auto; margin-right: auto; }
  .modal-foot { display: flex; flex-direction: column; align-items: center; gap: 14px; margin-top: 4px; }
  .equip-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; align-items: start; }
  @media (max-width: 720px) { .equip-grid { grid-template-columns: 1fr; } .modal { padding: 24px 20px; } }
  .equip-card { margin-bottom: 0; }
  .equip-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 18px; }
  .equip-card-head .section-label { margin-bottom: 4px; }
  .equip-name { font-family: var(--font-serif); font-size: 1.15rem; font-weight: 400; color: var(--cream); }
  .equip-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .equip-actions .btn { padding: 6px 10px; font-size: 0.66rem; }
  .equip-status { margin-top: 4px; }
  .equip-hint { font-size: 0.72rem; color: var(--cream-muted); line-height: 1.5; }
  .upload-zone.dragging { border-color: var(--accent); background: rgba(193,127,58,0.08); }
  .upload-zone .icon { color: var(--cream-muted); display: flex; justify-content: center; }
  .photo-preview { display: block; width: 100%; max-height: 130px; object-fit: cover; border-radius: 4px; }
  .photo-remove { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: 50%; border: none; background: rgba(8,6,5,0.8); color: var(--cream); cursor: pointer; font-size: 0.9rem; line-height: 1; }
  .photo-remove:hover { background: var(--red); }
  .badge-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 0.68rem; padding: 5px 10px; border-radius: 20px; background: rgba(255,255,255,0.05); border: 1px solid var(--border); color: var(--cream); text-align: left; }
  .badge-label { font-size: 0.58rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--cream-muted); }
  .badge-editable, .badge-toggle { cursor: pointer; transition: border-color 0.15s; }
  .badge-editable:hover, .badge-toggle:hover { border-color: var(--accent); }
  .badge-toggle.badge-on { background: rgba(193,127,58,0.14); border-color: var(--accent-dim); }
  .badge-toggle.badge-on .badge-value { color: var(--accent); }
  .badge-editing { border-color: var(--accent); }
  .badge-input { background: var(--surface); border: none; border-bottom: 1px solid var(--accent); color: var(--cream); font-family: var(--font-mono); font-size: 0.68rem; padding: 1px 2px; max-width: 150px; }
  .badge-input:focus { outline: none; }
  .link-btn { background: none; border: none; color: var(--cream-muted); font-family: var(--font-mono); font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; text-decoration: underline; padding: 4px; }
  .link-btn:hover { color: var(--cream); }
  .link-btn:disabled { opacity: 0.5; cursor: not-allowed; }
`;

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState("dial");
  const [history, setHistory] = useState([]);
  const [bags, setBags] = useState([]);
  const [profile, setProfile] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setHistory([]); setBags([]); setProfile(null); setShowOnboarding(false); return; }
    (async () => {
      setHistory(await loadCollection(HISTORY_KEY));
      setBags(await loadCollection(BAGS_KEY));
      // Equipment profile check: on first login there is no profile yet, so the
      // onboarding modal is shown over the app until the user saves or skips.
      const saved = await loadEquipmentProfile();
      setProfile(saved);
      setShowOnboarding(!saved);
    })();
  }, [session]);

  const saveProfile = async (next) => {
    setProfile(next);
    await saveEquipmentProfile(next);
    setShowOnboarding(false);
  };

  const saveHistory = async (newHistory) => {
    setHistory(newHistory);
    await saveCollection(HISTORY_KEY, newHistory);
  };

  const saveBag = async (bagInfo, recommendation) => {
    const entry = { id: Date.now(), scannedDate: new Date().toISOString().split("T")[0], ...bagInfo, recommendation: recommendation || null };
    const newBags = [entry, ...bags];
    setBags(newBags);
    await saveCollection(BAGS_KEY, newBags);
  };

  const updateBag = async (bagId, updatedRec) => {
    const newBags = bags.map(b => b.id === bagId ? { ...b, recommendation: updatedRec } : b);
    setBags(newBags);
    await saveCollection(BAGS_KEY, newBags);
  };

  const addEntry = (entry) => saveHistory([entry, ...history]);

  const handleSignOut = async () => { await supabase.auth.signOut(); };

  if (authLoading) {
    return (
      <>
        <style>{styles}</style>
        <div className="app">
          <div className="status"><div className="spinner" />Loading…</div>
        </div>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <style>{styles}</style>
        <AuthScreen />
      </>
    );
  }

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <div className="header" style={{ position: "relative" }}>
          <button
            className="btn btn-ghost"
            onClick={handleSignOut}
            style={{ position: "absolute", top: 0, right: 0, padding: "6px 12px" }}
          >
            Sign out
          </button>
          <h1>Espresso <em>Dial</em></h1>
          <p>Niche Zero · Bambino Plus · Personal</p>
        </div>
        <div className="tabs">
          <button className={`tab ${tab === "dial" ? "active" : ""}`} onClick={() => setTab("dial")}>New Coffee</button>
          <button className={`tab ${tab === "log" ? "active" : ""}`} onClick={() => setTab("log")}>Log Shot</button>
          <button className={`tab ${tab === "shots" ? "active" : ""}`} onClick={() => setTab("shots")}>Shots ({history.length})</button>
          <button className={`tab ${tab === "bags" ? "active" : ""}`} onClick={() => setTab("bags")}>Bags ({bags.length})</button>
          <button className={`tab ${tab === "kit" ? "active" : ""}`} onClick={() => setTab("kit")}>Kit</button>
        </div>
        {tab === "dial" && <DialTab history={history} onBagScanned={saveBag} />}
        {tab === "log" && <LogTab onSave={addEntry} bags={bags} onUpdateBag={updateBag} history={history} />}
        {tab === "shots" && <HistoryTab history={history} />}
        {tab === "bags" && <BagsTab bags={bags} history={history} />}
        {tab === "kit" && <ProfilePage profile={profile} onSave={saveProfile} />}
      </div>
      {showOnboarding && (
        <OnboardingModal onSave={saveProfile} onSkip={() => setShowOnboarding(false)} />
      )}
    </>
  );
}

function DialTab({ history, onBagScanned }) {
  const [images, setImages] = useState([]);
  const [bagInfo, setBagInfo] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState("upload");

  const handleFiles = async (files) => {
    const arr = await Promise.all(Array.from(files).map(async f => ({
      url: URL.createObjectURL(f),
      base64: await toBase64(f),
      type: f.type || "image/jpeg",
    })));
    setImages(prev => [...prev, ...arr]);
  };

  const removeImage = (i) => setImages(prev => prev.filter((_, idx) => idx !== i));

  const handleExtract = async () => {
    setStatus("Reading photos...");
    const info = await extractBagInfo(images);
    setBagInfo(info);
    setStatus(null);
    setStep("extracted");
  };

  const handleRecommend = async () => {
    setStatus("Generating recipe...");
    const rec = await generateRecommendation(bagInfo, history);
    setRecommendation(rec);
    await onBagScanned(bagInfo, rec);
    setStatus(null);
    setStep("recommended");
  };

  const reset = () => { setImages([]); setBagInfo(null); setRecommendation(null); setStatus(null); setStep("upload"); };

  return (
    <div>
      {step === "upload" && (
        <div className="card">
          <div className="card-title">Scan a new bag</div>
          <div className="upload-zone" style={{ padding: images.length ? "16px" : "40px 20px" }}>
            <input type="file" accept="image/*" multiple onChange={e => e.target.files.length && handleFiles(e.target.files)} />
            {images.length === 0 ? (
              <><div className="icon">📷</div><p>Add photos — label, roast date, beans, anything useful</p></>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", pointerEvents: "none" }}>
                {images.map((img, i) => (
                  <div key={i} style={{ position: "relative", pointerEvents: "auto" }}>
                    <img src={img.url} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 4, display: "block" }} alt={`photo ${i+1}`} />
                    <button onClick={e => { e.stopPropagation(); removeImage(i); }} style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "var(--red)", border: "none", color: "#fff", fontSize: "0.7rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                  </div>
                ))}
                <div style={{ width: 80, height: 80, border: "1px dashed var(--border-light)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem", color: "var(--cream-muted)" }}>+</div>
              </div>
            )}
          </div>
          {images.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: "0.7rem", color: "var(--cream-muted)", marginBottom: 10 }}>{images.length} photo{images.length !== 1 ? "s" : ""} added</div>
              {status ? <div className="status"><div className="spinner" />{status}</div> : (
                <button className="btn btn-primary btn-full" onClick={handleExtract}>Extract info →</button>
              )}
            </div>
          )}
        </div>
      )}

      {step === "extracted" && bagInfo && (
        <>
          <div className="card">
            <div className="card-title">Bag details</div>
            <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
              {images.length > 0 && <img src={images[0].url} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} alt="bag" />}
              <div>
                <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "1.1rem", marginBottom: 4 }}>{bagInfo.name}</div>
                <div style={{ fontSize: "0.78rem", color: "var(--cream-muted)" }}>{bagInfo.roaster}</div>
                {bagInfo.origin && <span className="tag">{bagInfo.origin}</span>}
                {bagInfo.process && bagInfo.process !== "unknown" && <span className="tag tag-accent">{bagInfo.process}</span>}
                {bagInfo.roastLevel && bagInfo.roastLevel !== "unknown" && <span className="tag">{bagInfo.roastLevel} roast</span>}
                {bagInfo.roastDate && <div style={{ fontSize: "0.7rem", color: "var(--cream-muted)", marginTop: 8 }}>Roasted {bagInfo.roastDate} · {Math.floor((Date.now() - new Date(bagInfo.roastDate)) / 86400000)} days ago</div>}
              </div>
            </div>
            <EditableBagInfo bagInfo={bagInfo} onChange={setBagInfo} />
          </div>
          {status ? <div className="status"><div className="spinner" />{status}</div> : (
            <button className="btn btn-primary btn-full" onClick={handleRecommend}>Generate starting recipe →</button>
          )}
        </>
      )}

      {step === "recommended" && recommendation && (
        <>
          <div className="card">
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "1.05rem", marginBottom: 4 }}>{bagInfo.name}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--cream-muted)", marginBottom: 16 }}>{bagInfo.roaster} · {bagInfo.origin}</div>
            <RecipeDisplay recipe={recommendation} />
          </div>
          <button className="btn btn-ghost btn-full" onClick={reset}>Start new</button>
        </>
      )}
    </div>
  );
}

function EditableBagInfo({ bagInfo, onChange }) {
  const update = (k, v) => onChange({ ...bagInfo, [k]: v });
  return (
    <div>
      <div className="divider" />
      <div className="section-label">Confirm or correct</div>
      <div className="fields-row">
        <div className="field"><label>Roast Level</label>
          <select value={bagInfo.roastLevel} onChange={e => update("roastLevel", e.target.value)}>
            <option value="light">Light</option><option value="medium">Medium</option><option value="dark">Dark</option><option value="unknown">Unknown</option>
          </select>
        </div>
        <div className="field"><label>Process</label>
          <select value={bagInfo.process} onChange={e => update("process", e.target.value)}>
            <option value="washed">Washed</option><option value="natural">Natural</option><option value="honey">Honey</option><option value="unknown">Unknown</option>
          </select>
        </div>
      </div>
      <div className="fields-row">
        <div className="field"><label>Origin</label><input value={bagInfo.origin || ""} onChange={e => update("origin", e.target.value)} /></div>
        <div className="field"><label>Roast Date</label><input type="date" value={bagInfo.roastDate || ""} onChange={e => update("roastDate", e.target.value)} /></div>
      </div>
    </div>
  );
}

function RecipeDisplay({ recipe }) {
  return (
    <div className="recipe-card">
      <div className="recipe-title">Recommended starting point</div>
      <div className="recipe-grid">
        <div className="recipe-stat"><div className="value">{recipe.niche}</div><div className="unit">Niche</div><div className="label">Grind</div></div>
        <div className="recipe-stat"><div className="value">{recipe.dose}</div><div className="unit">g</div><div className="label">Dose</div></div>
        <div className="recipe-stat"><div className="value">{recipe.yield}</div><div className="unit">g</div><div className="label">Yield</div></div>
        <div className="recipe-stat"><div className="value">{recipe.time}</div><div className="unit">sec</div><div className="label">Time</div></div>
      </div>
      {recipe.reasoning && <div className="recipe-reasoning">{recipe.reasoning}</div>}
      {recipe.adjustmentTips && <div className="recipe-tips">{recipe.adjustmentTips}</div>}
    </div>
  );
}

function LogTab({ onSave, bags, onUpdateBag, history }) {
  const EMPTY_FORM = { name: "", roaster: "", origin: "", process: "washed", roastLevel: "medium", roastDate: "", niche: "", dose: "18", yield: "36", time: "27", tastingNote: "", verdict: "dialled-in" };
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedBag, setSelectedBag] = useState(null);
  const [selectedBagId, setSelectedBagId] = useState("");
  const [generatingRec, setGeneratingRec] = useState(false);
  const [liveRec, setLiveRec] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const liveBag = selectedBag ? bags.find(b => b.id === selectedBag.id) : null;
  const activeRec = liveBag?.recommendation || liveRec;

  const selectBag = async (bag) => {
    if (!bag) { setSelectedBag(null); setSelectedBagId(""); setLiveRec(null); return; }
    setSelectedBag(bag);

    const dialledIn = history.find(h => h.bagInfo.name === bag.name && (h.verdict === "dialled-in" || h.verdict === "good"));
    const baseRec = dialledIn
      ? { niche: dialledIn.recipe.niche, dose: dialledIn.recipe.dose, yield: dialledIn.recipe.yield, time: dialledIn.recipe.time, reasoning: `Based on your dialled-in shot from ${dialledIn.date}.`, adjustmentTips: bag.recommendation?.adjustmentTips || "" }
      : bag.recommendation;

    setForm(f => ({
      ...f,
      name: bag.name || "",
      roaster: bag.roaster || "",
      origin: bag.origin || "",
      process: bag.process !== "unknown" ? bag.process : "washed",
      roastLevel: bag.roastLevel !== "unknown" ? bag.roastLevel : "medium",
      roastDate: bag.roastDate || "",
      niche: baseRec?.niche ? String(baseRec.niche) : "",
      dose: baseRec?.dose ? String(baseRec.dose) : "18",
      yield: baseRec?.yield ? String(baseRec.yield) : "36",
      time: baseRec?.time ? String(baseRec.time) : "27",
    }));

    if (dialledIn) { setLiveRec(baseRec); return; }

    if (!bag.recommendation) {
      setGeneratingRec(true);
      const rec = await generateRecommendation(bag, history);
      setLiveRec(rec);
      if (onUpdateBag) onUpdateBag(bag.id, rec);
      setForm(f => ({
        ...f,
        niche: rec.niche ? String(rec.niche) : f.niche,
        dose: rec.dose ? String(rec.dose) : f.dose,
        yield: rec.yield ? String(rec.yield) : f.yield,
        time: rec.time ? String(rec.time) : f.time,
      }));
      setGeneratingRec(false);
    }
  };

  const handleGenerateRec = async () => {
    setGeneratingRec(true);
    const rec = await generateRecommendation(selectedBag, history);
    setLiveRec(rec);
    if (onUpdateBag) onUpdateBag(selectedBag.id, rec);
    setForm(f => ({
      ...f,
      niche: rec.niche ? String(rec.niche) : f.niche,
      dose: rec.dose ? String(rec.dose) : f.dose,
      yield: rec.yield ? String(rec.yield) : f.yield,
      time: rec.time ? String(rec.time) : f.time,
    }));
    setGeneratingRec(false);
  };

  const handleSave = async () => {
    const shotDate = new Date().toISOString().split("T")[0];
    const daysOffRoast = form.roastDate
      ? Math.floor((new Date(shotDate) - new Date(form.roastDate)) / 86400000)
      : null;
    const entry = {
      id: Date.now(),
      date: shotDate,
      daysOffRoast,
      bagInfo: { name: form.name, roaster: form.roaster, origin: form.origin, process: form.process, roastLevel: form.roastLevel, roastDate: form.roastDate || null },
      recipe: { niche: parseFloat(form.niche), dose: Number(form.dose), yield: Number(form.yield), time: Number(form.time) },
      tastingNote: form.tastingNote,
      verdict: form.verdict,
    };
    onSave(entry);

    if ((form.verdict === "dialled-in" || form.verdict === "good") && selectedBag?.id && onUpdateBag) {
      onUpdateBag(selectedBag.id, {
        niche: Number(form.niche), dose: Number(form.dose), yield: Number(form.yield), time: Number(form.time),
        reasoning: `Updated from a dialled-in shot logged on ${entry.date}.`,
        adjustmentTips: activeRec?.adjustmentTips || "If sour: grind finer or increase time. If bitter: grind coarser or reduce time.",
      });
    }

    setShowConfirm(true);
    setTimeout(() => {
      setShowConfirm(false);
      setSelectedBag(null);
      setSelectedBagId("");
      setLiveRec(null);
      setForm(EMPTY_FORM);
    }, 1600);
  };

  return (
    <div style={{ position: "relative" }}>
      {showConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(14,11,9,0.92)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, animation: "fadeIn 0.2s ease" }}>
          <div style={{ fontSize: "2.2rem" }}>☕</div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "1.4rem", color: "var(--cream)" }}>Shot logged</div>
          <div style={{ fontSize: "0.72rem", color: "var(--cream-muted)", letterSpacing: "0.12em", textTransform: "uppercase" }}>{form.name || "Coffee"} · Niche {form.niche}</div>
        </div>
      )}
      <div className="card">
        <div className="card-title">Log a shot</div>

        {bags.length > 0 && (
          <div className="field">
            <label>Select a scanned bag</label>
            <select value={selectedBagId} onChange={e => { const id = e.target.value; setSelectedBagId(id); selectBag(bags.find(b => String(b.id) === id) || null); }}>
              <option value="" disabled>Pick a bag…</option>
              {bags.map(b => <option key={b.id} value={String(b.id)}>{b.name} — {b.roaster} ({b.scannedDate})</option>)}
            </select>
          </div>
        )}

        {selectedBag && generatingRec && <div style={{ marginBottom: 16 }}><div className="status"><div className="spinner" />Generating recipe...</div></div>}
        {selectedBag && !activeRec && !generatingRec && (
          <div style={{ marginBottom: 16 }}>
            <button className="btn btn-ghost btn-full" onClick={handleGenerateRec}>Generate suggested recipe →</button>
          </div>
        )}
        {activeRec && (
          <div style={{ marginBottom: 16 }}>
            <div className="recipe-card" style={{ margin: 0 }}>
              <div className="recipe-title">Suggested starting point</div>
              <div className="recipe-grid">
                <div className="recipe-stat"><div className="value">{activeRec.niche}</div><div className="unit">Niche</div><div className="label">Grind</div></div>
                <div className="recipe-stat"><div className="value">{activeRec.dose}</div><div className="unit">g</div><div className="label">Dose</div></div>
                <div className="recipe-stat"><div className="value">{activeRec.yield}</div><div className="unit">g</div><div className="label">Yield</div></div>
                <div className="recipe-stat"><div className="value">{activeRec.time}</div><div className="unit">sec</div><div className="label">Time</div></div>
              </div>
              {activeRec.reasoning && <div className="recipe-reasoning">{activeRec.reasoning}</div>}
              {activeRec.adjustmentTips && <div className="recipe-tips">{activeRec.adjustmentTips}</div>}
            </div>
            <div style={{ fontSize: "0.68rem", color: "var(--cream-muted)", marginTop: 8 }}>Recipe pre-filled below — adjust to what actually worked.</div>
          </div>
        )}

        {bags.length > 0 && <div className="divider" />}

        <div className="fields-row">
          <div className="field"><label>Coffee Name</label><input value={form.name} onChange={e => update("name", e.target.value)} placeholder="e.g. Yirgacheffe Natural" /></div>
          <div className="field"><label>Roaster</label><input value={form.roaster} onChange={e => update("roaster", e.target.value)} placeholder="e.g. Square Mile" /></div>
        </div>
        <div className="fields-row">
          <div className="field"><label>Origin</label><input value={form.origin} onChange={e => update("origin", e.target.value)} placeholder="e.g. Ethiopia" /></div>
          <div className="field"><label>Roast Date</label><input type="date" value={form.roastDate} onChange={e => update("roastDate", e.target.value)} /></div>
        </div>
        <div className="fields-row">
          <div className="field"><label>Process</label>
            <select value={form.process} onChange={e => update("process", e.target.value)}>
              <option value="washed">Washed</option><option value="natural">Natural</option><option value="honey">Honey</option>
            </select>
          </div>
          <div className="field"><label>Roast Level</label>
            <select value={form.roastLevel} onChange={e => update("roastLevel", e.target.value)}>
              <option value="light">Light</option><option value="medium">Medium</option><option value="dark">Dark</option>
            </select>
          </div>
        </div>
        <div className="divider" />
        <div className="section-label">Recipe</div>
        <div className="fields-row-3">
          <div className="field"><label>Niche Setting</label><input type="number" step="0.5" value={form.niche} onChange={e => update("niche", e.target.value)} placeholder="e.g. 12.5" /></div>
          <div className="field"><label>Dose (g)</label><input type="number" value={form.dose} onChange={e => update("dose", e.target.value)} /></div>
          <div className="field"><label>Yield (g)</label><input type="number" value={form.yield} onChange={e => update("yield", e.target.value)} /></div>
        </div>
        <div className="field" style={{ maxWidth: 160 }}><label>Time (sec)</label><input type="number" value={form.time} onChange={e => update("time", e.target.value)} /></div>
        <div className="field"><label>Tasting note</label><textarea value={form.tastingNote} onChange={e => update("tastingNote", e.target.value)} placeholder="e.g. Bright cherry, clean finish." /></div>
        <div className="field"><label>Verdict</label>
          <select value={form.verdict} onChange={e => update("verdict", e.target.value)}>
            <option value="dialled-in">✓ Dialled in</option>
            <option value="acceptable">~ Acceptable</option>
            <option value="slow">↓ Too slow — ran long, likely too fine</option>
            <option value="fast">↑ Too fast — ran short, likely too coarse</option>
          </select>
        </div>
        <button className="btn btn-primary btn-full" onClick={handleSave} disabled={!form.name || !form.niche}>
          Save to history
        </button>
      </div>
    </div>
  );
}

function BagsTab({ bags, history }) {
  const [selected, setSelected] = useState(null);

  if (bags.length === 0) return (
    <div className="history-empty">
      <div style={{ fontSize: "2rem", marginBottom: 12 }}>☕</div>
      <div>No bags scanned yet.</div>
      <div style={{ marginTop: 6, fontSize: "0.7rem" }}>Use New Coffee to scan a bag and save it.</div>
    </div>
  );

  if (selected) {
    const b = selected;
    const bagShots = history.filter(h => h.bagInfo.name === b.name).sort((a, c) => c.date.localeCompare(a.date));
    return (
      <div>
        <button className="btn btn-ghost" style={{ marginBottom: 20 }} onClick={() => setSelected(null)}>← Back</button>
        <div className="card">
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "1.2rem", marginBottom: 4 }}>{b.name}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--cream-muted)", marginBottom: 12 }}>{b.roaster}</div>
          {b.origin && b.origin !== "unknown" && <span className="tag">{b.origin}</span>}
          {b.process && b.process !== "unknown" && <span className="tag tag-accent">{b.process}</span>}
          {b.roastLevel && b.roastLevel !== "unknown" && <span className="tag">{b.roastLevel} roast</span>}
          {b.roastDate && <div style={{ fontSize: "0.7rem", color: "var(--cream-muted)", marginTop: 10 }}>Roasted {b.roastDate} · {Math.floor((Date.now() - new Date(b.roastDate)) / 86400000)} days ago</div>}
          {b.notes && <><div className="divider" /><div style={{ fontSize: "0.75rem", color: "var(--cream-muted)", fontStyle: "italic", lineHeight: 1.6 }}>{b.notes}</div></>}
          {b.details && (b.details.varietal || b.details.producer || b.details.altitude || b.details.roasterTastingNotes || b.details.certifications) && (
            <>
              <div className="divider" />
              <div className="section-label">Details</div>
              {b.details.varietal && <div style={{ fontSize: "0.75rem", color: "var(--cream-muted)", marginBottom: 6 }}><span style={{ color: "var(--cream)" }}>Varietal</span> · {b.details.varietal}</div>}
              {b.details.producer && <div style={{ fontSize: "0.75rem", color: "var(--cream-muted)", marginBottom: 6 }}><span style={{ color: "var(--cream)" }}>Producer</span> · {b.details.producer}</div>}
              {b.details.altitude && <div style={{ fontSize: "0.75rem", color: "var(--cream-muted)", marginBottom: 6 }}><span style={{ color: "var(--cream)" }}>Altitude</span> · {b.details.altitude}</div>}
              {b.details.certifications && <div style={{ fontSize: "0.75rem", color: "var(--cream-muted)", marginBottom: 6 }}><span style={{ color: "var(--cream)" }}>Certifications</span> · {b.details.certifications}</div>}
              {b.details.roasterTastingNotes && <div style={{ fontSize: "0.75rem", color: "var(--cream-muted)", marginBottom: 6 }}><span style={{ color: "var(--cream)" }}>Roaster notes</span> · <span style={{ fontStyle: "italic" }}>{b.details.roasterTastingNotes}</span></div>}
            </>
          )}
          {b.recommendation && (
            <>
              <div className="divider" />
              <div className="recipe-card" style={{ margin: 0 }}>
                <div className="recipe-title">{b.recommendation.reasoning?.startsWith("Updated") ? `Dialled-in recipe · ${b.recommendation.reasoning.match(/\d{4}-\d{2}-\d{2}/)?.[0] || ""}` : "Suggested starting point"}</div>
                <div className="recipe-grid">
                  <div className="recipe-stat"><div className="value">{b.recommendation.niche}</div><div className="unit">Niche</div><div className="label">Grind</div></div>
                  <div className="recipe-stat"><div className="value">{b.recommendation.dose}</div><div className="unit">g</div><div className="label">Dose</div></div>
                  <div className="recipe-stat"><div className="value">{b.recommendation.yield}</div><div className="unit">g</div><div className="label">Yield</div></div>
                  <div className="recipe-stat"><div className="value">{b.recommendation.time}</div><div className="unit">sec</div><div className="label">Time</div></div>
                </div>
                {b.recommendation.reasoning && <div className="recipe-reasoning">{b.recommendation.reasoning}</div>}
                {b.recommendation.adjustmentTips && <div className="recipe-tips">{b.recommendation.adjustmentTips}</div>}
              </div>
            </>
          )}
          {bagShots.length > 0 && (
            <>
              <div className="divider" />
              <div className="section-label">{bagShots.length} shot{bagShots.length !== 1 ? "s" : ""} logged</div>
              {bagShots.map(s => (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--cream)" }}>Niche {s.recipe.niche} · {s.recipe.dose}g → {s.recipe.yield}g · {s.recipe.time}s{s.daysOffRoast != null ? ` · ${s.daysOffRoast}d off roast` : ""}</div>
                    {s.tastingNote && <div style={{ fontSize: "0.68rem", color: "var(--cream-muted)", fontStyle: "italic", marginTop: 3 }}>{s.tastingNote.slice(0, 60)}{s.tastingNote.length > 60 ? "…" : ""}</div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0, marginLeft: 12 }}>
                    <div className={`history-item-verdict ${verdictClass(s.verdict)}`}>{verdictLabel(s.verdict)}</div>
                    <div style={{ fontSize: "0.62rem", color: "var(--cream-muted)" }}>{s.date}</div>
                  </div>
                </div>
              ))}
            </>
          )}
          <div style={{ fontSize: "0.68rem", color: "var(--cream-muted)", marginTop: 12 }}>Scanned {b.scannedDate}</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="section-label">{bags.length} bag{bags.length !== 1 ? "s" : ""} saved</div>
      {bags.map(b => (
        <div key={b.id} className="history-item" onClick={() => setSelected(b)}>
          <div className="history-item-header">
            <div>
              <div className="history-item-name">{b.name}</div>
              <div className="history-item-roaster">{b.roaster} · scanned {b.scannedDate}</div>
            </div>
          </div>
          <div style={{ marginTop: 4 }}>
            {b.origin && b.origin !== "unknown" && <span className="tag">{b.origin}</span>}
            {b.process && b.process !== "unknown" && <span className="tag tag-accent">{b.process}</span>}
            {b.roastLevel && b.roastLevel !== "unknown" && <span className="tag">{b.roastLevel} roast</span>}
          </div>
          {b.roastDate && <div style={{ fontSize: "0.7rem", color: "var(--cream-muted)", marginTop: 6 }}>Roasted {b.roastDate} · {Math.floor((Date.now() - new Date(b.roastDate)) / 86400000)} days ago</div>}
        </div>
      ))}
    </div>
  );
}

function HistoryTab({ history }) {
  const [selected, setSelected] = useState(null);

  if (history.length === 0) return (
    <div className="history-empty">
      <div style={{ fontSize: "2rem", marginBottom: 12 }}>☕</div>
      <div>No shots logged yet.</div>
      <div style={{ marginTop: 6, fontSize: "0.7rem" }}>Use the Log Shot tab to record your first shot.</div>
    </div>
  );

  if (selected) {
    const e = selected;
    return (
      <div>
        <button className="btn btn-ghost" style={{ marginBottom: 20 }} onClick={() => setSelected(null)}>← Back</button>
        <div className="card">
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "1.2rem", marginBottom: 4 }}>{e.bagInfo.name}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--cream-muted)", marginBottom: 12 }}>{e.bagInfo.roaster}{e.daysOffRoast != null ? ` · ${e.daysOffRoast} days off roast` : ""}</div>
          {e.bagInfo.origin && <span className="tag">{e.bagInfo.origin}</span>}
          {e.bagInfo.process && <span className="tag tag-accent">{e.bagInfo.process}</span>}
          {e.bagInfo.roastLevel && <span className="tag">{e.bagInfo.roastLevel}</span>}
          <div className="divider" />
          <div className="recipe-card">
            <div className="recipe-title">{verdictLabel(e.verdict)} · {e.date}</div>
            <div className="recipe-grid">
              <div className="recipe-stat"><div className="value">{e.recipe.niche}</div><div className="unit">Niche</div><div className="label">Grind</div></div>
              <div className="recipe-stat"><div className="value">{e.recipe.dose}</div><div className="unit">g</div><div className="label">Dose</div></div>
              <div className="recipe-stat"><div className="value">{e.recipe.yield}</div><div className="unit">g</div><div className="label">Yield</div></div>
              <div className="recipe-stat"><div className="value">{e.recipe.time}</div><div className="unit">sec</div><div className="label">Time</div></div>
            </div>
          </div>
          {e.tastingNote && <div style={{ fontSize: "0.8rem", color: "var(--cream-muted)", fontStyle: "italic", lineHeight: 1.6 }}>{e.tastingNote}</div>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="section-label">{history.length} shot{history.length !== 1 ? "s" : ""} logged</div>
      {history.map(e => (
        <div key={e.id} className="history-item" onClick={() => setSelected(e)}>
          <div className="history-item-header">
            <div>
              <div className="history-item-name">{e.bagInfo.name}</div>
              <div className="history-item-roaster">{e.bagInfo.roaster} · {e.date}</div>
            </div>
            <div className={`history-item-verdict ${verdictClass(e.verdict)}`}>{verdictLabel(e.verdict)}</div>
          </div>
          <div className="history-item-recipe">
            Niche <span>{e.recipe.niche}</span> · {e.recipe.dose}g in · {e.recipe.yield}g out · <span>{e.recipe.time}s</span>
          </div>
          {e.tastingNote && <div className="history-item-note">"{e.tastingNote.slice(0, 80)}{e.tastingNote.length > 80 ? "…" : ""}"</div>}
        </div>
      ))}
    </div>
  );
}
