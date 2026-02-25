/* app.js - APO Economic Indicator Dashboard (FINAL)
   - Public: read-only (no CSV/JSON loaders visible)
   - Admin (admin.html): CSV/JSON loaders + download updated data.js
*/

const SOURCE_LABEL = "Source: Data_Master (Databook 2025 + Readiness 2025)";
const IS_ADMIN = !!window.APO_ADMIN;

/** -------- Defaults (fallback indicator defs) -------- */
const DEFAULT_INDICATORS = [
  { id:"GDP_PPP_2023_bn", label:"GDP in 2023 (Billion USD, 2023)", unit:"Billion USD", fmt:"0,0" },
  { id:"GDP_growth_2223_pct", label:"GDP growth (%, 2022–23)", unit:"Percent", fmt:"0.0", proj:"GDP_growth_proj_2530_pct" },
  { id:"GDPpc_PPP_2023_kUSD", label:"Per capita GDP in 2023 (Thousand USD, 2023)", unit:"Thousand USD", fmt:"0.0" },
  { id:"Population_2022_m", label:"Population (million, 2022)", unit:"Million", fmt:"0.0" },
  { id:"Employment_2023_thousand", label:"Number of employment (Thousands persons, 2023)", unit:"Thousand persons", fmt:"0,0" },
  { id:"Employment_rate_2023_pct", label:"Employment rate (2023)", unit:"Percent", fmt:"0.0" },
  { id:"LP_level_per_worker_2023_kUSD", label:"Per-worker labor productivity level (Thousand USD per worker, 2023)", unit:"Thousand USD", fmt:"0.0" },
  { id:"LP_growth_2223_pct", label:"Per-worker labor productivity growth (%, 2022–23)", unit:"Percent", fmt:"0.0", proj:"LP_growth_proj_2530_pct" },
  { id:"Agri_share_GDP_2023_pct", label:"Agriculture share in GDP (2023)", unit:"Percent", fmt:"0.0" },
  { id:"Mfg_share_GDP_2023_pct", label:"Manufacturing share in GDP (2023)", unit:"Percent", fmt:"0.0" },
  { id:"Capital_prod_growth_2223_pct", label:"Capital productivity growth (2022–23)", unit:"Percent", fmt:"0.0", proj:"Capital_prod_growth_proj_2530_pct" },
  { id:"TFP_growth_2223_pct", label:"TFP growth (2022–23)", unit:"Percent", fmt:"0.0", proj:"TFP_growth_proj_2530_pct" },
];

/** -------- Menu (UI-only, generated from APO_Menu_Structure_v1.xlsx) -------- */
const MENU_TREE = Array.isArray(window.APO_MENU) ? window.APO_MENU : [];

function _normKey(s){
  return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
}

/* Map wireframe indicator names -> current data.js indicator IDs (UI-only).
   If an indicator is missing in data.js, the UI renders it as "Coming soon". */
const MENU_TO_INDICATOR_ID = {
  realgdp: "GDP_PPP_2023_bn",
  realgdpgrowth: "GDP_growth_2223_pct",
  percapitarealgdp: "GDPpc_PPP_2023_kUSD",
  population: "Population_2022_m",
  numberofemployment: "Employment_2023_thousand",
  employmentrate: "Employment_rate_2023_pct",

  perworkerlaborproductivity: "LP_level_per_worker_2023_kUSD",
  perworkerlaborproductivitygrowth: "LP_growth_2223_pct",
  perhourlaborproductivity: "LP_level_per_hour_2023_USD",
  perhourlaborproductivitygrowth: "LP_growth_per_hour_2223_pct",

  agriculturegdpshare: "Agri_share_GDP_2023_pct",
  manufacturinggdpshare: "Mfg_share_GDP_2023_pct",

  capitalproductivitygrowth: "Capital_prod_growth_2223_pct",
  tfpgrowth: "TFP_growth_2223_pct",
};

/* Map wireframe indicator names -> trends time-series codes (best-effort).
   If missing, "Trend & Compare" shows as disabled. */
const MENU_TO_TS_CODE = {
  // TEST BUILD (Option A): Pilot trends from Excel long-format CSV
  // Only mapped indicators will enable "Trend & Compare"; others remain "Coming soon".
  realgdp: "out_gdp_ppp_level",
  population: "pop_total_level",
  consumerpriceindexcpi: "price_cpi_index",
  perworkerlaborproductivity: "prod_lp_per_worker_index",
  perhourlaborproductivity: "prod_lp_per_hour_index",
  tfpgrowth: "prod_tfp_index",
};


let _menuOpenGroups = new Set(loadLS("apo_menu_open_groups_v1", []) || []);
let _menuOpenIndicators = new Set(loadLS("apo_menu_open_inds_v1", []) || []);
let _menuQuery = "";
let _menuInitDone = false;

function saveMenuOpenState(){
  saveLS("apo_menu_open_groups_v1", Array.from(_menuOpenGroups));
  saveLS("apo_menu_open_inds_v1", Array.from(_menuOpenIndicators));
}

/* Tiny toast (UI-only). */
let _toastTimer = null;
function showToast(msg){
  const id = "apoToast";
  let el = document.getElementById(id);
  if(!el){
    el = document.createElement("div");
    el.id = id;
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.bottom = "16px";
    el.style.transform = "translateX(-50%)";
    el.style.zIndex = "999";
    el.style.background = "rgba(0,0,0,.65)";
    el.style.color = "white";
    el.style.padding = "10px 12px";
    el.style.borderRadius = "14px";
    el.style.border = "1px solid rgba(255,255,255,.25)";
    el.style.maxWidth = "min(520px, 92vw)";
    el.style.fontWeight = "650";
    el.style.boxShadow = "0 14px 40px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  if(_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(()=>{ el.style.opacity = "0"; }, 2200);
}

function inferRefPeriodFromLabel(label){
  const s = String(label||"");
  const m = s.match(/\(([^)]*)\)\s*$/); // last (...)
  if(!m) return null;
  const inner = m[1];
  const yr = inner.match(/(19|20)\d{2}(?:\s*[–-]\s*(?:19|20)?\d{2,4})?/);
  if(yr) return yr[0].replace(/\s+/g," ").replace("-", "–");
  return null;
}

function resolveIndicatorForMenu(menuIndName){
  const key = _normKey(menuIndName);
  const mappedId = MENU_TO_INDICATOR_ID[key];
  const ind = mappedId ? getIndicator(mappedId) : null;
  return { key, mappedId, ind };
}

function resolveTsCodeForMenu(menuIndName){
  const key = _normKey(menuIndName);
  return MENU_TO_TS_CODE[key] || null;
}

/** -------- Helpers -------- */
const $ = (sel)=>document.querySelector(sel);
const $$ = (sel)=>Array.from(document.querySelectorAll(sel));

function deepClone(x){ return JSON.parse(JSON.stringify(x)); }
function isNum(x){ return typeof x === "number" && Number.isFinite(x); }

function loadLS(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  }catch(_){ return fallback; }
}
function saveLS(key, val){
  try{ localStorage.setItem(key, JSON.stringify(val)); }catch(_){}
}

function fmtNumber(x, decimals=null){
  if(!isNum(x)) return "–";
  if(decimals === null) return x.toLocaleString();
  return x.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Backward-compatible alias used throughout the UI rendering code.
// Some modules call `fmt(...)` (historical name), while the canonical
// implementation here is `fmtNumber(...)`.
function fmt(x, decimals=null){
  return fmtNumber(x, decimals);
}

/** -------- Data -------- */
const PACKAGED = Array.isArray(window.APO_DATA) ? window.APO_DATA : [];
let DATA = deepClone(PACKAGED);

const PACKAGED_INDICATORS = Array.isArray(window.APO_INDICATORS)
  ? window.APO_INDICATORS
  : DEFAULT_INDICATORS;

let INDICATORS = deepClone(PACKAGED_INDICATORS);

const state = {
  view:"summary",
  indicatorId:null,
  country:"",
  mode:"all",       // data | projection | all
  sort:"highest",   // highest | lowest | alpha
  search:"",
  theme: loadLS("apo_theme", "violet") || "violet",
  sourceFile: (window.APO_META && window.APO_META.source_file) ? window.APO_META.source_file : "Data_Master",
  tsMeta: null,
  tsIndicator: null,
  tsEconomy: null,
  tsCompare: [],
  tsCompareOpen: false,
  tsLocked: false,
  tsEcoQuery: "",
  tsAllOn: false,
};


/** -------- CSV-first contract scaffold (Option A migration, SAFE) --------
  Goal: move toward CSV-first without breaking v8.
  Rule: if data.js has a value, keep it. CSV is used only as fallback.
  Files (GitHub Pages-ready):
    - data/economies.csv
    - data/indicators.csv
    - data/trend_master.csv
    - data/projection_baseline.csv
-------------------------------------------------------------- */

const CSV_FIRST = {
  loaded: false,
  // economies
  econNameToCode: new Map(),   // dashboard economy name -> economy_code
  econCodeToShort: new Map(),  // economy_code -> short_name
  // indicators
  indicatorById: new Map(),    // indicator_id -> {trend_series_id, transform, ref_period, ...}
  // projection baseline (v4-derived)
  projection: new Map(),       // proj_indicator_id -> Map(economy_code -> value)
};

/* CSV reader for contract files (reuses the app's quote-aware parser). */
function _csvReadObjects(text){
  const rows = parseCSV(String(text||""));
  if(rows.length < 2) return [];
  const header = rows[0].map(h => (h||"").trim().replace(/^\uFEFF/, ""));
  return rows.slice(1).map(r=>{
    const obj = {};
    header.forEach((h, idx)=>{ obj[h] = (r[idx] ?? ""); });
    return obj;
  });
}

function _csvApplyTransform(val, transform){
  if(!isNum(val)) return null;
  const t = String(transform||"").trim();
  if(!t) return val;
  // supported: divide:1000  multiply:1000  add:...  subtract:...
  const m = t.match(/^(divide|multiply|add|subtract):(-?\d+(?:\.\d+)?)$/i);
  if(!m) return val;
  const op = m[1].toLowerCase();
  const k = Number(m[2]);
  if(!Number.isFinite(k) || k === 0 && op === "divide") return val;
  if(op === "divide") return val / k;
  if(op === "multiply") return val * k;
  if(op === "add") return val + k;
  if(op === "subtract") return val - k;
  return val;
}

function _parseRefYear(refPeriod){
  // "2023" -> 2023 ; "2022–23" -> 2023 (end year) ; else null
  const s = String(refPeriod||"");
  const m = s.match(/(19|20)\d{2}(?:\D+(\d{2,4}))?/);
  if(!m) return null;
  if(m[2]){
    const end = m[2].length === 2 ? Number(String(m[1]) + m[2]) : Number(m[2]);
    return Number.isFinite(end) ? end : null;
  }
  const y = Number(m[0].slice(0,4));
  return Number.isFinite(y) ? y : null;
}

function csvGetEconomyCode(dashboardEconomyName){
  return CSV_FIRST.econNameToCode.get(dashboardEconomyName) || null;
}

function csvGetIndicatorRecord(indicatorId){
  return CSV_FIRST.indicatorById.get(indicatorId) || null;
}

function csvGetProjectionValue(dashboardEconomyName, projIndicatorId){
  if(!CSV_FIRST.loaded) return null;
  const code = csvGetEconomyCode(dashboardEconomyName);
  if(!code) return null;
  const m = CSV_FIRST.projection.get(projIndicatorId);
  if(!m) return null;
  const v = m.get(code);
  return isNum(v) ? v : null;
}

function csvGetDerivedDataValue(dashboardEconomyName, indicatorId){
  if(!CSV_FIRST.loaded) return null;
  const rec = csvGetIndicatorRecord(indicatorId);
  if(!rec || !rec.trend_series_id) return null;

  const code = csvGetEconomyCode(dashboardEconomyName);
  if(!code) return null;

  // Need trend master loaded to use _pilotByEco map (shared with Trends view)
  if(!_pilotTrendsLoaded) return null;

  const ecoMap = _pilotByEco.get(code);
  if(!ecoMap) return null;
  const yearMap = ecoMap.get(rec.trend_series_id);
  if(!yearMap) return null;

  // Prefer ref-year (keeps UI labels consistent); fallback to latest year available.
  const refY = _parseRefYear(rec.ref_period);
  let y = (refY && yearMap.has(refY)) ? refY : null;
  if(y === null){
    let maxY = -Infinity;
    for(const yy of yearMap.keys()) maxY = Math.max(maxY, yy);
    if(maxY === -Infinity) return null;
    y = maxY;
  }
  const raw = yearMap.get(y);
  const v = _csvApplyTransform(raw, rec.transform);
  return isNum(v) ? v : null;
}

async function loadCsvContracts(){
  if(CSV_FIRST.loaded) return;

  // economies.csv
  try{
    const res = await fetch("data/economies.csv", { cache:"no-store" });
    if(res.ok){
      const rows = _csvReadObjects(await res.text());
      rows.forEach(r=>{
        const code = r.economy_code;
        const dash = r.dashboard_name;
        if(code) CSV_FIRST.econCodeToShort.set(code, r.short_name || code);
        if(code && dash) CSV_FIRST.econNameToCode.set(dash, code);
      });
    }
  }catch(_){}

  // indicators.csv
  try{
    const res = await fetch("data/indicators.csv", { cache:"no-store" });
    if(res.ok){
      const rows = _csvReadObjects(await res.text());
      rows.forEach(r=>{
        const id = r.indicator_id;
        if(!id) return;
        CSV_FIRST.indicatorById.set(id, {
          indicator_id: id,
          trend_series_id: r.trend_series_id || "",
          transform: r.transform || "",
          ref_period: r.ref_period || "",
          label: r.label || "",
          unit: r.unit || "",
          fmt: r.fmt || "",
          proj_indicator_id: r.proj_indicator_id || ""
        });
      });
    }
  }catch(_){}

  // projection_baseline.csv
  try{
    const res = await fetch("data/projection_baseline.csv", { cache:"no-store" });
    if(res.ok){
      const rows = _csvReadObjects(await res.text());
      rows.forEach(r=>{
        const pid = r.indicator_id;
        const code = r.economy_code;
        const v = Number(r.value);
        if(!pid || !code || !Number.isFinite(v)) return;
        if(!CSV_FIRST.projection.has(pid)) CSV_FIRST.projection.set(pid, new Map());
        CSV_FIRST.projection.get(pid).set(code, v);
      });
    }
  }catch(_){}

  // Preload trend master into the shared pilot cache so derived-latest fallback can be synchronous.
  try{
    await loadPilotTrends();
  }catch(_){ /* Trends view will show its own error if needed */ }

  CSV_FIRST.loaded = true;
}

if(IS_ADMIN){
  const saved = loadLS("apo_indicator_defs_v1", null);
  if(Array.isArray(saved) && saved.length) INDICATORS = saved;
}

/** -------- Indicator management -------- */
function getIndicator(id){ return INDICATORS.find(x=>x.id === id) || null; }

function economiesAll(){
  const s = new Set();
  DATA.forEach(r=>{ if(r && r.Economy) s.add(r.Economy); });
  return Array.from(s).sort((a,b)=>a.localeCompare(b));
}

function updateCounts(){
  const n = economiesAll().length;
  const el = $("#economyCount");
  if(el) el.textContent = n.toString();
  const src = $("#sourceLabel");
  if(src) src.textContent = SOURCE_LABEL;
}

/* Extend indicators (in memory) if new numeric columns exist */
function autoExtendIndicatorsFromData(){
  if(!DATA.length) return;
  const known = new Set(INDICATORS.map(x=>x.id));
  const cols = Object.keys(DATA[0] || {});
  const extra = [];
  cols.forEach(c=>{
    if(c === "Economy") return;
    if(known.has(c)) return;
    const anyNum = DATA.some(r => isNum(r[c]));
    if(!anyNum) return;
    extra.push({ id:c, label:c, unit:"", fmt:"0.0" });
  });
  if(extra.length){
    INDICATORS = INDICATORS.concat(extra);
    if(IS_ADMIN) saveLS("apo_indicator_defs_v1", INDICATORS);
  }
}

/** -------- Theme -------- */
function setTheme(theme){
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  saveLS("apo_theme", theme);
  $$("#themeSeg .segBtn").forEach(b=> b.classList.toggle("active", b.dataset.theme === theme));
}

/** -------- Navigation -------- */
function setActiveNav(view){
  $$(".navItem").forEach(b => b.classList.toggle("active", b.dataset.view === view));
}

function setCrumbs(view){
  const map = { summary:"Summary", indicators:"Indicators", trends:"Trends", profile:"Country profile", data:"Data" };
  const el = $("#crumbs");
  if(el) el.textContent = map[view] || "Summary";
}

function switchView(view){
  state.view = view;
  setActiveNav(view);
  setCrumbs(view);

  $$(".view").forEach(v => v.classList.add("hidden"));
  const target = $("#view-" + view);
  if(target) target.classList.remove("hidden");

  renderAll();
}

/** -------- Sidebar menu (hierarchy) -------- */
function renderMenuTree(){
  const wrap = $("#indicatorList");
  if(!wrap) return;

  // If MENU_TREE is missing, fall back to flat indicators (legacy).
  if(!Array.isArray(MENU_TREE) || !MENU_TREE.length){
    wrap.innerHTML = "";
    INDICATORS.forEach(ind=>{
      const b = document.createElement("button");
      b.className = "indBtn" + (state.indicatorId === ind.id ? " active" : "");
      b.textContent = ind.label;
      b.addEventListener("click", ()=>{
        state.indicatorId = ind.id;
        if(state.view !== "indicators") switchView("indicators");
        else renderIndicators();
      });
      wrap.appendChild(b);
    });
    return;
  }

  // Default open state (only on first load) — so "Collapse all" really collapses.
  if(!_menuInitDone && !_menuOpenGroups.size && MENU_TREE[0] && MENU_TREE[0].id){
    _menuOpenGroups.add(MENU_TREE[0].id);
  }

  const q = (_menuQuery || "").trim().toLowerCase();

  function textMatch(a){
    if(!q) return true;
    return String(a||"").toLowerCase().includes(q);
  }

  function modeKey(modeLabel){
    const s = String(modeLabel||"").toLowerCase();
    if(s.includes("nowcast")) return "nowcast";
    if(s.includes("latest")) return "latest";
    if(s.includes("trend")) return "trend";
    if(s.includes("projection")) return "projection";
    return "latest";
  }

  function closeSidebarIfMobile(){
    const appEl = document.querySelector(".app");
    if(!appEl) return;
    if(window.matchMedia && window.matchMedia("(max-width: 980px)").matches){
      appEl.classList.remove("sidebarOpen");
    }
  }

  function goLatest(ind){
    if(!ind) return;
    state.indicatorId = ind.id;
    state.mode = "data";
    closeSidebarIfMobile();
    switchView("indicators");
  }

  function goProjection(ind){
    if(!ind) return;
    state.indicatorId = ind.id;
    state.mode = "projection";
    closeSidebarIfMobile();
    switchView("indicators");
  }

  function goTrend(menuIndName){
    const code = resolveTsCodeForMenu(menuIndName);
    if(!code){
      showToast("Trend view is not mapped for this indicator yet (Coming soon).");
      return;
    }
    state.tsIndicator = code;
    state.tsLocked = true; // indicator already chosen from menu
    closeSidebarIfMobile();
    switchView("trends");
  }

  wrap.innerHTML = "";
  MENU_TREE.forEach(group=>{
    // Filter indicators by query
    const visibleIndicators = (group.indicators || []).filter(mi=>{
      if(!q) return true;
      const resolved = resolveIndicatorForMenu(mi.name);
      const label = resolved.ind ? resolved.ind.label : mi.name;
      return textMatch(group.name) || textMatch(mi.name) || textMatch(label);
    });
    if(q && !visibleIndicators.length) return;

    const groupOpen = q ? true : _menuOpenGroups.has(group.id);

    const gEl = document.createElement("div");
    gEl.className = "menuGroup";

    const gBtn = document.createElement("button");
    gBtn.className = "menuGroupBtn";
    gBtn.innerHTML = `
      <span>${escapeHtml(group.name)}</span>
      <span class="chev">${groupOpen ? "▾" : "▸"}</span>
    `;
    gBtn.addEventListener("click", ()=>{
      if(_menuOpenGroups.has(group.id)) _menuOpenGroups.delete(group.id);
      else _menuOpenGroups.add(group.id);
      saveMenuOpenState();
      renderMenuTree();
    });

    gEl.appendChild(gBtn);

    const items = document.createElement("div");
    items.className = "menuItems";
    items.style.display = groupOpen ? "block" : "none";

    visibleIndicators.forEach(mi=>{
      const resolved = resolveIndicatorForMenu(mi.name);
      const ind = resolved.ind;
      const ref = ind ? (inferRefPeriodFromLabel(ind.label) || "2023") : "YYYY";
      const hasLatest = !!ind;
      const hasProj = !!(ind && ind.proj && DATA.some(r=>r && isNum(r[ind.proj])));
      const hasTrend = !!resolveTsCodeForMenu(mi.name);

      const indKey = `${group.id}||${mi.id}`;
      const open = q ? true : _menuOpenIndicators.has(indKey);

      const card = document.createElement("div");
      card.className = "menuInd";

      const header = document.createElement("div");
      header.className = "menuIndHeader";

      const btn = document.createElement("button");
      btn.className = "menuIndBtn" + (ind && state.indicatorId === ind.id ? " active" : "");
      btn.innerHTML = `
        <span class="menuIndLabel">${escapeHtml(cleanIndicatorTitle(mi.name || (ind ? ind.label : "")))}</span>
        <span class="chev">${open ? "▾" : "▸"}</span>
      `;
      btn.addEventListener("click", ()=>{
        if(_menuOpenIndicators.has(indKey)) _menuOpenIndicators.delete(indKey);
        else _menuOpenIndicators.add(indKey);
        saveMenuOpenState();
        renderMenuTree();
      });

      const badge = document.createElement("span");
      badge.className = "menuBadge " + (ind ? "ok" : "soon");
      badge.textContent = ind ? "Available" : "Coming soon";

      header.appendChild(btn);
      header.appendChild(badge);
      card.appendChild(header);

      const modes = document.createElement("div");
      modes.className = "menuModes";
      modes.style.display = open ? "block" : "none";

      (mi.modes || []).forEach(m=>{
        const k = modeKey(m);
        let label = m;
        let disabled = false;
        let active = false;

        if(k === "latest"){
          label = `Latest available (official): ${ref}`;
          disabled = !hasLatest;
          active = !!(ind && state.view === "indicators" && state.indicatorId === ind.id && state.mode === "data");
        }else if(k === "projection"){
          label = "Projection";
          disabled = !hasProj;
          active = !!(ind && state.view === "indicators" && state.indicatorId === ind.id && state.mode === "projection");
        }else if(k === "trend"){
          label = "Trend & Compare";
          disabled = !hasTrend;
          active = (state.view === "trends" && resolveTsCodeForMenu(mi.name) === state.tsIndicator);
        }else if(k === "nowcast"){
          label = "Nowcast (estimate)";
          disabled = true; // UI placeholder only
        }

        const b = document.createElement("button");
        b.className = "modeBtn" + (active ? " active" : "");
        b.innerHTML = `<span class="modeDot" aria-hidden="true"></span><span class="modeText">${escapeHtml(label)}</span>`;
        if(disabled) b.disabled = true;
        b.addEventListener("click", ()=>{
          if(disabled){
            showToast("This view is coming soon.");
            return;
          }
          if(k === "latest") goLatest(ind);
          else if(k === "projection") goProjection(ind);
          else if(k === "trend") goTrend(mi.name);
          else showToast("This view is coming soon.");
        });
        modes.appendChild(b);
      });

      card.appendChild(modes);
      items.appendChild(card);
    });

    gEl.appendChild(items);
    wrap.appendChild(gEl);
  });

  _menuInitDone = true;
}

/** -------- Summary -------- */
function sumIndicator(id){
  let s = 0;
  DATA.forEach(r=>{
    const v = r ? r[id] : null;
    if(isNum(v)) s += v;
  });
  return s;
}
function avgIndicator(id){
  let s=0, n=0;
  DATA.forEach(r=>{
    const v = r ? r[id] : null;
    if(isNum(v)){ s += v; n += 1; }
  });
  return n ? (s/n) : null;
}

function medianIndicator(id){
  const vals = [];
  DATA.forEach(r=>{
    const v = r ? r[id] : null;
    if(isNum(v)) vals.push(v);
  });
  if(!vals.length) return null;
  vals.sort((a,b)=>a-b);
  const mid = Math.floor(vals.length / 2);
  if(vals.length % 2) return vals[mid];
  return (vals[mid-1] + vals[mid]) / 2;
}

function minMaxIndicator(id){
  let min = null, max = null;
  DATA.forEach(r=>{
    const v = r ? r[id] : null;
    if(!isNum(v)) return;
    if(min === null || v < min) min = v;
    if(max === null || v > max) max = v;
  });
  return { min, max };
}

function argmaxEconomy(id){
  let best = null;
  DATA.forEach(r=>{
    const v = r ? r[id] : null;
    if(!isNum(v) || !r.Economy) return;
    if(!best || v > best.v) best = { name: r.Economy, v };
  });
  return best;
}

function argminEconomy(id){
  let best = null;
  DATA.forEach(r=>{
    const v = r ? r[id] : null;
    if(!isNum(v) || !r.Economy) return;
    if(!best || v < best.v) best = { name: r.Economy, v };
  });
  return best;
}

function renderSummary(){
  const root = $("#view-summary");
  if(!root) return;

  const gdp = sumIndicator("GDP_PPP_2023_bn");
  const gdpGrowth = avgIndicator("GDP_growth_2223_pct");
  const tfp = avgIndicator("TFP_growth_2223_pct");

  // ---- Summary helpers (no hard-coded values; everything computed from DATA columns) ----
  function findIndicatorDefAny(id){
    for(let i=0;i<INDICATORS.length;i++){
      const d = INDICATORS[i];
      if(!d) continue;
      if(d.id === id) return d;
      if(d.proj === id) return d;
    }
    return null;
  }
  function decimalsFromFmt(fmt){
    if(typeof fmt !== "string") return 1;
    const m = fmt.match(/\.(0+)/);
    return m ? m[1].length : 0;
  }
  function sortedNumeric(id){
    return DATA
      .map(r=>({ name: r && r.Economy, v: r ? r[id] : null }))
      .filter(x=>x.name && isNum(x.v));
  }
  function hasNumeric(id){
    return DATA.some(r=>r && isNum(r[id]));
  }
  function unitShort(id){
    if(/_pct$/.test(id) || id.includes("_pct")) return "%";
    if(id === "LP_level_per_worker_2023_kUSD") return "kUSD/worker";
    if(id === "GDPpc_PPP_2023_kUSD") return "kUSD";
    if(id === "GDP_PPP_2023_bn") return "";
    return "";
  }
  function formatIndicatorValue(id, v, opts){
    opts = opts || {};
    if(!isNum(v)) return "–";
    const def = findIndicatorDefAny(id);
    const dec = def ? decimalsFromFmt(def.fmt) : 1;
    let s = fmtNumber(v, dec);
    const u = unitShort(id);
    if(opts.includeUnit !== false){
      if(u === "%") s += "%";
      else if(u) s += ` ${u}`;
    }
    return s;
  }
  function labelForId(id){
    const def = findIndicatorDefAny(id);
    if(!def) return id;
    // If this is a projection column, adapt the base label (usually 2022–23) to 2025–30.
    if(def.proj === id){
      let lab = def.label || id;
      lab = lab
        .replace(/2022–23/g, "2025–30")
        .replace(/2022-23/g, "2025–30")
        .replace(/\(2022–23\)/g, "(2025–30)")
        .replace(/\(2022-23\)/g, "(2025–30)");
      if(!/2025/.test(lab)) lab += " (2025–30)";
      if(!/Projection/i.test(lab)) lab += " (Projection)";
      return lab;
    }
    return def.label || id;
  }

  function leaderboard(id){
    const rows = sortedNumeric(id);
    const n = rows.length;
    if(!n) return { top:[], bottom:[], min:null, max:null, n:0 };
    let min = rows[0].v, max = rows[0].v;
    rows.forEach(x=>{ if(x.v < min) min = x.v; if(x.v > max) max = x.v; });
    const desc = rows.slice().sort((a,b)=>b.v-a.v);
    const asc  = rows.slice().sort((a,b)=>a.v-b.v);
    const k = Math.min(5, n);
    return { top: desc.slice(0,k), bottom: asc.slice(0,k), min, max, n };
  }
  function barWidth(v, min, max){
    if(!isNum(v) || !isNum(min) || !isNum(max) || max === min) return 100;
    const t = (v - min) / (max - min);
    const pct = 12 + (t * 88);
    return Math.max(12, Math.min(100, Math.round(pct)));
  }
  function rankItemsHtml(items, id, min, max){
    const def = findIndicatorDefAny(id);
    const dec = def ? decimalsFromFmt(def.fmt) : 1;
    if(!items || !items.length) return `<div class="rankEmpty">—</div>`;
    return items.map((it, i)=>{
      const w = barWidth(it.v, min, max);
      return `
        <div class="rankItem" data-economy="${escapeHtml(it.name)}">
          <div class="rankNum">${i+1}</div>
          <div class="rankName" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>
          <div class="rankVal mono">${fmtNumber(it.v, dec)}</div>
          <div class="rankBarWrap" aria-hidden="true"><div class="rankBar" style="width:${w}%"></div></div>
        </div>
      `;
    }).join("");
  }
  function rankCardHtml(id, opts){
    opts = opts || {};
    const def = findIndicatorDefAny(id) || { label: id, unit: "" };
    const title = opts.title || def.label || id;

    const lb = leaderboard(id);
    const metaBits = [];
    if(def.unit) metaBits.push(def.unit);
    if(opts.meta) metaBits.push(opts.meta);
    metaBits.push(`n=${lb.n}`);

    return `
      <div class="rankCard">
        <div class="rankHeader">
          <div class="rankTitle">${escapeHtml(title)}</div>
          <div class="rankMeta">${escapeHtml(metaBits.join(" · "))}</div>
        </div>
        <div class="rankCols">
          <div class="rankCol">
            <div class="rankColTitle">Top 5</div>
            ${rankItemsHtml(lb.top, id, lb.min, lb.max)}
          </div>
          <div class="rankCol">
            <div class="rankColTitle">Bottom 5</div>
            ${rankItemsHtml(lb.bottom, id, lb.min, lb.max)}
          </div>
        </div>
      </div>
    `;
  }

  function goProfile(economy){
    if(!economy) return;
    state.country = economy;
    switchView("profile");
  }

  // ---- Signals / Executive summary ----
  const sigLargestGdp = argmaxEconomy("GDP_PPP_2023_bn");
  const sigHighestLp = argmaxEconomy("LP_level_per_worker_2023_kUSD");
  const sigHighestTfp = argmaxEconomy("TFP_growth_2223_pct");
  const sigFastGdpProj = argmaxEconomy("GDP_growth_proj_2530_pct");
  const sigTfpMomentumProj = argmaxEconomy("TFP_growth_proj_2530_pct");

  // ---- Aggregates ----
  const avgLp = avgIndicator("LP_level_per_worker_2023_kUSD");
  const medLp = medianIndicator("LP_level_per_worker_2023_kUSD");
  const avgGdpProj = avgIndicator("GDP_growth_proj_2530_pct");
  const avgTfpProj = avgIndicator("TFP_growth_proj_2530_pct");
  const gdpRows = sortedNumeric("GDP_PPP_2023_bn").sort((a,b)=>b.v-a.v);
  const totalGdp = gdpRows.reduce((s,x)=>s+x.v,0);
  const top5Share = (gdpRows.length && totalGdp) ? (gdpRows.slice(0,5).reduce((s,x)=>s+x.v,0) / totalGdp) : null;

  // ---- Economy lists + state defaults (Summary-only UI state) ----
  const economies = economiesAll();
  if(!state.summarySegIndicatorId) state.summarySegIndicatorId = "GDP_growth_proj_2530_pct";
  if(!state.summaryCompareIndicatorId) state.summaryCompareIndicatorId = "GDP_PPP_2023_bn";
  if(!state.summaryCompareA) state.summaryCompareA = economies[0] || "";
  if(!state.summaryCompareB) state.summaryCompareB = economies[1] || economies[0] || "";

  // ---- Portfolio segmentation (median split) ----
  function medianOf(values){
    const a = values.filter(isNum).slice().sort((x,y)=>x-y);
    const n = a.length;
    if(!n) return null;
    const mid = Math.floor(n/2);
    return (n % 2) ? a[mid] : (a[mid-1] + a[mid]) / 2;
  }
  function unique(arr){
    return Array.from(new Set(arr));
  }
  const segCandidateIds = unique([
    "GDP_growth_proj_2530_pct",
    "LP_growth_proj_2530_pct",
    "TFP_growth_proj_2530_pct",
    "GDP_growth_2223_pct",
    "LP_growth_2223_pct",
    "TFP_growth_2223_pct",
    "Capital_prod_growth_proj_2530_pct",
    "Capital_prod_growth_2223_pct",
  ].filter(id=>hasNumeric(id)));

  if(!segCandidateIds.includes(state.summarySegIndicatorId)){
    state.summarySegIndicatorId = segCandidateIds[0] || state.summarySegIndicatorId;
  }

  const segXId = "LP_level_per_worker_2023_kUSD";
  const segYId = state.summarySegIndicatorId;
  const segRows = DATA
    .map(r=>({ name:r && r.Economy, x:r? r[segXId] : null, y:r? r[segYId] : null }))
    .filter(p=>p.name && isNum(p.x) && isNum(p.y));

  const segXMed = medianOf(segRows.map(p=>p.x));
  const segYMed = medianOf(segRows.map(p=>p.y));

  const segBuckets = {
    hh: [], // High LP / High growth
    lh: [], // Low LP / High growth
    hl: [], // High LP / Low growth
    ll: []  // Low LP / Low growth
  };
  if(isNum(segXMed) && isNum(segYMed)){
    segRows.forEach(p=>{
      const highX = p.x >= segXMed;
      const highY = p.y >= segYMed;
      if(highX && highY) segBuckets.hh.push(p.name);
      else if(!highX && highY) segBuckets.lh.push(p.name);
      else if(highX && !highY) segBuckets.hl.push(p.name);
      else segBuckets.ll.push(p.name);
    });
    // Keep deterministic ordering
    Object.keys(segBuckets).forEach(k=>segBuckets[k].sort((a,b)=>a.localeCompare(b)));
  }

  function segChipList(names){
    if(!names || !names.length) return `<div class="rankEmpty">—</div>`;
    return `<div class="portSegChips">${names.map(n=>`<button class="segChip" data-economy="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join("")}</div>`;
  }

  // Tooltip text (SG-ready): step-by-step + concrete examples using current X/Y and medians
  function segFind(name){
    return segRows.find(p=>p.name === name) || null;
  }
  function segLabelFor(highX, highY){
    if(highX && highY) return "Leaders with momentum";
    if(!highX && highY) return "Catch-up candidates";
    if(highX && !highY) return "Mature slow-growers";
    return "Structural challenge";
  }
  function segExampleBlock(econName){
    if(!isNum(segXMed) || !isNum(segYMed)) return "";
    const p = segFind(econName);
    if(!p || !isNum(p.x) || !isNum(p.y)) return "";
    const highX = p.x >= segXMed;
    const highY = p.y >= segYMed;
    const label = segLabelFor(highX, highY);
    return [
      `Example: Why ${econName} is in ${label}`,
      `X = ${labelForId(segXId)} = ${formatIndicatorValue(segXId, p.x)}; median X = ${formatIndicatorValue(segXId, segXMed)} → ${highX ? "High LP" : "Low LP"}`,
      `Y = ${labelForId(segYId)} = ${formatIndicatorValue(segYId, p.y)}; median Y = ${formatIndicatorValue(segYId, segYMed)} → ${highY ? "High growth" : "Low growth"}`,
      `Result: ${highX ? "High LP" : "Low LP"} + ${highY ? "High growth" : "Low growth"} → ${label}`
    ].join("\n");
  }

  const segTooltipText = [
    "How it works (Portfolio segmentation)",
    `X (productivity level) = ${labelForId(segXId)}`,
    `Y (growth indicator) = ${labelForId(segYId)}`,
    "We compute the median (middle) X and Y across economies with data.",
    "High = above median. Low = below median.",
    "",
    "Labels mean:",
    "Leaders with momentum = High X AND High Y",
    "Catch-up candidates = Low X BUT High Y",
    "Mature slow-growers = High X BUT Low Y",
    "Structural challenge = Low X AND Low Y",
    "",
    segExampleBlock("Malaysia"),
    "",
    segExampleBlock("Mongolia"),
    "",
    "SG-ready: This is descriptive grouping based on median splits (not causal)."
  ].filter(Boolean).join("\n");

  const portSegHtml = (segRows.length && isNum(segXMed) && isNum(segYMed) && segCandidateIds.length) ? `
    <div class="card" id="portfolioSegCard">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">Portfolio segmentation <span title="${escapeHtml(segTooltipText)}" style="margin-left:8px; opacity:.8; cursor:help; font-size:14px;">ⓘ</span></div>
          <div class="cardSub">Segments are defined by the median LP level (x) and median indicator value (y). This is descriptive (not causal).</div>
          <div class="cardSub" style="margin-top:6px;">X median (${escapeHtml(labelForId(segXId))}): <span class="mono">${formatIndicatorValue(segXId, segXMed)}</span> · Y median (${escapeHtml(labelForId(segYId))}): <span class="mono">${formatIndicatorValue(segYId, segYMed)}</span> · n=${segRows.length}</div>
        </div>
        <div class="controls">
          <div class="chipK" style="margin-top:2px;">Segment by:</div>
          <select class="select" id="segBySelect" aria-label="Segment by indicator">
            ${segCandidateIds.map(id=>`<option value="${escapeHtml(id)}" ${id===segYId?"selected":""}>${escapeHtml(labelForId(id))}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="portSegGrid">
        <div class="portSegBox">
          <div class="portSegTitle">High LP / High growth</div>
          <div class="portSegSub">Leaders with momentum</div>
          ${segChipList(segBuckets.hh)}
        </div>
        <div class="portSegBox">
          <div class="portSegTitle">Low LP / High growth</div>
          <div class="portSegSub">Catch-up candidates</div>
          ${segChipList(segBuckets.lh)}
        </div>
        <div class="portSegBox">
          <div class="portSegTitle">High LP / Low growth</div>
          <div class="portSegSub">Mature slow-growers</div>
          ${segChipList(segBuckets.hl)}
        </div>
        <div class="portSegBox">
          <div class="portSegTitle">Low LP / Low growth</div>
          <div class="portSegSub">Structural challenge</div>
          ${segChipList(segBuckets.ll)}
        </div>
      </div>
    </div>
  ` : "";

  // ---- Frontier comparator (economy vs economy) ----
  const cmpIndicatorIds = unique([
    "GDP_PPP_2023_bn",
    "GDPpc_PPP_2023_kUSD",
    "LP_level_per_worker_2023_kUSD",
    "GDP_growth_2223_pct",
    "LP_growth_2223_pct",
    "TFP_growth_2223_pct",
    "GDP_growth_proj_2530_pct",
    "LP_growth_proj_2530_pct",
    "TFP_growth_proj_2530_pct",
    "Capital_prod_growth_2223_pct",
    "Capital_prod_growth_proj_2530_pct",
  ].filter(id=>hasNumeric(id)));

  if(!cmpIndicatorIds.includes(state.summaryCompareIndicatorId)){
    state.summaryCompareIndicatorId = cmpIndicatorIds[0] || state.summaryCompareIndicatorId;
  }
  if(state.summaryCompareA && !economies.includes(state.summaryCompareA)) state.summaryCompareA = economies[0] || "";
  if(state.summaryCompareB && !economies.includes(state.summaryCompareB)) state.summaryCompareB = economies[1] || economies[0] || "";

  const comparatorHtml = (cmpIndicatorIds.length && economies.length) ? `
    <div class="card" id="frontierComparatorCard">
      <div class="cardHeader">
        <div>
	<div class="cardTitle">Frontier comparator <span title="What this does:
	Choose an indicator and two economies.
	Where numbers come from:
	We read the selected indicator value for Economy A and Economy B directly from data.
	How ranks are calculated:
	We take all economies that have a valid value for the selected indicator, sort them from highest to lowest, then assign ranks (Rank 1 = highest value).
	How the comparison numbers are calculated:
	- Ratio (A/B) = valueA ÷ valueB (if valueB is 0 or missing, ratio is not shown).
	- Difference (A − B) = valueA − valueB.
	- Rank delta = rankB − rankA (positive means Economy A ranks higher/better than Economy B)." style="margin-left:8px; opacity:.8; cursor:help; font-size:14px;">ⓘ</span></div>
        
          <div class="cardSub">Choose an indicator and compare any two economies (values + ratio + difference + ranks).</div>
        </div>
      </div>

      <div class="fcForm">
        <div>
          <div class="fcFieldLabel">Indicator</div>
          <select class="select" id="fcIndicatorSelect" aria-label="Comparator indicator">
            ${cmpIndicatorIds.map(id=>`<option value="${escapeHtml(id)}" ${id===state.summaryCompareIndicatorId?"selected":""}>${escapeHtml(labelForId(id))}</option>`).join("")}
          </select>
        </div>
        <div>
          <div class="fcFieldLabel">Economy A</div>
          <select class="select" id="fcEconomyA" aria-label="Select economy A">
            ${economies.map(e=>`<option value="${escapeHtml(e)}" ${e===state.summaryCompareA?"selected":""}>${escapeHtml(e)}</option>`).join("")}
          </select>
        </div>
        <div>
          <div class="fcFieldLabel">Economy B</div>
          <select class="select" id="fcEconomyB" aria-label="Select economy B">
            ${economies.map(e=>`<option value="${escapeHtml(e)}" ${e===state.summaryCompareB?"selected":""}>${escapeHtml(e)}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="fcCompare">
        <div class="fcPanel">
          <div class="fcPanelTitle">Economy A</div>
          <button class="textLink fcName" id="fcAName" data-economy="${escapeHtml(state.summaryCompareA)}">${escapeHtml(state.summaryCompareA || "–")}</button>
          <div class="fcValue mono" id="fcAValue">—</div>
          <div class="fcRank" id="fcARank">—</div>
        </div>
        <div class="fcPanel">
          <div class="fcPanelTitle">Economy B</div>
          <button class="textLink fcName" id="fcBName" data-economy="${escapeHtml(state.summaryCompareB)}">${escapeHtml(state.summaryCompareB || "–")}</button>
          <div class="fcValue mono" id="fcBValue">—</div>
          <div class="fcRank" id="fcBRank">—</div>
        </div>
      </div>

      <div class="fcMetrics">
        <div class="fcMetric">
          <div class="fcMetricK">Ratio (A / B)</div>
          <div class="fcMetricV mono" id="fcRatio">—</div>
        </div>
        <div class="fcMetric">
          <div class="fcMetricK">Difference (A − B)</div>
          <div class="fcMetricV mono" id="fcDiff">—</div>
        </div>
        <div class="fcMetric">
          <div class="fcMetricK">Rank delta</div>
          <div class="fcMetricV mono" id="fcRankDelta">—</div>
          <div class="fcMetricS" id="fcRankNote">Higher value = better rank</div>
        </div>
      </div>
    </div>
  ` : "";

  // ---- Concentration risk ----
  function avgIndicatorExcluding(id, excludeName){
    const rows = DATA.filter(r=>r && r.Economy !== excludeName && isNum(r[id]));
    if(!rows.length) return null;
    return rows.reduce((s,r)=>s+r[id],0) / rows.length;
  }

  let concHtml = "";
  if(gdpRows.length && totalGdp){
    const top3 = gdpRows.slice(0,3).reduce((s,x)=>s+x.v,0) / totalGdp;
    const top5 = gdpRows.slice(0,5).reduce((s,x)=>s+x.v,0) / totalGdp;
    const top10 = gdpRows.slice(0,10).reduce((s,x)=>s+x.v,0) / totalGdp;
    const shares = gdpRows.map(x=>x.v/totalGdp);
    const hhi = shares.reduce((s,p)=>s+(p*p),0);

    const largestName = sigLargestGdp && sigLargestGdp.name ? sigLargestGdp.name : null;
    const lpAll = avgIndicator("LP_level_per_worker_2023_kUSD");
    const lpEx = largestName ? avgIndicatorExcluding("LP_level_per_worker_2023_kUSD", largestName) : null;

    concHtml = `
      <div class="card" id="concentrationRiskCard">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">Concentration risk <span title="What this shows:
		Whether total GDP is dominated by a few large economies.
		How we calculate (from data):
		1) Use GDP (PPP) 2023: GDP_PPP_2023_bn.
		2) Total GDP = sum of GDP_PPP_2023_bn across economies with data.
		3) GDP share for an economy = GDP_i ÷ Total GDP.
		4) Top-3 / Top-5 / Top-10 share = sum of the largest 3/5/10 shares.
		  Example: Top-3 share = (GDP1 + GDP2 + GDP3) ÷ Total GDP.
		5) HHI (Herfindahl–Hirschman Index) (0–1) = sum of (share^2). Higher = more concentrated.
		Higher HHI = GDP is more dominated by a few economies (more concentration). Lower HHI = GDP is more spread out across many economies (less concentration).
		If 4 economies each have 25% share:
		HHI = 0.25² + 0.25² + 0.25² + 0.25²
		= 4 × 0.0625
		= 0.25
		If 1 economy has 70% and 3 share 10% each:
		I = 0.70² + 0.10² + 0.10² + 0.10²
		0.49 + 0.01 + 0.01 + 0.01
		0.52 (more concentrated)
		6) Sensitivity (Avg LP level) uses LP_level_per_worker_2023_kUSD: ompare average LP level with all economies vs excluding the largest-GDP economy." style="margin-left:8px; opacity:.8; cursor:help; font-				:14px;">ⓘ</span></div> <div class="cardSub">How concentrated the APO portfolio is (based on GDP in 2023, PPP).</div>
          </div>
        </div>
        <div class="riskGrid">
          <div class="riskTile">
            <div class="riskK">Top-3 GDP share</div>
            <div class="riskV">${isNum(top3)?fmtNumber(top3*100,1)+"%":"–"}</div>
          </div>
          <div class="riskTile">
            <div class="riskK">Top-5 GDP share</div>
            <div class="riskV">${isNum(top5)?fmtNumber(top5*100,1)+"%":"–"}</div>
          </div>
          <div class="riskTile">
            <div class="riskK">Top-10 GDP share</div>
            <div class="riskV">${isNum(top10)?fmtNumber(top10*100,1)+"%":"–"}</div>
          </div>
          <div class="riskTile">
            <div class="riskK">HHI (0–1)</div>
            <div class="riskV">${isNum(hhi)?fmtNumber(hhi,3):"–"}</div>
            <div class="riskS">Higher = more concentrated</div>
          </div>
          <div class="riskTile">
            <div class="riskK">Sensitivity (Avg LP level)</div>
            <div class="riskV">${(isNum(lpAll) && isNum(lpEx)) ? `${fmtNumber(lpAll,1)} → ${fmtNumber(lpEx,1)}` : "–"}</div>
            <div class="riskS">Excluding largest economy</div>
          </div>
        </div>
        <div class="cardSub" style="margin-top:10px;">Validation: Shares and HHI use <span class="mono">GDP_PPP_2023_bn</span>. Sensitivity uses <span class="mono">LP_level_per_worker_2023_kUSD</span> average with/without the largest-GDP economy.</div>
      </div>
    `;
  }

  // ---- Gap to frontier (LP level) ----
  const frontier = sigHighestLp;
  const bottom = argminEconomy("LP_level_per_worker_2023_kUSD");
  const defaultCompare = (bottom && bottom.name) ? bottom.name : (economies[0] || "");

  // ---- Quadrant snapshot (default axes) ----
  const QUAD_X_DEFAULT = "GDPpc_PPP_2023_kUSD";
  const QUAD_Y_DEFAULT = "LP_level_per_worker_2023_kUSD";
  const quadX = QUAD_X_DEFAULT;
  const quadY = QUAD_Y_DEFAULT;
  const quadXDef = findIndicatorDefAny(quadX);
  const quadYDef = findIndicatorDefAny(quadY);
  const quadXMM = minMaxIndicator(quadX);
  const quadYMM = minMaxIndicator(quadY);

  // ---- Distributions (bin counts) ----
  function binCounts(id, bins){
    // bins: [{label, test(v)}]
    const rows = sortedNumeric(id);
    const counts = bins.map(_=>0);
    rows.forEach(({v})=>{
      for(let i=0;i<bins.length;i++){
        if(bins[i].test(v)){ counts[i] += 1; return; }
      }
    });
    return { n: rows.length, counts };
  }
  const growthBins = [
    { label:"< 0%", test:(v)=>v < 0 },
    { label:"0–2%", test:(v)=>v >= 0 && v < 2 },
    { label:"2–4%", test:(v)=>v >= 2 && v < 4 },
    { label:"4–6%", test:(v)=>v >= 4 && v < 6 },
    { label:"≥ 6%", test:(v)=>v >= 6 },
  ];
  const distGdp = binCounts("GDP_growth_2223_pct", growthBins);
  const distLp  = binCounts("LP_growth_2223_pct", growthBins);
  const distTfp = binCounts("TFP_growth_2223_pct", growthBins);

  function distBarsHtml(dist){
    const maxC = Math.max(1, ...dist.counts);
    return growthBins.map((b, i)=>{
      const c = dist.counts[i];
      const pct = dist.n ? (c / dist.n) : 0;
      const w = Math.round((c / maxC) * 100);
      return `
        <div class="distRow">
          <div class="distLabel">${b.label}</div>
          <div class="distBar"><div class="distFill" style="width:${w}%"></div></div>
          <div class="distVal mono">${c}${dist.n ? ` (${Math.round(pct*100)}%)` : ""}</div>
        </div>
      `;
    }).join("");
  }

  // ---- Rankings snapshot cards ----
  const rankCards = [
    { id:"GDP_PPP_2023_bn" },
    { id:"GDPpc_PPP_2023_kUSD" },
    { id:"Population_2022_m" },
    { id:"LP_level_per_worker_2023_kUSD" },
    { id:"GDP_growth_2223_pct" },
    { id:"LP_growth_2223_pct" },
    { id:"TFP_growth_2223_pct" },
    { id:"GDP_growth_proj_2530_pct", title:"GDP growth (%, 2025–30) (Projection)", meta:"2025–30" },
    { id:"LP_growth_proj_2530_pct", title:"Per-worker labor productivity growth (%, 2025–30) (Projection)", meta:"2025–30" },
    { id:"TFP_growth_proj_2530_pct", title:"TFP growth (%, 2025–30) (Projection)", meta:"2025–30" },
  ];
  const rankHtml = rankCards.map(c=>rankCardHtml(c.id, c)).join("");

  // ---- Quadrant scatter (SVG) ----
  function scale(v, min, max){
    if(!isNum(v) || !isNum(min) || !isNum(max) || max === min) return 0.5;
    return (v - min) / (max - min);
  }
  const pts = DATA
    .map(r=>({
      name: r && r.Economy,
      x: r ? r[quadX] : null,
      y: r ? r[quadY] : null,
      s: r ? r.GDP_PPP_2023_bn : null
    }))
    .filter(p=>p.name && isNum(p.x) && isNum(p.y));

  const sizeMM = minMaxIndicator("GDP_PPP_2023_bn");
  function rFromSize(v){
    if(!isNum(v) || !isNum(sizeMM.min) || !isNum(sizeMM.max) || sizeMM.max === sizeMM.min) return 4;
    const t = (v - sizeMM.min) / (sizeMM.max - sizeMM.min);
    return 3 + (t * 7);
  }

  const svgW = 640, svgH = 360;
  const pad = 28;
  const axis = {
    x0: pad, y0: svgH - pad,
    x1: svgW - pad, y1: pad
  };
  const midX = (axis.x0 + axis.x1)/2;
  const midY = (axis.y0 + axis.y1)/2;

  const dots = pts.map((p, i)=>{
    const tx = scale(p.x, quadXMM.min, quadXMM.max);
    const ty = scale(p.y, quadYMM.min, quadYMM.max);
    const cx = axis.x0 + tx * (axis.x1 - axis.x0);
    const cy = axis.y0 - ty * (axis.y0 - axis.y1);
    const rr = rFromSize(p.s);
    return `<circle class="qDot" data-economy="${escapeHtml(p.name)}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rr.toFixed(1)}">
      <title>${escapeHtml(p.name)}
${(quadXDef?.label||quadX)}: ${fmtNumber(p.x)}
${(quadYDef?.label||quadY)}: ${fmtNumber(p.y)}
GDP: ${isNum(p.s)?fmtNumber(p.s):"–"}</title>
    </circle>`;
  }).join("");

  const quadrantSvg = `
    <svg class="quadSvg" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="Quadrant snapshot scatter">
      <line class="qAxis" x1="${axis.x0}" y1="${axis.y0}" x2="${axis.x1}" y2="${axis.y0}" />
      <line class="qAxis" x1="${axis.x0}" y1="${axis.y0}" x2="${axis.x0}" y2="${axis.y1}" />
      <line class="qMid" x1="${midX}" y1="${axis.y0}" x2="${midX}" y2="${axis.y1}" />
      <line class="qMid" x1="${axis.x0}" y1="${midY}" x2="${axis.x1}" y2="${midY}" />
      <text class="qLabel" x="${axis.x0}" y="${axis.y1-10}">${escapeHtml(quadYDef?.label || quadY)}</text>
      <text class="qLabel" x="${axis.x1}" y="${axis.y0+18}" text-anchor="end">${escapeHtml(quadXDef?.label || quadX)}</text>
      ${dots}
    </svg>
  `;

  // ---- Executive summary lines (skip missing) ----
  function execLine(label, id, obj, includeUnit){
    if(!obj || !obj.name || !isNum(obj.v)) return "";
    const val = formatIndicatorValue(id, obj.v, { includeUnit });
    return `
      <div class="execLine">
        <span class="execK">${escapeHtml(label)}:</span>
        <button class="textLink execLink" data-economy="${escapeHtml(obj.name)}">${escapeHtml(obj.name)}</button>
        <span class="execV mono">(${val})</span>
      </div>
    `;
  }
  const execLines = [
    execLine("Largest economy (GDP, 2023 PPP)", "GDP_PPP_2023_bn", sigLargestGdp, false),
    execLine("Highest labor productivity (per worker, 2023)", "LP_level_per_worker_2023_kUSD", sigHighestLp, true),
    execLine("Highest TFP growth (2022–23)", "TFP_growth_2223_pct", sigHighestTfp, true),
    execLine("Fastest projected GDP growth (2025–30)", "GDP_growth_proj_2530_pct", sigFastGdpProj, true),
    execLine("Fastest projected TFP growth (2025–30)", "TFP_growth_proj_2530_pct", sigTfpMomentumProj, true),
  ].filter(Boolean).join("");

  const execSummaryHtml = execLines ? `
    <div class="card" id="execSummaryCard">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">Executive summary</div>
          <div class="cardSub">Auto-generated highlights from <span class="mono">data.js</span>. Click any economy name below to open its profile.</div>
        </div>
      </div>
      <div class="execList">${execLines}</div>
      <div class="cardSub" style="margin-top:10px;">Validation: Each line uses the maximum value from its indicator column across economies.</div>
    </div>
  ` : "";

  // ---- Render ----
  root.innerHTML = `
    <div class="summaryStack">

      <div class="card nowcastCard">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">Nowcast (estimate) summary</div>
            <div class="cardSub">Placeholder section — this will show near-term nowcast signals once the nowcast dataset is defined.</div>
          </div>
        </div>
        <div class="nowcastBody">
          <div class="muted">Coming soon: quick nowcast cards (e.g., short-run growth, inflation, labor signals) with economy-level highlights.</div>
        </div>
      </div>

      <div class="card summarySnapshotCard">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">Key snapshot</div>
            <div class="cardSub">Quick portfolio indicators computed from the current dataset (missing values skipped).</div>
          </div>
          <button class="btnInlineGhost" id="tileTotalGdp" title="Open GDP breakdown">GDP breakdown</button>
        </div>
        <div class="kpiGrid kpiGrid3">
          <div class="kpi">
            <div class="kpiK">Total GDP (PPP)</div>
            <div class="kpiV">${isNum(gdp) ? fmtNumber(gdp, 1) : "–"}</div>
            <div class="kpiS">Billion USD, 2023</div>
          </div>
          <div class="kpi">
            <div class="kpiK">Avg. GDP growth</div>
            <div class="kpiV">${isNum(gdpGrowth) ? fmtNumber(gdpGrowth, 1) + "%" : "–"}</div>
            <div class="kpiS">2022–23</div>
          </div>
          <div class="kpi">
            <div class="kpiK">Avg. TFP growth</div>
            <div class="kpiV">${isNum(tfp) ? fmtNumber(tfp, 1) + "%" : "–"}</div>
            <div class="kpiS">2022–23</div>
          </div>
        </div>
      </div>

      ${execSummaryHtml}
    ${portSegHtml}
    ${comparatorHtml}
    ${concHtml}

    <div class="summary2col">
      <div class="card">
        <div class="cardTitle">APO aggregates <span title="What this shows:
	A simple ‘group summary’ across economies (only where data exists).

	How we calculate (from data):
	- Avg. LP level = average of LP_level_per_worker_2023_kUSD across economies with numeric values.
	  Example: Avg = (v1 + v2 + ... + vn) ÷ n.
	- Median LP level = the middle LP value after sorting (typical economy).
	- Avg. GDP growth (proj.) = average of GDP_growth_proj_2530_pct.
	- Avg. TFP growth (proj.) = average of TFP_growth_proj_2530_pct.
	- Top-5 GDP share uses GDP_PPP_2023_bn:
	  Top-5 share = (sum of top 5 GDP_PPP_2023_bn) ÷ (sum of all GDP_PPP_2023_bn).
	Missing values are skipped." style="margin-left:8px; opacity:.8; cursor:help; font-size:14px;">ⓘ</span></div>
        <div class="cardSub">Portfolio view across economies.</div>
        <div class="kpiGrid">
          <div class="kpi">
            <div class="kpiK">Avg. LP level</div>
            <div class="kpiV">${isNum(avgLp)?fmtNumber(avgLp,1):"–"}</div>
            <div class="kpiS">kUSD/worker</div>
          </div>
          <div class="kpi">
            <div class="kpiK">Median LP level</div>
            <div class="kpiV">${isNum(medLp)?fmtNumber(medLp,1):"–"}</div>
            <div class="kpiS">kUSD/worker</div>
          </div>
          <div class="kpi">
            <div class="kpiK">Avg. GDP growth (proj.)</div>
            <div class="kpiV">${isNum(avgGdpProj)?fmtNumber(avgGdpProj,1)+"%":"–"}</div>
            <div class="kpiS">2025–30</div>
          </div>
          <div class="kpi">
            <div class="kpiK">Avg. TFP growth (proj.)</div>
            <div class="kpiV">${isNum(avgTfpProj)?fmtNumber(avgTfpProj,1)+"%":"–"}</div>
            <div class="kpiS">2025–30</div>
          </div>
          <div class="kpi">
            <div class="kpiK">Top 5 GDP share</div>
            <div class="kpiV">${isNum(top5Share)?fmtNumber(top5Share*100,1)+"%":"–"}</div>
            <div class="kpiS">of total GDP</div>
          </div>
        </div>
        <div class="cardSub" style="margin-top:10px;">Validation: GDP share = (sum of top-5 <span class="mono">GDP_PPP_2023_bn</span>) ÷ (sum over all economies).</div>
      </div>

      <div class="card">
        <div class="cardTitle">Gap to frontier</div>
        <div class="cardSub">Compare any economy’s labor productivity level with the frontier (highest LP level). This makes / “How far behind?”</div>
        <div class="gapGrid">
          <div class="gapBox">
            <div class="gapK">Frontier</div>
            <div class="gapV" id="gapFrontierName">${escapeHtml(frontier?.name||"–")}</div>
            <div class="gapS" id="gapFrontierVal">${isNum(frontier?.v)?fmtNumber(frontier.v,1):"–"} <span class="muted">kUSD/worker</span></div>
          </div>
          <div class="gapBox">
            <div class="gapK">Compare</div>
            <select class="select" id="gapCompareSelect" aria-label="Select economy to compare">
              ${economies.map(e=>`<option value="${escapeHtml(e)}" ${(e===defaultCompare)?"selected":""}>${escapeHtml(e)}</option>`).join("")}
            </select>
            <div class="gapS" id="gapCompareVal">—</div>
          </div>
          <div class="gapBox">
            <div class="gapK">Frontier / Compare</div>
            <div class="gapV" id="gapRatio">—</div>
            <div class="gapS">(level gap)</div>
          </div>
        </div>
        <div class="cardSub" style="margin-top:10px;">Validation: Ratio = <span class="mono">max(LP_level_per_worker_2023_kUSD)</span> ÷ selected economy’s <span class="mono">LP_level_per_worker_2023_kUSD</span>.</div>
      </div>
    </div>

    <div class="summary2col">
      <div class="card">
        <div class="cardHeader">
          <div>
        <div class="cardTitle">Quadrant snapshot <span title="What this shows:
	A positioning map (not cause-and-effect). Each dot is one economy.
	What each part means (from data):
	- X-axis = GDP per capita (PPP) 2023: GDPpc_PPP_2023_kUSD.
	- Y-axis = LP level per worker (2023): LP_level_per_worker_2023_kUSD.
	- Dot size = total GDP (PPP) 2023: GDP_PPP_2023_bn.
	How to read it (example):
	- Top-right = higher income per person AND higher productivity per worker.
	- Bottom-left = lower income per person AND lower productivity per worker." style="margin-left:8px; opacity:.8; cursor:help; font-size:14px;">ⓘ</span></div>
            <div class="cardSub">A single chart to show “where economies sit” on <b>${escapeHtml(quadXDef?.label||quadX)}</b> (x) vs <b>${escapeHtml(quadYDef?.label||quadY)}</b> (y). Dot size is GDP (PPP, 2023). Hover for exact values; click a dot to open the economy profile.</div>
          </div>
        </div>
        ${quadrantSvg}
        <div class="cardSub" style="margin-top:10px;">This is a positioning map combining an <i>income/scale proxy</i> (GDP per capita) with a <i>productivity outcome</i> (LP per worker). It’s a quick “positioning map,” not a causal model.</div>
      </div>

      <div class="card">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">Distributions</div>
            <div class="cardSub">How many economies fall into growth buckets (latest year) (Buckets: “<2%”, “2–4%”, etc.).</div>
          </div>
        </div>
        <div class="distBlock">
          <div class="distTitle">GDP growth (2022–23)</div>
          ${distBarsHtml(distGdp)}
        </div>
        <div class="distBlock">
          <div class="distTitle">Per-worker labor productivity growth (2022–23)</div>
          ${distBarsHtml(distLp)}
        </div>
        <div class="distBlock">
          <div class="distTitle">TFP growth (2022–23)</div>
          ${distBarsHtml(distTfp)}
        </div>
        <div class="cardSub" style="margin-top:10px;">Distributions show whether performance is “broad-based” (many economies in 2–4% / 4–6%) or “uneven” (mass near 0% / negative with a few high outliers). Counts come directly from the indicator columns in <span class="mono">data.js</span>.</div>
      </div>
    </div>

    <div class="card">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">Rankings snapshot</div>
          <div class="cardSub">Top 5 and Bottom 5 economies across key indicators (levels, recent growth, and selected projections). Values come directly from <span class="mono">data</span>.</div>
        </div>
      </div>

      <div class="rankGrid" id="summaryRankGrid">
        ${rankHtml}
      </div>

      <div class="cardSub" style="margin-top:10px;">Validation: Each leaderboard is computed by sorting numeric values from the corresponding indicator column.</div>
    </div>
    </div>
  `;

  // GDP breakdown
  const tile = $("#tileTotalGdp");
  if(tile) tile.addEventListener("click", openGdpModal);

  // Executive summary clicks -> profile
  $$("#execSummaryCard .execLink").forEach(b=>{
    b.addEventListener("click", ()=>{
      const e = b.dataset.economy;
      if(e) goProfile(e);
    });
  });

  // Portfolio segmentation controls
  const segSel = $("#segBySelect");
  if(segSel){
    segSel.addEventListener("change", ()=>{
      state.summarySegIndicatorId = segSel.value;
      renderSummary();
    });
  }
  $$("#portfolioSegCard .segChip").forEach(b=>{
    b.addEventListener("click", ()=>{
      const e = b.dataset.economy;
      if(e) goProfile(e);
    });
  });

  // Frontier comparator controls
  const fcInd = $("#fcIndicatorSelect");
  const fcA = $("#fcEconomyA");
  const fcB = $("#fcEconomyB");

  function updateComparator(){
    if(!fcInd || !fcA || !fcB) return;
    const id = fcInd.value;
    const aName = fcA.value;
    const bName = fcB.value;

    state.summaryCompareIndicatorId = id;
    state.summaryCompareA = aName;
    state.summaryCompareB = bName;

    const rowA = DATA.find(r=>r && r.Economy === aName) || null;
    const rowB = DATA.find(r=>r && r.Economy === bName) || null;

    const aVal = rowA && isNum(rowA[id]) ? rowA[id] : null;
    const bVal = rowB && isNum(rowB[id]) ? rowB[id] : null;

    // ranks (descending)
    const ranked = sortedNumeric(id).slice().sort((x,y)=>y.v-x.v);
    const rankMap = new Map(ranked.map((x,i)=>[x.name, i+1]));
    const n = ranked.length;
    const aRank = rankMap.get(aName) || null;
    const bRank = rankMap.get(bName) || null;

    const aNameEl = $("#fcAName");
    const bNameEl = $("#fcBName");
    if(aNameEl){ aNameEl.textContent = aName || "–"; aNameEl.dataset.economy = aName || ""; }
    if(bNameEl){ bNameEl.textContent = bName || "–"; bNameEl.dataset.economy = bName || ""; }

    const aValEl = $("#fcAValue");
    const bValEl = $("#fcBValue");
    const aRankEl = $("#fcARank");
    const bRankEl = $("#fcBRank");

    if(aValEl) aValEl.textContent = isNum(aVal) ? formatIndicatorValue(id, aVal) : "–";
    if(bValEl) bValEl.textContent = isNum(bVal) ? formatIndicatorValue(id, bVal) : "–";

    if(aRankEl) aRankEl.textContent = (aRank && n) ? `Rank ${aRank} of ${n}` : "Rank —";
    if(bRankEl) bRankEl.textContent = (bRank && n) ? `Rank ${bRank} of ${n}` : "Rank —";

    const ratioEl = $("#fcRatio");
    const diffEl = $("#fcDiff");
    const rdEl = $("#fcRankDelta");

    if(ratioEl){
      ratioEl.textContent = (isNum(aVal) && isNum(bVal) && bVal !== 0) ? `${fmtNumber(aVal/bVal,2)}×` : "–";
    }
    if(diffEl){
      diffEl.textContent = (isNum(aVal) && isNum(bVal)) ? formatIndicatorValue(id, aVal - bVal) : "–";
    }
    if(rdEl){
      if(aRank && bRank) rdEl.textContent = `${(bRank - aRank) > 0 ? "+" : ""}${bRank - aRank}`;
      else rdEl.textContent = "–";
    }

    // name clicks -> profile
    if(aNameEl){ aNameEl.onclick = ()=>{ if(aName) goProfile(aName); }; }
    if(bNameEl){ bNameEl.onclick = ()=>{ if(bName) goProfile(bName); }; }
  }

  if(fcInd) fcInd.addEventListener("change", updateComparator);
  if(fcA) fcA.addEventListener("change", updateComparator);
  if(fcB) fcB.addEventListener("change", updateComparator);
  updateComparator();

  // Ranking items click -> profile
  $$("#summaryRankGrid .rankItem").forEach(it=>{
    it.addEventListener("click", ()=>{
      const e = it.dataset.economy;
      if(e) goProfile(e);
    });
  });

  // Quadrant dots click -> profile
  $$(".quadSvg .qDot").forEach(dot=>{
    dot.addEventListener("click", ()=>{
      const e = dot.dataset.economy;
      if(e) goProfile(e);
    });
  });

  // Gap-to-frontier selector
  const sel = $("#gapCompareSelect");
  const cmpVal = $("#gapCompareVal");
  const ratioEl = $("#gapRatio");
  function updateGap(){
    if(!sel || !cmpVal || !ratioEl) return;
    const name = sel.value;
    const row = DATA.find(r=>r && r.Economy === name) || null;
    const v = row && isNum(row.LP_level_per_worker_2023_kUSD) ? row.LP_level_per_worker_2023_kUSD : null;
    cmpVal.textContent = isNum(v) ? `${fmtNumber(v,1)} kUSD/worker` : "–";
    if(frontier && isNum(frontier.v) && isNum(v) && v !== 0){
      ratioEl.textContent = `${fmtNumber(frontier.v / v, 1)}×`;
    }else{
      ratioEl.textContent = "–";
    }
  }
  if(sel) sel.addEventListener("change", updateGap);
  updateGap();
}


/** -------- Indicators -------- */
function setIndicatorHeader(ind){
  const t = $("#indicatorTitle");
  const s = $("#indicatorSub");
  if(!t || !s) return;
  if(!ind){
    t.textContent = "Indicators";
    s.textContent = "Please select an indicator from the sidebar.";
    return;
  }
  t.textContent = ind.label;
  const note = [];
  if(ind.unit) note.push(ind.unit);
  if(state.mode === "projection") note.push("Showing: Projection");
  if(state.mode === "data") note.push("Showing: Data");
  if(state.mode === "all") note.push(ind.proj ? "Showing: Data + Projection" : "Showing: Data");
  s.textContent = note.length ? note.join(" · ") : "";
}

function sortedRows(ind){
  const q = (state.search || "").trim().toLowerCase();
  const rows = q
    ? DATA.filter(r => (r.Economy||"").toLowerCase().includes(q))
    : DATA.slice();

  const mode = state.mode;
  const useProj = (mode !== "data") && !!ind.proj;
  const useData = (mode !== "projection");

  function pickVal(r){
    const dv = isNum(r[ind.id]) ? r[ind.id] : csvGetDerivedDataValue(r.Economy, ind.id);
    const pv = (ind.proj && isNum(r[ind.proj])) ? r[ind.proj] : (ind.proj ? csvGetProjectionValue(r.Economy, ind.proj) : null);
    if(mode === "data") return dv;
    if(mode === "projection") return pv;
    if(useData && useProj) return (isNum(dv) ? dv : (isNum(pv) ? pv : null));
    return useData ? dv : pv;
  }

  const sort = state.sort;
  if(sort === "alpha"){
    rows.sort((a,b)=>(a.Economy||"").localeCompare(b.Economy||""));
    return rows;
  }

  rows.sort((a,b)=>{
    const va = pickVal(a);
    const vb = pickVal(b);
    if(!isNum(va) && !isNum(vb)) return (a.Economy||"").localeCompare(b.Economy||"");
    if(!isNum(va)) return 1;
    if(!isNum(vb)) return -1;
    return sort === "highest" ? (vb - va) : (va - vb);
  });
  return rows;
}

function renderBars(ind){
  const list = $("#barList");
  const hint = $("#chartHint");
  if(!list || !hint) return;

  if(!ind){
    hint.textContent = "Please select an indicator.";
    list.innerHTML = "";
    return;
  }
  hint.textContent = "";

  const rows = sortedRows(ind);

  const showProj = (state.mode !== "data") && !!ind.proj;
  const showData = (state.mode !== "projection");
  const dual = showData && showProj;

  // Find max positive and max absolute negative across BOTH series (Data + Projection)
  let maxPos = 0;
  let maxNegAbs = 0;

  rows.forEach(r=>{
    const dv = isNum(r[ind.id]) ? r[ind.id] : null;
    const pv = (ind.proj && isNum(r[ind.proj])) ? r[ind.proj] : null;

    [dv, pv].forEach(v=>{
      if(!isNum(v)) return;
      if(v >= 0) maxPos = Math.max(maxPos, v);
      else maxNegAbs = Math.max(maxNegAbs, Math.abs(v));
    });
  });

  // If everything is missing or zero, avoid divide by zero
  const denom = (maxPos + maxNegAbs) || 1;
  const zeroPct = (maxNegAbs / denom) * 100; // where zero line sits

  function buildAxisLine(v, kind){
    // kind: "data" or "proj"
    const line = document.createElement("div");
    line.className = "barAxisLine";
    line.style.setProperty("--zero", `${zeroPct}%`);

    if(!isNum(v) || (v === 0)){
      return line; // no fill for missing/zero (zero still represented by the axis)
    }

    const seg = document.createElement("div");
    const isNeg = v < 0;
    seg.className = `barSeg ${kind} ${isNeg ? "neg" : "pos"}`;

    if(isNeg){
      // width proportional to abs(v) vs maxNegAbs within [0..zeroPct]
      const w = maxNegAbs ? (Math.abs(v) / maxNegAbs) * zeroPct : 0;
      const left = zeroPct - w;
      seg.style.left = `${left}%`;
      seg.style.width = `${w}%`;
    }else{
      // width proportional to v vs maxPos within [zeroPct..100]
      const span = 100 - zeroPct;
      const w = maxPos ? (v / maxPos) * span : 0;
      seg.style.left = `${zeroPct}%`;
      seg.style.width = `${w}%`;
    }

    line.appendChild(seg);
    return line;
  }

  list.innerHTML = "";
  rows.forEach(r=>{
    const dv = isNum(r[ind.id]) ? r[ind.id] : null;
    const pv = (ind.proj && isNum(r[ind.proj])) ? r[ind.proj] : null;

    const row = document.createElement("div");
    row.className = "barRow";

    const name = document.createElement("div");
    name.className = "barName";
    name.textContent = r.Economy || "—";

    const val = document.createElement("div");
    val.className = "barVal";

    if(dual){
      const wrap = document.createElement("div");
      wrap.className = "barTrackDual";
      wrap.appendChild(buildAxisLine(dv, "data"));
      wrap.appendChild(buildAxisLine(pv, "proj"));
      row.appendChild(name);
      row.appendChild(wrap);

      const dTxt = isNum(dv) ? fmtNumber(dv) : "–";
      const pTxt = isNum(pv) ? fmtNumber(pv) : "–";
      val.textContent = `D: ${dTxt}  |  P: ${pTxt}`;
      row.appendChild(val);
    }else{
      // single series diverging
      const v = (state.mode === "projection") ? pv : dv;
      const wrap = document.createElement("div");
      wrap.className = "barTrackDual"; // reuse container padding look
      wrap.style.gap = "0px";
      wrap.appendChild(buildAxisLine(v, (state.mode === "projection") ? "proj" : "data"));

      row.appendChild(name);
      row.appendChild(wrap);
      val.textContent = isNum(v) ? fmtNumber(v) : "–";
      row.appendChild(val);
    }

    list.appendChild(row);
  });
}

function renderIndicatorTable(ind){
  const tbl = $("#tableView");
  const meta = $("#tableMeta");
  if(!tbl || !meta) return;

  if(!ind){
    tbl.innerHTML = "";
    meta.textContent = "—";
    return;
  }

  const rows = sortedRows(ind);
  const showProj = (state.mode !== "data") && !!ind.proj;
  const showData = (state.mode !== "projection");

  meta.textContent = `Showing: ${rows.length} economies · Missing values display as “–”`;

  const head = [];
  head.push(`<tr>
    <th>Economy</th>
    ${showData ? `<th class="num">Data</th>` : ``}
    ${showProj ? `<th class="num">Projection</th>` : ``}
  </tr>`);

  const body = rows.map(r=>{
    const dv = isNum(r[ind.id]) ? r[ind.id] : null;
    const pv = (ind.proj && isNum(r[ind.proj])) ? r[ind.proj] : null;
    return `<tr>
      <td>${r.Economy || "—"}</td>
      ${showData ? `<td class="num">${isNum(dv) ? fmtNumber(dv) : "–"}</td>` : ``}
      ${showProj ? `<td class="num">${isNum(pv) ? fmtNumber(pv) : "–"}</td>` : ``}
    </tr>`;
  }).join("");

  tbl.innerHTML = `<thead>${head.join("")}</thead><tbody>${body}</tbody>`;
}

function renderIndicators(){
  const ind = state.indicatorId ? getIndicator(state.indicatorId) : null;

  // Mode button visibility
  const projBtn = $$('#modeSeg .segBtn').find(b=>b.dataset.mode === "projection");
  const allBtn  = $$('#modeSeg .segBtn').find(b=>b.dataset.mode === "all");
  if(ind && ind.proj){
    if(projBtn) projBtn.classList.remove("hidden");
    if(allBtn) allBtn.classList.remove("hidden");
  }else{
    if(projBtn) projBtn.classList.add("hidden");
    if(allBtn)  allBtn.classList.add("hidden");
    if(state.mode !== "data") state.mode = "data";
  }

  $$("#modeSeg .segBtn").forEach(b=> b.classList.toggle("active", b.dataset.mode === state.mode));

  setIndicatorHeader(ind);
  renderBars(ind);
  renderIndicatorTable(ind);
}

/** -------- Country profile (new layout) -------- */
function renderProfile(){
  const root = $("#view-profile");
  if(!root) return;

  const economies = economiesAll();
  if(!state.country && economies.length) state.country = economies[0];

  const r = DATA.find(x=>x.Economy === state.country) || null;

  const title = state.country ? state.country : "Country profile";
  const subtitle = "Key indicators (left) and narrative highlights (right).";

  const selectOptions = economies.map(e=>`<option value="${e}" ${e===state.country?"selected":""}>${e}</option>`).join("");

  const keyRows = DEFAULT_INDICATORS.map(ind=>{
    const dv = r && isNum(r[ind.id]) ? r[ind.id] : null;
    const pv = r && ind.proj && isNum(r[ind.proj]) ? r[ind.proj] : null;
    return `<tr>
      <td>${ind.label}</td>
      <td class="num">${isNum(dv) ? fmtNumber(dv) : "–"}</td>
      <td class="num">${ind.proj ? (isNum(pv) ? fmtNumber(pv) : "–") : "–"}</td>
    </tr>`;
  }).join("");

  const general = r && r.General_summary ? r.General_summary : "–";
  const challenges = r && r.Challenges_summary ? r.Challenges_summary : "–";

  root.innerHTML = `
    <div class="profileHeader">
      <div>
        <div class="profileName">${title}</div>
        <div class="profileSubtitle">${subtitle}<br/>${SOURCE_LABEL}</div>
      </div>
      <div>
        <select class="select" id="countrySelect" aria-label="Select economy">
          ${selectOptions}
        </select>
      </div>
    </div>

    <div class="profileGrid">
      <div class="card">
        <div class="cardTitle">Key indicators</div>
        <div class="cardSub">Data (left) and projection (right) where available</div>
        <div class="tableWrap">
          <table class="table">
            <thead>
              <tr>
                <th>Indicator</th>
                <th class="num">Data</th>
                <th class="num">Projection</th>
              </tr>
            </thead>
            <tbody>${keyRows}</tbody>
          </table>
        </div>
      </div>

      <div class="profileRightStack">
        <div class="card">
          <div class="cardTitle">General summary</div>
          <div class="cardSub">From narrative fields in Data_Master (if provided)</div>
          <div class="textBlock">${escapeHtml(general)}</div>
        </div>

        <div class="card">
          <div class="cardTitle">Challenges</div>
          <div class="cardSub">From narrative fields in Data_Master (if provided)</div>
          <div class="textBlock">${escapeHtml(challenges)}</div>
        </div>
      </div>
    </div>
  `;

  const sel = $("#countrySelect");
  if(sel){
    sel.addEventListener("change",(e)=>{
      state.country = e.target.value;
      renderProfile();
    });
  }
}


function cleanIndicatorTitle(title){
  if(!title) return title;
  let t = String(title).trim();

  // Remove trailing parenthetical only if it contains year and/or units
  t = t.replace(/\s*\(([^)]*)\)\s*$/, (m, inside)=>{
    const s = String(inside||"").toLowerCase();
    const hasYear = /\b(19|20)\d{2}\b/.test(s) || /\b(19|20)\d{2}\s*[-–]\s*\d{2,4}\b/.test(s);
    const hasUnits = /(usd|ppp|thousand|million|billion|percent|%|persons|workers|hours|index|points)/.test(s);
    if(hasYear || hasUnits) return "";
    return m;
  });

  // Remove trailing "in 2023" / "in 2022–23"
  t = t.replace(/\s+in\s+\b(19|20)\d{2}(\s*[-–]\s*\d{2,4})?\b\s*$/i, "");

  // Remove trailing standalone year " 2023"
  t = t.replace(/\s+\b(19|20)\d{2}\b\s*$/i, "");

  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

function escapeHtml(s){
  if(typeof s !== "string") return "–";
  // preserve bullets/newlines safely
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

/** -------- Data view -------- */
function renderDataView(){
  const root = $("#view-data");
  if(!root) return;

  const cols = DATA.length ? Object.keys(DATA[0]) : [];
  const q = (state.search||"").trim().toLowerCase();
  const rows = q ? DATA.filter(r => (r.Economy||"").toLowerCase().includes(q)) : DATA;

  const head = `<tr>${cols.map(c=>`<th class="${c!=='Economy'?'num':''}">${c}</th>`).join("")}</tr>`;
  const body = rows.map(r=>{
    const tds = cols.map(c=>{
      const v = r[c];
      const isN = isNum(v);
	const isNarr = (c === "General_summary" || c === "Challenges_summary");
	if(isNarr){
	  const full = (typeof v === "string" && v.trim()) ? v.trim() : "–";
	  const safe = full.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
	  return `<td class="longText" title="${safe}">
            <div class="clamp">${safe}</div>
          </td>`;
}
return `<td class="${(c!=='Economy' && isN)?'num':''}">${isN ? fmtNumber(v) : (v ?? "–")}</td>`;
    }).join("");
    return `<tr>${tds}</tr>`;
  }).join("");

  root.innerHTML = `
    <div class="card">
      <div class="cardTitle">Data</div>
      <div class="cardSub">${SOURCE_LABEL}. Missing values display as “–”.</div>
      <div class="tableWrap">
        <table class="table">
          <thead>${head}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>
  `;
}

/** -------- Export -------- */
function exportCurrentView(){
  const view = state.view;

  function downloadCSV(filename, rows){
    const csv = rows.map(r => r.map(x=>{
      const s = (x ?? "").toString();
      if(/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
      return s;
    }).join(",")).join("\n");

    const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if(view === "indicators"){
    const ind = getIndicator(state.indicatorId);
    if(!ind){ alert("Select an indicator first."); return; }

    const showProj = (state.mode !== "data") && !!ind.proj;
    const showData = (state.mode !== "projection");

    const q = (state.search||"").trim().toLowerCase();
    const rows = q ? DATA.filter(r => (r.Economy||"").toLowerCase().includes(q)) : DATA;

    const out = [];
    out.push(["Economy", ...(showData?["Data"]:[]), ...(showProj?["Projection"]:[])]);
    rows.forEach(r=>{
      const data = isNum(r[ind.id]) ? r[ind.id] : "";
      const proj = (ind.proj && isNum(r[ind.proj])) ? r[ind.proj] : "";
      out.push([r.Economy, ...(showData?[data]:[]), ...(showProj?[proj]:[])]);
    });

    downloadCSV(`indicator_${ind.id}.csv`, out);
    return;
  }

  if(view === "profile"){
    if(!state.country){ alert("Select an economy first."); return; }
    const r = DATA.find(x=>x.Economy === state.country);
    if(!r){ alert("Economy not found."); return; }

    const out = [];
    out.push(["Indicator","Data","Projection"]);
    DEFAULT_INDICATORS.forEach(ind=>{
      const data = isNum(r[ind.id]) ? r[ind.id] : "";
      const proj = (ind.proj && isNum(r[ind.proj])) ? r[ind.proj] : "";
      out.push([ind.label, data, proj]);
    });

    downloadCSV(`profile_${state.country}.csv`, out);
    return;
  }

  const cols = DATA.length ? Object.keys(DATA[0]) : [];
  const out = [cols];
  DATA.forEach(r => out.push(cols.map(c => r[c] ?? "")));
  downloadCSV(`data_master_export.csv`, out);
}

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

/**
 * Simple balanced treemap (recursive split).
 * Not "squarified" perfection, but minimal and looks like a treemap.
 * Produces rectangles in container coordinates (x,y,w,h in [0..1]).
 */
function splitTreemap(items, x, y, w, h, vertical=true){
  // items: [{name, value}]
  if(items.length === 1){
    return [{...items[0], x, y, w, h}];
  }

  const total = items.reduce((s,it)=>s+it.value,0);
  const half = total / 2;

  let acc = 0;
  let idx = 0;
  while(idx < items.length && acc + items[idx].value <= half){
    acc += items[idx].value;
    idx++;
  }
  // ensure both groups non-empty
  if(idx === 0) idx = 1;
  if(idx === items.length) idx = items.length - 1;

  const a = items.slice(0, idx);
  const b = items.slice(idx);

  const sumA = a.reduce((s,it)=>s+it.value,0);
  const ratioA = sumA / total;

  if(vertical){
    const wA = w * ratioA;
    const wB = w - wA;
    return [
      ...splitTreemap(a, x, y, wA, h, !vertical),
      ...splitTreemap(b, x + wA, y, wB, h, !vertical),
    ];
  }else{
    const hA = h * ratioA;
    const hB = h - hA;
    return [
      ...splitTreemap(a, x, y, w, hA, !vertical),
      ...splitTreemap(b, x, y + hA, w, hB, !vertical),
    ];
  }
}

function colorForIndex(i){
  // deterministic pleasant variety without hard-coding country colors
  const hue = (i * 37) % 360;
  return `hsla(${hue}, 85%, 55%, 0.28)`;
}

/** -------- GDP modal -------- */
function openGdpModal(){
  const modal = $("#gdpModal");
  const body = $("#gdpModalBody");
  if(!modal || !body) return;

  const items = DATA
    .map(r=>({
      name: r.Economy,
      value: (isNum(r.GDP_PPP_2023_bn) ? r.GDP_PPP_2023_bn : null)
    }))
    .filter(x=>x.name && isNum(x.value));

  items.sort((a,b)=>b.value-a.value);

  const total = items.reduce((s,x)=>s+x.value,0);

  const rects = splitTreemap(items, 0, 0, 1, 1, true);

  body.innerHTML = `
    <div class="card" style="box-shadow:none; margin-bottom:12px;">
      <div class="cardSub">
        Validation: Total GDP is computed as sum of <span class="mono">GDP_PPP_2023_bn</span> across all loaded economies (T):
        <b>${fmtNumber(total,1)}T</b>.
      </div>
    </div>

    <div class="treemapWrap">
      <div class="treemap" id="gdpTreemap"></div>
    </div>
  `;

  const tm = document.getElementById("gdpTreemap");
  if(tm){
    rects.forEach((r, i)=>{
      const node = document.createElement("div");
      node.className = "tmNode";

      node.style.left   = (r.x * 100) + "%";
      node.style.top    = (r.y * 100) + "%";
      node.style.width  = (r.w * 100) + "%";
      node.style.height = (r.h * 100) + "%";
      node.style.background = colorForIndex(i);

      const area = r.w * r.h;
      if(area < 0.012) node.classList.add("tmTiny");

      node.title = `${r.name}: ${fmtNumber(r.value)} (bn, PPP 2023)`;

      node.innerHTML = `
        <div class="tmLabel">
          <div class="tmName">${r.name}</div>
          <div class="tmVal">${fmtNumber(r.value)}</div>
        </div>
      `;
      tm.appendChild(node);
    });
  }

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}
function closeGdpModal(){
  const modal = $("#gdpModal");
  if(!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
}

/** -------- Glossary modal -------- */
const GLOSSARY = [
  ["Gross Domestic Product (GDP)", "The total market value of all final goods and services produced within a country over a specific period (usually a year or a quarter)."],
  ["GDP growth", "The rate at which a country's GDP increases (or decreases) over time, usually reported quarterly or annually as a percentage."],
  ["Per capita GDP", "The average economic output (or income) per person in a country, often used as a rough proxy for living standards (GDP ÷ population)."],
  ["Per-worker labor productivity level", "Measures how much output each worker produces on average."],
  ["Per-worker labor productivity growth", "The rate at which output per worker increases over time."],
  ["Capital productivity growth", "The rate at which output produced per unit of capital increases over time. It measures how efficiently physical capital (machines, equipment, structures) is used to produce output."],
  ["TFP (Total Factor Productivity) growth", "The rate at which an economy becomes more efficient at using all inputs to produce output."],
];

function openGlossary(){
  const modal = $("#glossaryModal");
  const body = $("#glossaryModalBody");
  if(!modal || !body) return;

  body.innerHTML = `
    <div class="card" style="box-shadow:none;">
      ${GLOSSARY.map(([t,d])=>`
        <div style="margin-bottom:12px;">
          <div style="font-weight:900;">${t}</div>
          <div class="cardSub" style="margin-top:4px;">${d}</div>
        </div>
      `).join("")}
    </div>
  `;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}
function closeGlossary(){
  const modal = $("#glossaryModal");
  if(!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
}

/** -------- Admin-only: CSV + JSON loaders, download data.js -------- */
async function fileToText(file){
  return await file.text();
}

function parseCSV(text){
  // minimal CSV parser: handles quotes + commas
  const rows = [];
  let i=0, field="", row=[], inQ=false;

  function pushField(){
    row.push(field);
    field="";
  }
  function pushRow(){
    // ignore completely empty rows
    if(row.some(c => (c||"").trim() !== "")) rows.push(row);
    row=[];
  }

  while(i < text.length){
    const ch = text[i];
    if(inQ){
      if(ch === '"'){
        if(text[i+1] === '"'){ field += '"'; i += 2; continue; }
        inQ=false; i++; continue;
      }
      field += ch; i++; continue;
    }else{
      if(ch === '"'){ inQ=true; i++; continue; }
      if(ch === ','){ pushField(); i++; continue; }
      if(ch === '\n'){ pushField(); pushRow(); i++; continue; }
      if(ch === '\r'){ i++; continue; }
      field += ch; i++; continue;
    }
  }
  pushField(); pushRow();
  return rows;
}

function coerceValue(v){
  if(v === null || v === undefined) return "";
  const s = String(v).trim();
  if(s === "" || s === "–" || s === "-") return "";
  // number?
  const n = Number(s.replace(/,/g,""));
  if(Number.isFinite(n) && String(n) !== "NaN") return n;
  return s;
}

async function handleCsvUpload(file){
  const txt = await fileToText(file);
  const rows = parseCSV(txt);
  if(rows.length < 2) throw new Error("CSV appears empty.");

  const header = rows[0].map(h => (h||"").trim().replace(/^\uFEFF/, ""));
  const out = rows.slice(1).map(r=>{
    const obj = {};
    header.forEach((h, idx)=>{
      obj[h] = coerceValue(r[idx]);
    });
    return obj;
  });

  if(!header.includes("Economy")){
    throw new Error("CSV must include an 'Economy' column.");
  }

  DATA = out;
  state.sourceFile = file.name || "Data_Master.csv";
  autoExtendIndicatorsFromData();
  updateCounts();
  // CSV-first scaffold: load contracts in background (safe; does not override packaged values)
  loadCsvContracts().catch(()=>{});
  renderAll();
}

async function handleIndicatorJsonUpload(file){
  const txt = await fileToText(file);
  const defs = JSON.parse(txt);
  if(!Array.isArray(defs) || !defs.length) throw new Error("Invalid indicator JSON: expected an array.");
  // shallow validation
  defs.forEach(d=>{
    if(!d || typeof d.id !== "string" || typeof d.label !== "string") throw new Error("Each indicator must have {id, label}.");
  });

  INDICATORS = defs;
  saveLS("apo_indicator_defs_v1", INDICATORS);
  renderMenuTree();
  renderAll();
}

function downloadText(filename, content, mime="text/plain"){
  const blob = new Blob([content], { type:mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function makeDataJs(){
  const meta = {
    economies: economiesAll().length,
    source_file: state.sourceFile || "Data_Master"
  };
  // Include indicators so public build can use curated labels without any upload UI
  const parts = [];
  parts.push(`window.APO_META = ${JSON.stringify(meta)};`);
  parts.push(`window.APO_INDICATORS = ${JSON.stringify(INDICATORS)};`);
  parts.push(`window.APO_DATA = ${JSON.stringify(DATA)};`);
  return parts.join("\n");
}


/** -------- Trends (time series) -------- */

/* =======================
   TEST BUILD (Option A): Pilot trends loader (additive only)
   - Uses: data/pilot/trend_master_from_excel_pilot11.csv
   - Scope: Trend & Compare view ONLY
   - Keeps existing data.js (Latest/Projection) unchanged
   ======================= */

const PILOT_TRENDS_ENABLED = true;
const PILOT_TRENDS_CSV_PRIMARY = "data/trend_master.csv";
const PILOT_TRENDS_CSV_FALLBACK = "data/pilot/trend_master_from_excel_pilot11.csv";

// Friendly names for pilot indicators (shown in the Trends picker)
const PILOT_INDICATOR_LABELS = {
  out_gdp_ppp_level: { label: "Real GDP (PPP), level", unit: "" },
  pop_total_level: { label: "Population, level", unit: "" },
  lab_hours_worked_level: { label: "Total hours worked, level", unit: "" },
  prod_lp_per_worker_index: { label: "Labor productivity per worker (index)", unit: "Index" },
  prod_lp_per_hour_index: { label: "Labor productivity per hour (index)", unit: "Index" },
  prod_tfp_index: { label: "Total factor productivity (index)", unit: "Index" },
  price_cpi_index: { label: "Consumer price index (index)", unit: "Index" },
  out_ppp_gdp_rate: { label: "PPP conversion rate (GDP)", unit: "" },
  dem_private_cons_ppp_level: { label: "Private consumption (PPP), level", unit: "" },
  dem_gov_cons_ppp_level: { label: "Government consumption (PPP), level", unit: "" },
  dem_gfcf_ppp_level: { label: "Gross fixed capital formation (PPP), level", unit: "" },
};

// --- Pilot/UI crosswalk (keep UI labels consistent with the left menu) ---
// The left menu uses UI-friendly names (from menu.js). The Excel pilot file uses
// technical indicator_id codes. We map by stable codes and *display* the left-menu label.
function buildMenuKeyToLabel(){
  const m = new Map();
  try{
    (MENU_TREE||[]).forEach(g=>{
      (g.indicators||[]).forEach(ind=>{
        const k = _normKey(ind.name);
        if(k) m.set(k, ind.name);
      });
    });
  }catch(e){}
  return m;
}

const _MENU_KEY_TO_LABEL = buildMenuKeyToLabel();
const _ALLOWED_PILOT_TS_CODES = new Set(Object.values(MENU_TO_TS_CODE||{}));

function pilotLabelForTsCode(code){
  // Find the menu key that maps to this ts code
  for(const k in (MENU_TO_TS_CODE||{})){
    if(MENU_TO_TS_CODE[k] === code){
      return _MENU_KEY_TO_LABEL.get(k) || (PILOT_INDICATOR_LABELS[code]?.label) || code;
    }
  }
  return (PILOT_INDICATOR_LABELS[code]?.label) || code;
}

let _pilotTrendsLoaded = false;
let _pilotMeta = null;               // {years, indicators, economies, groups}
let _pilotByEco = new Map();         // abbr -> Map(indicator_id -> Map(year -> value))

function _parseCsvLineSimple(line){
  // Pilot CSV has no quoted commas; keep parser minimal & fast.
  const parts = line.split(",");
  if(parts.length < 4) return null;
  const indicator_id = parts[0];
  const economy_code = parts[1];
  const year = parseInt(parts[2], 10);
  const value = parts[3] === "" ? null : Number(parts[3]);
  if(!indicator_id || !economy_code || !Number.isFinite(year)) return null;
  return { indicator_id, economy_code, year, value: Number.isFinite(value) ? value : null };
}

async function loadPilotTrends(){
  if(_pilotTrendsLoaded) return { meta:_pilotMeta, byEco:_pilotByEco };

  // Prefer primary CSV; fall back to legacy pilot path if needed (GitHub Pages caching safe).
  let text = null;
  {
    const urls = [PILOT_TRENDS_CSV_PRIMARY, PILOT_TRENDS_CSV_FALLBACK];
    let lastErr = null;
    for(const u of urls){
      try{
        const res = await fetch(u, { cache: "no-store" });
        if(res && res.ok){ text = await res.text(); lastErr = null; break; }
        lastErr = new Error("HTTP " + (res ? res.status : "0") + " for " + u);
      }catch(e){ lastErr = e; }
    }
    if(text === null){
      throw new Error("Failed to load pilot trend_master CSV" + (lastErr ? (": " + (lastErr.message||lastErr)) : ""));
    }
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  if(lines.length < 2) throw new Error("Pilot trend CSV is empty");

  const indicatorsSet = new Set();
  const economiesSet = new Set();
  let minY = Infinity, maxY = -Infinity;

  // Parse rows
  for(let i=1; i<lines.length; i++){
    const row = _parseCsvLineSimple(lines[i]);
    if(!row) continue;
    indicatorsSet.add(row.indicator_id);
    economiesSet.add(row.economy_code);
    minY = Math.min(minY, row.year);
    maxY = Math.max(maxY, row.year);

    if(!_pilotByEco.has(row.economy_code)) _pilotByEco.set(row.economy_code, new Map());
    const ecoMap = _pilotByEco.get(row.economy_code);

    if(!ecoMap.has(row.indicator_id)) ecoMap.set(row.indicator_id, new Map());
    const indMap = ecoMap.get(row.indicator_id);

    indMap.set(row.year, row.value);
  }

  if(minY === Infinity || maxY === -Infinity) throw new Error("Pilot trend CSV has no valid rows");

  const years = [];
  for(let y=minY; y<=maxY; y++) years.push(y);

  // Only expose pilot indicators that are mapped to the v8 menu (additive integration rule).
  // Anything else in the pilot CSV is kept in memory but not shown in the UI yet.
  const indicators = Array.from(indicatorsSet)
    .filter(code => _ALLOWED_PILOT_TS_CODES.has(code))
    .sort()
    .map(code=>{
      const meta = PILOT_INDICATOR_LABELS[code] || { label: code, unit: "" };
      const label = pilotLabelForTsCode(code);
      return { code, label, unit: meta.unit || "", group: "Pilot (Excel)" };
    });

  const economies = Array.from(economiesSet).sort().map(abbr=>({ abbr, short: abbr }));

  _pilotMeta = {
    years,
    groups: ["Pilot (Excel)"],
    indicators,
    economies,
    note: "Pilot trends (Excel-derived long-format series).",
  };

  // defaults / safety: keep tsIndicator within the allowed pilot list
  if(indicators.length){
    const ok = indicators.some(d=>d.code === state.tsIndicator);
    if(!ok) state.tsIndicator = indicators[0].code;
  }
  if(!state.tsEconomy && economies.length) state.tsEconomy = economies[0].abbr;

  _pilotTrendsLoaded = true;
  return { meta:_pilotMeta, byEco:_pilotByEco };
}

let _tsInitDone = false;
let _tsRenderToken = 0;
const _tsCache = new Map(); // abbr -> {economy, series}

async function loadTsMeta(){
  // TEST BUILD: Use pilot trends only for the Trends view.
  if(PILOT_TRENDS_ENABLED){
    const pilot = await loadPilotTrends();
    state.tsMeta = pilot.meta;
    return pilot.meta;
  }

  // Fallback (legacy packaged JSON)
  if(state.tsMeta) return state.tsMeta;
  const res = await fetch("data/ts_meta.json", { cache: "no-store" });
  if(!res.ok) throw new Error("Failed to load ts_meta.json");
  const meta = await res.json();
  state.tsMeta = meta;
  // defaults
  if(!state.tsIndicator && meta.indicators && meta.indicators.length){
    state.tsIndicator = meta.indicators[0].code;
  }
  if(!state.tsEconomy && meta.economies && meta.economies.length){
    state.tsEconomy = meta.economies[0].abbr;
  }
  return meta;
}

async function loadTsEconomy(abbr){
  // TEST BUILD: pilot data (CSV) -> match legacy shape {economy, series:{code:[...]}}
  if(PILOT_TRENDS_ENABLED){
    await loadPilotTrends();
    const meta = _pilotMeta;
    const years = (meta && meta.years) ? meta.years : [];
    const ecoMap = _pilotByEco.get(abbr) || new Map();

    // build full series object for this economy (all indicators)
    const series = {};
    (meta.indicators || []).forEach(ind=>{
      const yearMap = ecoMap.get(ind.code) || new Map();
      series[ind.code] = years.map(y => (yearMap.has(y) ? yearMap.get(y) : null));
    });

    const obj = { economy: abbr, series };
    _tsCache.set(abbr, obj);
    return obj;
  }

  // legacy JSON loader
  if(_tsCache.has(abbr)) return _tsCache.get(abbr);
  const res = await fetch(`data/ts/${abbr}.json`, { cache: "no-store" });
  if(!res.ok) throw new Error(`Failed to load data/ts/${abbr}.json`);
  const obj = await res.json();
  _tsCache.set(abbr, obj);
  return obj;
}


function syncTrendsPickerVisibility(){
  const picker = document.querySelector("#tsIndicatorPicker");
  if(picker) picker.style.display = state.tsLocked ? "none" : "flex";
}

function initTrendsUI(){
  if(_tsInitDone) return;
  _tsInitDone = true;

  const indSel = document.querySelector("#tsIndicatorSelect");
  const ecoSel = document.querySelector("#tsEconomySelect");
  const ecoSearch = document.querySelector("#tsEconomySearch");
  const allOnBtn = document.querySelector("#tsAllOn");
  const allOffBtn = document.querySelector("#tsAllOff");
  const picker = document.querySelector("#tsIndicatorPicker");

  function syncPickerVisibility(){
    syncTrendsPickerVisibility();
  }

  const onChange = () => {
    if(indSel) state.tsIndicator = indSel.value || state.tsIndicator;
    if(ecoSel) state.tsEconomy = ecoSel.value || state.tsEconomy;
    // remove primary from compare list if present
    state.tsCompare = (state.tsCompare || []).filter(x => x && x !== state.tsEconomy);
    renderTrends();
  };

  if(indSel){
    indSel.addEventListener("change", ()=>{ state.tsLocked = false; syncPickerVisibility(); onChange(); });
  }
  if(ecoSel) ecoSel.addEventListener("change", onChange);

  if(ecoSearch){
    ecoSearch.addEventListener("input", ()=>{
      state.tsEcoQuery = ecoSearch.value || "";
      renderTrends();
    });
  }

  if(allOnBtn){
    allOnBtn.addEventListener("click", ()=>{ state.tsAllOn = true; renderTrends(); state.tsAllOn = false; });
  }
  if(allOffBtn){
    allOffBtn.addEventListener("click", ()=>{ state.tsCompare = []; renderTrends(); });
  }

  syncPickerVisibility();

  // lazy-load meta and populate controls
  loadTsMeta()
    .then(meta => {
      populateTrendsControls(meta);
      renderTrends();
      syncPickerVisibility();
    })
    .catch(err => {
      const el = document.querySelector("#tsChart");
      if(el) el.innerHTML = `<div class="muted">Unable to load trends data. ${escapeHtml(err.message || String(err))}</div>`;
    });
}

function populateTrendsControls(meta){
  const indSel = document.querySelector("#tsIndicatorSelect");
  const ecoSel = document.querySelector("#tsEconomySelect");
  const checklist = document.querySelector("#tsEconomyChecklist");
  const labelEl = document.querySelector("#tsSelectedIndicatorLabel");
  const subEl = document.querySelector("#tsSelectedIndicatorSub");

  // indicator dropdown (grouped)
  if(!indSel.dataset.populated){
    indSel.innerHTML = "";
    const groups = meta.groups || [];
    const indicators = meta.indicators || [];
    const byGroup = {};
    indicators.forEach(it => {
      const g = it.group || "Other";
      if(!byGroup[g]) byGroup[g] = [];
      byGroup[g].push(it);
    });

    const groupList = groups.length ? groups : Object.keys(byGroup).sort();
    groupList.forEach(g => {
      const items = byGroup[g];
      if(!items || !items.length) return;
      const og = document.createElement("optgroup");
      og.label = g;
      items.forEach(it => {
        const opt = document.createElement("option");
        opt.value = it.code;
        opt.textContent = `${it.label}`;
        og.appendChild(opt);
      });
      indSel.appendChild(og);
    });

    // any leftover groups not in group list
    Object.keys(byGroup).forEach(g => {
      if(groupList.includes(g)) return;
      const og = document.createElement("optgroup");
      og.label = g;
      byGroup[g].forEach(it => {
        const opt = document.createElement("option");
        opt.value = it.code;
        opt.textContent = `${it.label}`;
        og.appendChild(opt);
      });
      indSel.appendChild(og);
    });

    indSel.dataset.populated = "1";
  }

  // economy dropdown
  if(!ecoSel.dataset.populated){
    ecoSel.innerHTML = "";
    (meta.economies || []).forEach(e => {
      const opt = document.createElement("option");
      opt.value = e.abbr;
      opt.textContent = e.short || e.abbr;
      ecoSel.appendChild(opt);
    });
    ecoSel.dataset.populated = "1";
  }

  // set current values
  if(state.tsIndicator) indSel.value = state.tsIndicator;
  if(state.tsEconomy) ecoSel.value = state.tsEconomy;

  // Selected indicator label
  const ind = (meta.indicators || []).find(x => x.code === state.tsIndicator);
  if(labelEl) labelEl.textContent = ind ? (ind.label || "Indicator") : "Indicator";
  if(subEl){
    subEl.textContent = state.tsLocked ? "Selected from the indicator menu." : "You can change the indicator here.";
  }

  // Economy checklist (Explorer-style list)
  if(checklist && !checklist.dataset.populated){
    checklist.dataset.populated = "1";
    checklist.innerHTML = (meta.economies || []).map(e=>{
      const nm = e.short || e.abbr;
      return `<label class="trendCheckItem"><input type="checkbox" value="${escapeHtml(e.abbr)}"/><span>${escapeHtml(nm)}</span></label>`;
    }).join("");

    checklist.addEventListener("change", ()=>{
      const boxes = Array.from(checklist.querySelectorAll('input[type="checkbox"]'));
      const checked = boxes.filter(b=>b.checked).map(b=>b.value);
      if(!checked.length){
        const first = boxes[0];
        if(first){ first.checked = true; state.tsEconomy = first.value; state.tsCompare = []; }
      } else {
        state.tsEconomy = checked[0];
        state.tsCompare = checked.slice(1);
      }
      renderTrends();
    });
  }
}

function renderTrends(){
  // show/hide view
  const view = document.querySelector("#view-trends");
  if(!view) return;

  // ensure controls exist and meta is loading
  initTrendsUI();
  syncTrendsPickerVisibility();

  // only render chart when on trends view (avoid unnecessary fetches)
  if(state.view !== "trends") return;

  const chartEl = document.querySelector("#tsChart");
  const foot = document.querySelector("#tsFootnote");
  chartEl.innerHTML = `<div class="muted">Loading…</div>`;
  foot.textContent = "";

  const token = ++_tsRenderToken;

  loadTsMeta()
    .then(async meta => {
      if(token !== _tsRenderToken) return;

      // ensure selects reflect state
      populateTrendsControls(meta);

      // Sync checklist selections + filter
      const checklist = document.querySelector("#tsEconomyChecklist");
      if(checklist){
        const boxes = Array.from(checklist.querySelectorAll('input[type="checkbox"]'));

        // All on (select all) — limited to keep chart readable
        if(state.tsAllOn){
          // select up to 6 economies (primary + 5) to avoid clutter
          boxes.forEach(b=> b.checked = false);
          const take = boxes.slice(0, Math.min(6, boxes.length));
          take.forEach(b=> b.checked = true);
          const checked = take.map(b=>b.value);
          state.tsEconomy = checked[0] || state.tsEconomy;
          state.tsCompare = checked.slice(1);
        }

        const selected = new Set([state.tsEconomy, ...(state.tsCompare||[])]);
        boxes.forEach(b=>{ b.checked = selected.has(b.value); });

        const q = (state.tsEcoQuery || "").trim().toLowerCase();
        boxes.forEach(b=>{
          const item = b.closest('.trendCheckItem');
          if(!item) return;
          const t = (item.textContent || "").toLowerCase();
          item.style.display = (!q || t.includes(q)) ? "" : "none";
        });
      }

      const indCode = state.tsIndicator;
      const ind = (meta.indicators || []).find(x => x.code === indCode);
      const years = meta.years || [];
      const primary = state.tsEconomy;

      const compare = (state.tsCompare || []).filter(x => x && x !== primary);
      const economyList = [primary, ...compare];

      const seriesList = [];
      for(const abbr of economyList){
        const econObj = await loadTsEconomy(abbr);
        const vals = (econObj && econObj.series) ? econObj.series[indCode] : null;
        const econMeta = (meta.economies || []).find(e => e.abbr === abbr) || { abbr, short: abbr };
        seriesList.push({ abbr, name: econMeta.short || abbr, values: vals || [] });
      }
      if(token !== _tsRenderToken) return;

      drawTimeSeriesChart(chartEl, years, seriesList, {
        title: ind ? ind.label : "Indicator",
        unit: ind ? ind.unit : "",
      });

      if(ind && ind.note){
        foot.textContent = `Note: ${ind.note}`;
      } else {
        foot.textContent = `Source: APO Productivity Database (Databook 2025 series).`;
      }
    })
    .catch(err => {
      if(token !== _tsRenderToken) return;
      const msg = (err && err.message) ? err.message : String(err);
      const hint = /Failed to fetch/i.test(msg)
        ? " (Tip: open via GitHub Pages or a local web server — browsers block fetch() on file://)"
        : "";
      chartEl.innerHTML = `<div class="muted">Unable to render trends. ${escapeHtml(msg)}${escapeHtml(hint)}</div>`;
    });
}

function drawTimeSeriesChart(container, years, seriesList, opts){
  container.innerHTML = "";
  container.classList.add("tsChart");

  // wrapper (for tooltip positioning)
  const wrap = document.createElement("div");
  wrap.className = "tsChartWrap";
  container.appendChild(wrap);

  const W = 1100, H = 460;
  const pad = { l: 70, r: 30, t: 26, b: 56 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role","img");
  wrap.appendChild(svg);

  const title = document.createElementNS(svg.namespaceURI,"text");
  title.setAttribute("x", pad.l);
  title.setAttribute("y", 18);
  title.setAttribute("class","tsTitle");
  title.textContent = `${opts.title || ""}${opts.unit ? ` (${opts.unit})` : ""}`;
  svg.appendChild(title);

  // flatten values to get y-domain
  let yMin = Infinity, yMax = -Infinity;
  seriesList.forEach(s => {
    (s.values || []).forEach(v => {
      if(v === null || v === undefined) return;
      if(!Number.isFinite(v)) return;
      yMin = Math.min(yMin, v);
      yMax = Math.max(yMax, v);
    });
  });

  if(yMin === Infinity || yMax === -Infinity){
    const msg = document.createElement("div");
    msg.className = "muted";
    msg.textContent = "No data available for this selection.";
    container.innerHTML = "";
    container.appendChild(msg);
    return;
  }

  // pad domain
  const span = (yMax - yMin) || 1;
  yMin = yMin - span * 0.06;
  yMax = yMax + span * 0.06;

  const n = years.length || Math.max(...seriesList.map(s => (s.values || []).length));
  const xStep = n > 1 ? (innerW / (n - 1)) : innerW;

  const xAt = (i) => pad.l + i * xStep;
  const yAt = (v) => pad.t + (yMax - v) * (innerH / (yMax - yMin));

  // grid + y ticks
  const ticks = 6;
  for(let t=0; t<=ticks; t++){
    const frac = t / ticks;
    const y = pad.t + frac * innerH;
    const line = document.createElementNS(svg.namespaceURI,"line");
    line.setAttribute("x1", pad.l);
    line.setAttribute("x2", pad.l + innerW);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("class","tsGrid");
    svg.appendChild(line);

    const val = yMax - frac*(yMax-yMin);
    const lab = document.createElementNS(svg.namespaceURI,"text");
    lab.setAttribute("x", pad.l - 10);
    lab.setAttribute("y", y + 4);
    lab.setAttribute("text-anchor","end");
    lab.setAttribute("class","tsAxis");
    lab.textContent = fmt(val, 2);
    svg.appendChild(lab);
  }

  // x ticks every 5 years (or closest)
  const stepYears = 5;
  for(let i=0; i<n; i++){
    const yr = years[i];
    if(!yr) continue;
    if((yr - years[0]) % stepYears !== 0 && i !== n-1) continue;
    const x = xAt(i);
    const tick = document.createElementNS(svg.namespaceURI,"line");
    tick.setAttribute("x1", x);
    tick.setAttribute("x2", x);
    tick.setAttribute("y1", pad.t + innerH);
    tick.setAttribute("y2", pad.t + innerH + 6);
    tick.setAttribute("class","tsTick");
    svg.appendChild(tick);

    const lab = document.createElementNS(svg.namespaceURI,"text");
    lab.setAttribute("x", x);
    lab.setAttribute("y", pad.t + innerH + 22);
    lab.setAttribute("text-anchor","middle");
    lab.setAttribute("class","tsAxis");
    lab.textContent = String(yr);
    svg.appendChild(lab);
  }

  // axis border
  const border = document.createElementNS(svg.namespaceURI,"rect");
  border.setAttribute("x", pad.l);
  border.setAttribute("y", pad.t);
  border.setAttribute("width", innerW);
  border.setAttribute("height", innerH);
  border.setAttribute("class","tsBorder");
  svg.appendChild(border);

  const palette = ["#8b5cf6","#22c55e","#06b6d4","#f97316","#ef4444","#eab308","#3b82f6","#a855f7"];

  // lines
  seriesList.forEach((s, si) => {
    const vals = s.values || [];
    let d = "";
    for(let i=0; i<n; i++){
      const v = vals[i];
      if(v === null || v === undefined || !Number.isFinite(v)) continue;
      const x = xAt(i), y = yAt(v);
      d += (d ? " L " : "M ") + `${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    const path = document.createElementNS(svg.namespaceURI,"path");
    path.setAttribute("d", d || "");
    path.setAttribute("fill","none");
    path.setAttribute("stroke", palette[si % palette.length]);
    path.setAttribute("stroke-width","2.2");
    path.setAttribute("class","tsLine");
    svg.appendChild(path);

    // last point
    let lastI = -1, lastV = null;
    for(let i=n-1; i>=0; i--){
      const v = vals[i];
      if(v === null || v === undefined || !Number.isFinite(v)) continue;
      lastI = i; lastV = v; break;
    }
    if(lastI >= 0){
      const c = document.createElementNS(svg.namespaceURI,"circle");
      c.setAttribute("cx", xAt(lastI));
      c.setAttribute("cy", yAt(lastV));
      c.setAttribute("r", "3.4");
      c.setAttribute("fill", palette[si % palette.length]);
      svg.appendChild(c);
    }
  });

  // legend
  const legend = document.createElement("div");
  legend.className = "tsLegend";
  legend.innerHTML = seriesList.map((s, i) => `
    <div class="tsLegendItem">
      <span class="tsSwatch" style="background:${palette[i % palette.length]}"></span>
      <span>${escapeHtml(s.name)}</span>
    </div>
  `).join("");
  wrap.appendChild(legend);

  // tooltip & hover line
  const tooltip = document.createElement("div");
  tooltip.className = "tsTooltip hidden";
  wrap.appendChild(tooltip);

  const hover = document.createElementNS(svg.namespaceURI,"line");
  hover.setAttribute("y1", pad.t);
  hover.setAttribute("y2", pad.t + innerH);
  hover.setAttribute("class","tsHover");
  svg.appendChild(hover);

  const hit = document.createElementNS(svg.namespaceURI,"rect");
  hit.setAttribute("x", pad.l);
  hit.setAttribute("y", pad.t);
  hit.setAttribute("width", innerW);
  hit.setAttribute("height", innerH);
  hit.setAttribute("fill","transparent");
  svg.appendChild(hit);

  const showAt = (i, clientX, clientY) => {
    const yr = years[i] ?? "";
    const rows = seriesList.map((s, si) => {
      const v = (s.values || [])[i];
      const show = (v === null || v === undefined || !Number.isFinite(v)) ? "—" : fmt(v, 2);
      return `<div class="tsTipRow"><span class="tsSwatch" style="background:${palette[si % palette.length]}"></span><span class="tsTipName">${escapeHtml(s.name)}</span><span class="tsTipVal">${show}</span></div>`;
    }).join("");

    tooltip.innerHTML = `<div class="tsTipYear">${escapeHtml(String(yr))}</div>${rows}`;
    tooltip.classList.remove("hidden");

    const x = xAt(i);
    hover.setAttribute("x1", x);
    hover.setAttribute("x2", x);
    hover.classList.remove("hidden");

    // position tooltip near cursor
    const rect = wrap.getBoundingClientRect();
    const tx = Math.min(rect.width - 260, Math.max(10, clientX - rect.left + 12));
    const ty = Math.min(rect.height - 140, Math.max(10, clientY - rect.top - 10));
    tooltip.style.left = `${tx}px`;
    tooltip.style.top = `${ty}px`;
  };

  const hide = () => {
    tooltip.classList.add("hidden");
    hover.classList.add("hidden");
  };

  hit.addEventListener("mousemove", (ev) => {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const ctm = svg.getScreenCTM();
    if(!ctm) return;
    const loc = pt.matrixTransform(ctm.inverse());
    const rel = Math.max(0, Math.min(innerW, loc.x - pad.l));
    const i = Math.round(rel / xStep);
    showAt(Math.max(0, Math.min(n-1, i)), ev.clientX, ev.clientY);
  });

  hit.addEventListener("mouseleave", hide);
  hit.addEventListener("touchend", hide);
}

/** -------- Render router -------- */
function renderAll(){
  updateCounts();
  renderMenuTree();

  if(state.view === "summary") renderSummary();
  if(state.view === "indicators") renderIndicators();
  if(state.view === "trends") renderTrends();
  if(state.view === "profile") renderProfile();
  if(state.view === "data") renderDataView();
}

/** -------- Init -------- */
function init(){
  setTheme(state.theme);
  autoExtendIndicatorsFromData();
  renderMenuTree();
  updateCounts();

  // CSV-first scaffold: load contracts in background (safe; does not override packaged values)
  loadCsvContracts().catch(()=>{});

  $$(".navItem").forEach(b=>{
    b.addEventListener("click", ()=>{ switchView(b.dataset.view); closeSidebarIfMobile(); });
  });

  const home = $("#brandHome");
  const homeGo = ()=>{ switchView("summary"); };
  if(home){
    home.addEventListener("click", ()=>{ homeGo(); closeSidebarIfMobile(); });
    home.addEventListener("keydown",(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); homeGo(); closeSidebarIfMobile(); }});
  }

  // Sidebar (mobile drawer)
  const appEl = document.querySelector(".app");
  const sbToggle = $("#sidebarToggle");
  const sbOverlay = $("#sidebarOverlay");
  function closeSidebarIfMobile(){
    if(!appEl) return;
    if(window.matchMedia && window.matchMedia("(max-width: 980px)").matches){
      appEl.classList.remove("sidebarOpen");
    }
  }
  function toggleSidebar(){
    if(!appEl) return;
    appEl.classList.toggle("sidebarOpen");
  }
  if(sbToggle) sbToggle.addEventListener("click", toggleSidebar);
  if(sbOverlay) sbOverlay.addEventListener("click", closeSidebarIfMobile);

  // Sidebar menu controls
  const menuSearch = $("#menuSearch");
  if(menuSearch){
    menuSearch.addEventListener("input", (e)=>{
      _menuQuery = e.target.value || "";
      renderMenuTree();
    });
  }
  const collapseAllBtn = $("#menuCollapseAllBtn");
  const expandAllBtn = $("#menuExpandAllBtn");
  if(collapseAllBtn){
    collapseAllBtn.addEventListener("click", ()=>{
      _menuOpenGroups = new Set();
      _menuOpenIndicators = new Set();
      saveMenuOpenState();
      renderMenuTree();
    });
  }
  if(expandAllBtn){
    expandAllBtn.addEventListener("click", ()=>{
      _menuOpenGroups = new Set((MENU_TREE||[]).map(g=>g.id).filter(Boolean));
      _menuOpenIndicators = new Set();
      (MENU_TREE||[]).forEach(g=>{
        (g.indicators||[]).forEach(i=> _menuOpenIndicators.add(`${g.id}||${i.id}`));
      });
      saveMenuOpenState();
      renderMenuTree();
    });
  }

  const search = $("#searchBox");
  if(search){
    search.addEventListener("input", (e)=>{
      state.search = e.target.value || "";
      renderAll();
    });
  }

  $$("#themeSeg .segBtn").forEach(b=>{
    b.addEventListener("click", ()=> setTheme(b.dataset.theme));
  });

  $$("#modeSeg .segBtn").forEach(b=>{
    b.addEventListener("click", ()=>{
      if(b.classList.contains("hidden")) return;
      state.mode = b.dataset.mode;
      renderIndicators();
    });
  });

  const sort = $("#sortSelect");
  if(sort){
    sort.addEventListener("change",(e)=>{
      state.sort = e.target.value;
      renderIndicators();
    });
  }

  const exp = $("#exportBtn");
  if(exp) exp.addEventListener("click", exportCurrentView);

  // Modals
  const gdpOv = $("#gdpModalOverlay");
  const gdpClose = $("#gdpModalClose");
  if(gdpOv) gdpOv.addEventListener("click", closeGdpModal);
  if(gdpClose) gdpClose.addEventListener("click", closeGdpModal);

  const glBtn = $("#glossaryBtn");
  const glOv = $("#glossaryModalOverlay");
  const glClose = $("#glossaryModalClose");
  if(glBtn) glBtn.addEventListener("click", openGlossary);
  if(glOv) glOv.addEventListener("click", closeGlossary);
  if(glClose) glClose.addEventListener("click", closeGlossary);

  document.addEventListener("keydown",(e)=>{
    if(e.key === "Escape"){
      closeGdpModal();
      closeGlossary();
      closeSidebarIfMobile();
    }
  });

  // Admin-only hooks (only present in admin.html)
  if(IS_ADMIN){
    const csvInput = $("#csvInput");
    const indJsonInput = $("#indicatorJsonInput");
    const resetDataBtn = $("#resetDataBtn");
    const resetIndicatorsBtn = $("#resetIndicatorsBtn");
    const downloadDataJsBtn = $("#downloadDataJsBtn");
    const downloadIndicatorJsonBtn = $("#downloadIndicatorJsonBtn");

    if(csvInput){
      csvInput.addEventListener("change", async (e)=>{
        const f = e.target.files && e.target.files[0];
        if(!f) return;
        try{ await handleCsvUpload(f); }
        catch(err){ alert("CSV load failed: " + (err?.message || err)); }
        finally{ /* keep selected filename visible */ }
      });
    }

    if(indJsonInput){
      indJsonInput.addEventListener("change", async (e)=>{
        const f = e.target.files && e.target.files[0];
        if(!f) return;
        try{ await handleIndicatorJsonUpload(f); }
        catch(err){ alert("Indicator JSON load failed: " + (err?.message || err)); }
        finally{ /* keep selected filename visible */ }
      });
    }

    if(resetDataBtn){
      resetDataBtn.addEventListener("click", ()=>{
        DATA = deepClone(PACKAGED);
        state.sourceFile = (window.APO_META && window.APO_META.source_file) ? window.APO_META.source_file : "Data_Master";
        updateCounts();
        renderAll();
      });
    }

    if(resetIndicatorsBtn){
      resetIndicatorsBtn.addEventListener("click", ()=>{
        INDICATORS = deepClone(PACKAGED_INDICATORS);
        saveLS("apo_indicator_defs_v1", INDICATORS);
        renderMenuTree();
        renderAll();
      });
    }

    if(downloadDataJsBtn){
      downloadDataJsBtn.addEventListener("click", ()=>{
        const txt = makeDataJs();
        downloadText("data.js", txt, "application/javascript;charset=utf-8;");
      });
    }

    if(downloadIndicatorJsonBtn){
      downloadIndicatorJsonBtn.addEventListener("click", ()=>{
        downloadText("indicator_labels.json", JSON.stringify(INDICATORS, null, 2), "application/json;charset=utf-8;");
      });
    }
  }

  initTrendsUI();
  switchView("summary");
}


/** =======================
    CSV-first runtime bootstrap (no data.js required)
    - Builds DATA rows for the dashboard from:
      1) data/dashboard_profiles.csv (20 dashboard economies + narratives)
      2) data/trend_master.csv (numeric snapshot + long series)
      3) data/projection_baseline.csv (projection placeholders)
    - If any piece is missing, the UI will show "Coming soon" (no fake data).
   ======================= */

function _maxYearFromMap(yearMap){
  let maxY = -Infinity;
  if(!yearMap) return null;
  for(const [y,v] of yearMap.entries()){
    if(v === null || v === undefined) continue;
    if(Number.isFinite(v)) maxY = Math.max(maxY, y);
  }
  return (maxY === -Infinity) ? null : maxY;
}

function _latestValueFromByEco(byEco, ecoCode, indicatorId){
  const ecoMap = byEco && byEco.get(ecoCode);
  if(!ecoMap) return "";
  const yearMap = ecoMap.get(indicatorId);
  if(!yearMap) return "";
  const maxY = _maxYearFromMap(yearMap);
  if(maxY === null) return "";
  const v = yearMap.get(maxY);
  return (v === null || v === undefined || !Number.isFinite(v)) ? "" : v;
}

function _rowsToObjects(rows){
  if(!rows || rows.length < 2) return [];
  const header = rows[0].map(h => (h||"").trim().replace(/^\uFEFF/, ""));
  return rows.slice(1).map(r=>{
    const obj = {};
    header.forEach((h, idx)=>{ obj[h] = coerceValue(r[idx]); });
    return obj;
  }).filter(o => Object.values(o).some(v => String(v||"").trim() !== ""));
}

async function bootstrapCsvFirst(){
  // 1) Dashboard economy profiles (names + narratives)
  const profUrl = "data/dashboard_profiles.csv";
  const profRes = await fetch(profUrl, { cache:"no-store" });
  if(!profRes.ok) throw new Error("Failed to load " + profUrl + " (HTTP " + profRes.status + ")");
  const profTxt = await profRes.text();
  const profRows = _rowsToObjects(parseCSV(profTxt));

  // Require these columns (otherwise dashboard list will be empty)
  if(!profRows.length || !("Economy" in profRows[0]) || !("economy_code" in profRows[0])){
    throw new Error("dashboard_profiles.csv must include columns: Economy, economy_code");
  }

  // 2) Projection baseline
  const projUrl = "data/projection_baseline.csv";
  const projRes = await fetch(projUrl, { cache:"no-store" });
  if(!projRes.ok) throw new Error("Failed to load " + projUrl + " (HTTP " + projRes.status + ")");
  const projTxt = await projRes.text();
  const projRows = _rowsToObjects(parseCSV(projTxt));

  const projMap = new Map(); // ecoCode -> Map(indicator_id -> value)
  projRows.forEach(r=>{
    const eco = String(r.economy_code||"").trim();
    const id  = String(r.indicator_id||"").trim();
    const val = (r.value === "" || r.value === null || r.value === undefined) ? "" : r.value;
    if(!eco || !id) return;
    if(!projMap.has(eco)) projMap.set(eco, new Map());
    projMap.get(eco).set(id, val);
  });

  // 3) Trends master (also carries latest snapshot values for supported indicators)
  const trends = await loadPilotTrends(); // uses PILOT_TRENDS_CSV_PRIMARY / FALLBACK
  const byEco = trends.byEco;

  // 4) Build DATA rows (20 economies) using indicator IDs already expected by v8 UI
  const out = [];
  for(const p of profRows){
    const ecoCode = String(p.economy_code||"").trim();
    const row = {
      Economy: p.Economy || "",
      Flags_top4: p.Flags_top4 || "",
      General_summary: p.General_summary || "",
      Challenges_summary: p.Challenges_summary || "",
    };

    // latest (official)
    for(const ind of INDICATORS){
      row[ind.id] = _latestValueFromByEco(byEco, ecoCode, ind.id);
      // projection placeholder
      if(ind.proj){
        const m = projMap.get(ecoCode);
        row[ind.proj] = (m && m.has(ind.proj)) ? m.get(ind.proj) : "";
      }
    }

    out.push(row);
  }

  DATA = out;
  state.sourceFile = "CSV-first runtime";
}


bootstrapCsvFirst()
  .then(()=>{ init(); })
  .catch((err)=>{
    console.error(err);
    // As a safety net, fall back to packaged data.js if it was loaded.
    // If not loaded, the UI will show Coming soon for missing values.
    try{ showToast("CSV load failed; falling back to packaged data."); }catch(e){}
    init();
  });
