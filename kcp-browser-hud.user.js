// ==UserScript==
// @downloadURL  https://github.com/MasterYoda-Klavia/KCP-Web-extension/main/kcp-browser-hud.user.js
// @updateURL    https://github.com/MasterYoda-Klavia/KCP-Web-extension/main/kcp-browser-hud.user.js
// @supportURL   https://github.com/MasterYoda-Klavia/KCP-Web-extension/issues
// @homepageURL  https://github.com/MasterYoda-Klavia/KCP-Web-extension
// @name         Klavia Competitive Patch (Browser HUD)
// @namespace    https://playklavia.com/
// @version      1.4.0
// @description  Browser HUD for Klavia: live Points, WPM, Accuracy, Races, Races Needed, Rank, and Above/Below racer status
// @author       Yodex
// @match        https://playklavia.com/*
// @match        https://www.playklavia.com/*
// @match        https://playklavia.com/race
// @match        https://playklavia.com/lobbies/*
// @run-at       document-idle
// @icon         none
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      playklavia.com
// @connect      klavia.io
// ==/UserScript==

(function () {
  "use strict";

  // --------------------- Storage & Defaults ---------------------
  const S = {
    token: GM_getValue("kcp_token", ""),
    currentUser: GM_getValue("kcp_current_user", ""),
    targetUser: GM_getValue("kcp_target_user", "GoldenShyGuy"),
    theme: GM_getValue("kcp_theme", "#031920"),
    wpmTp: GM_getValue("kcp_wpm_tp", "season"), // match desktop defaults
    accTp: GM_getValue("kcp_acc_tp", "season"),
    racesTp: GM_getValue("kcp_races_tp", "season"),
    autoCenterProgress: GM_getValue("kcp_progress_autocenter", true),
      medalBaseUrl: GM_getValue("kcp_medal_base", ""),
  }
GM_registerMenuCommand("Set Medal Image Base URL", () => {
  const v = prompt(
    "Enter a base URL that contains medal PNGs (e.g. https://your.cdn/medals). Leave blank to use emoji-only.",
    S.medalBaseUrl || ""
  );
  if (v !== null) {
    GM_setValue("kcp_medal_base", v.trim());
    S.medalBaseUrl = v.trim();
    alert("Saved. Reloading.");
    location.reload();
  }
});


  // --------------------- Menu Commands ---------------------
  GM_registerMenuCommand("Set API Token", () => {
    const v = prompt("Enter your Klavia API token (saved locally in Tampermonkey):", S.token || "");
    if (v !== null) { GM_setValue("kcp_token", v.trim()); alert("Saved."); location.reload(); }
  });
  GM_registerMenuCommand("Set Current User", () => {
    const v = prompt("Enter your username (exactly as on leaderboards):", S.currentUser || "");
    if (v !== null) { GM_setValue("kcp_current_user", v.trim()); alert("Saved."); location.reload(); }
  });
  GM_registerMenuCommand("Set Target User", () => {
    const v = prompt("Enter the target user you’re tracking:", S.targetUser || "");
    if (v !== null) { GM_setValue("kcp_target_user", v.trim()); alert("Saved."); location.reload(); }
  });
  GM_registerMenuCommand("Set Theme Color", () => {
    const v = prompt("Enter a hex color for panel outlines:", S.theme || "#031920");
    if (v !== null) { GM_setValue("kcp_theme", v.trim()); alert("Saved."); repaintPanels(); }
  });
  GM_registerMenuCommand("Set WPM/ACC windows (season/24h)", () => {
    const w = prompt("WPM window (season or 24h):", S.wpmTp);
    const a = prompt("Accuracy window (season or 24h):", S.accTp);
    if (w && a) {
      GM_setValue("kcp_wpm_tp", w.trim());
      GM_setValue("kcp_acc_tp", a.trim());
      alert("Saved."); location.reload();
    }
  });

  if (!S.token) console.warn("[KCP] No token set; Tampermonkey menu → Set API Token.");

  // --------------------- Utilities ---------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").toString().normalize("NFKC").toLowerCase().trim();
  const API = location.hostname.includes("playklavia.com")
    ? "https://playklavia.com/api/v1"
    : "https://klavia.io/api/v1";

  function toInt(x, d = 0) {
    try { return Number.isFinite(+x) ? Math.trunc(+x) : d; } catch { return d; }
  }
  function toFloat(x, d = 0) {
    try { const n = +x; return Number.isFinite(n) ? n : d; } catch { return d; }
  }
  function toPct(x, d = 0) {
    const v = toFloat(x, NaN);
    if (!Number.isFinite(v)) return d;
    return (v >= 0 && v <= 1) ? +(v * 100).toFixed(2) : +v.toFixed(2);
  }

  function sameUserLike(row, user) {
    const t = norm(user);
    const cands = [row?.displayName, row?.name, row?.userName, row?.username, row?.racer, row?.player];
    return cands.some((v) => v && norm(v) === t);
  }

  // Robust list extraction like your Python helper
  function extractList(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === "object") {
      for (const k of ["leaderboard", "data", "results", "entries", "items", "topRacers", "ongoingSessions", "ongoing", "sessions"]) {
        if (Array.isArray(payload[k])) return payload[k];
      }
    }
    return Array.isArray(payload?.data) ? payload.data : [];
  }

  // --------------------- Networking (CORS-safe) ---------------------
  function apiGet(pathWithQuery, params) {
    const url = new URL(`${API}${pathWithQuery}`);
    if (params && typeof params === "object") {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: url.toString(),
        headers: {
          "Accept": "application/json",
          ...(S.token ? { "Authorization": `Bearer ${S.token}` } : {}),
        },
        timeout: 20000,
        onload: (res) => {
          try {
            const body = JSON.parse(res.responseText || "null");
            if (res.status === 401) console.warn("Unauthorized (401). Check your API token.");
            if (res.status === 403) console.warn("Forbidden (403). Token lacks access or is malformed.");
            resolve(res.status >= 200 && res.status < 300 ? body : body || null);
          } catch (e) {
            console.error("[KCP] Parse error", e, res.responseText);
            resolve(null);
          }
        },
        onerror: (e) => { console.error("[KCP] Network error", e); resolve(null); },
        ontimeout: () => { console.warn("[KCP] Request timeout:", url.toString()); resolve(null); },
      });
    });
  }

  async function getLeaderboard(metric, tp = "season") {
    const raw = await apiGet(`/leaderboards/${encodeURIComponent(metric)}`, { tp });
    const rows = extractList(raw);
    return rows.map((row, i) => {
      const name = row.displayName || row.name || row.racer || row.userName || row.username || row.player || "";
      return {
        ...row,
        name,
        rank: row.rank ?? (i + 1),
        points: row.points ?? row.score,
        races: row.races,
        accuracy: row.accuracy ?? row.acc ?? row.Accuracy,
        wpm: row.wpm ?? row.WPM,
      };
    });
  }

  async function listTopPlayers(tp = "season", metric = "points", limit = 100) {
    const lb = await getLeaderboard(metric, tp);
    const names = lb.map((e) => e.name).filter(Boolean);
    return names.slice(0, limit);
  }

  async function getUserStat(user, metric, tp = "season") {
    const lb = await getLeaderboard(metric, tp);
    const u = norm(user);
    const row = lb.find((r) => norm(r.name) === u);
    if (!row) return null;
    if (metric === "accuracy") return toPct(row.accuracy, null);
    if (metric === "wpm") return toInt(row.wpm, null);
    if (metric === "races") return toInt(row.races, null);
    return null;
  }

  // Aggregate activity + points map similar to your Python get_activity_map
  async function getActivityMap(names) {
    names = (names || []).filter(Boolean);
    if (names.length === 0) return {};
    const [ongoingRaw, pointsLB] = await Promise.all([
      apiGet(`/race_sessions/ongoing`),
      getLeaderboard("points", "season"),
    ]);

    const ongoing = new Set(
      extractList(ongoingRaw).map((s) => norm(s.displayName || s.userName || s.username || ""))
    );
    const pointsMap = new Map(pointsLB.map((r) => [norm(r.name), toInt(r.points, 0)]));

    const out = {};
    for (const n of names) {
      const key = norm(n);
      const pts = pointsMap.get(key) ?? 0;
      const status = ongoing.has(key) ? "Yes" : (pointsMap.has(key) ? "No" : "???");
      out[n] = [pts, status];
    }
    return out;
  }

  async function getPointsAndNeighbors(currentUser, targetUser, tp = "season") {
    const lb = await getLeaderboard("points", tp);
    const u = norm(currentUser);
    const t = norm(targetUser);

    let userPoints = null, userRank = null, targetPoints = null, idx = -1;
    for (let i = 0; i < lb.length; i++) {
      const r = lb[i];
      const n = norm(r.name);
      if (n === u) { userPoints = toInt(r.points, null); userRank = r.rank ?? (i + 1); idx = i; }
      if (n === t) targetPoints = toInt(r.points, null);
      if (userPoints != null && targetPoints != null && userRank != null) break;
    }

    const gapStr = (userPoints != null && targetPoints != null)
      ? `${Math.abs(targetPoints - userPoints).toLocaleString()} pts`
      : "Not found";

    const above = idx > 0 ? lb[idx - 1] : null;
    const below = idx >= 0 && idx < lb.length - 1 ? lb[idx + 1] : null;

    const neigh = {
      above: above ? { name: above.name, points: toInt(above.points, null) } : null,
      below: below ? { name: below.name, points: toInt(below.points, null) } : null,
    };

    return { userPoints, targetPoints, gapStr, userRank, neighbors: neigh };
  }

  async function isActive(user) {
    const data = await apiGet(`/race_sessions/ongoing`);
    const list = extractList(data);
    return list.some((r) => sameUserLike(r, user)) ? "Yes" : "No";
  }

// --------------------- UI ---------------------
GM_addStyle(`
  .kcp-wrap { position: fixed; z-index: 2147483647; pointer-events: none; }
  .kcp-panel { pointer-events: auto; color: #fff; font-family: 'Orbitron', system-ui, sans-serif;
               background: rgba(0,0,0,0.65); border-radius: 16px; padding: 12px 14px; border: 2px solid ${S.theme};
               box-shadow: 0 8px 24px rgba(0,0,0,0.35); }

  .kcp-title { font-size: 14px; opacity: 0.9; margin: -6px -10px 6px -10px; padding: 6px 10px;
               background: rgba(255,255,255,0.06); border-radius: 12px; cursor: move; user-select: none; }
  .kcp-mono  { font-family: Consolas, ui-monospace, SFMono-Regular, Menlo, monospace; }
  .kcp-row   { line-height: 1.35; font-size: 13px; white-space: pre-wrap; }

  .kcp-left  { left: 24px; top: 120px; width: 360px; }
  .kcp-right { right: 24px; top: 260px; width: 360px; }

  /* Settings becomes hidden by default and opened via a small FAB */
  .kcp-settings { position: fixed; left: 24px; bottom: 76px; width: 500px; display: none; }
  .kcp-settings.kcp-open { display: block; }
  .kcp-settings .kcp-inline { margin-top: 8px; }

  /* Small floating gear button */
  .kcp-fab { position: fixed; left: 24px; bottom: 24px; pointer-events: auto;
             height: 44px; width: 44px; border-radius: 9999px; display: grid; place-items: center;
             background: rgba(0,0,0,0.7); border: 2px solid ${S.theme}; color: #fff; cursor: pointer;
             box-shadow: 0 8px 24px rgba(0,0,0,0.35); user-select: none; }
  .kcp-fab:hover { filter: brightness(1.1); }

  /* Progress bar: truly centered and responsive */
  .kcp-progress { position: fixed; left: 50%; transform: translateX(-50%);
                  bottom: 12px; width: min(700px, 90vw); height: 40px; pointer-events: auto; }
  .kcp-bar   { width: 100%; height: 100%; border-radius: 12px; background: rgba(0,0,0,0.65);
               border: 2px solid ${S.theme}; box-shadow: 0 8px 24px rgba(0,0,0,0.35);
               overflow: hidden; position: relative; }
  .kcp-bar-fill { position: absolute; left: 8px; top: 8px; bottom: 8px; width: 0; background: #ff4444;
                  border-radius: 8px; transition: width 0.25s; }
  .kcp-bar-text { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); color: #fff; font-size: 12px; }

  .kcp-btn { cursor: pointer; user-select: none; color: #fff; background: rgba(0,0,0,0.65);
             border: 2px solid ${S.theme}; border-radius: 12px; padding: 8px 12px; font-size: 13px; }
  .kcp-select { margin-left: 8px; background: #1a1a1a; color: #fff; border: 1px solid #333; border-radius: 8px; padding: 4px 6px; }
  .kcp-inline { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; }

  .kcp-status { position: fixed; left: 24px; top: 340px; width: 500px; }
  .kcp-line { height: 1px; background: #555; margin: 8px 0; opacity: .8; }
  .kcp-small { font-size: 12px; opacity: .9; }
  .kcp-rankcard { display: grid; grid-template-columns: 64px 1fr; gap: 10px; align-items: center; margin-bottom: 8px; }
  .kcp-rankimg  { width: 64px; height: 64px; border-radius: 12px; background: rgba(255,255,255,0.06);
                display: grid; place-items: center; font-size: 28px; }
  .kcp-ranktxt  { line-height: 1.2; }
  .kcp-rankname { font-weight: 700; }
  .kcp-ranksub  { opacity: .9; font-size: 12px; }
`);

// Rank HUD card (top of left panel)
const $rankCard = div("kcp-rankcard");
const $rankImg = div("kcp-rankimg", "🏅");
const $rankTxt = div("kcp-ranktxt");
const $rankName = div("kcp-rankname", "Unranked");
const $rankSub = div("kcp-ranksub", "");
$rankTxt.append($rankName, $rankSub);
$rankCard.append($rankImg, $rankTxt);

// Build panels FIRST
const $wrapL = div(["kcp-wrap", "kcp-left", "kcp-panel"]);
const $wrapR = div(["kcp-wrap", "kcp-right", "kcp-panel"]);
const $progress = div(["kcp-progress"]);
const $bar = div(["kcp-bar"]);
const $barFill = div(["kcp-bar-fill"]);
const $barText = div(["kcp-bar-text"], "Progress: 0%");

const $settings = div(["kcp-settings", "kcp-panel"]);
const $titleL = div(["kcp-title"], "🧠 Your Stats");
const $titleR = div(["kcp-title"], "🔥 Target Tracker");
const $rowsL = div(["kcp-row", "kcp-mono"]);
const $rowsR = div(["kcp-row", "kcp-mono"]);

// Racers Nearby (define BEFORE watcher uses it)
const $status = div(["kcp-wrap", "kcp-panel", "kcp-status"]);
const $titleS = div(["kcp-title"], "🚗 Racers Nearby");
const $rowsS = div(["kcp-row", "kcp-mono"]);
$status.append($titleS, $rowsS);

// Floating gear button (less intrusive entry point for settings)
const $fab = div(null);
$fab.className = "kcp-fab";
$fab.title = "KCP Settings";
$fab.textContent = "⚙️";
document.body.appendChild($fab);

// Toggle panel
$fab.addEventListener("click", () => {
  $settings.classList.toggle("kcp-open");
});

// Optional close button at top-right of settings panel
const $closeBtn = button("Close");
$closeBtn.style.float = "right";
$closeBtn.addEventListener("click", () => $settings.classList.remove("kcp-open"));
$settings.prepend($closeBtn);


// Attach to DOM BEFORE starting watcher
document.body.append($wrapL, $wrapR, $progress, $settings, $status);
$wrapL.append($titleL, $rankCard, $rowsL);
$wrapR.append($titleR, $rowsR);
$progress.append($bar);
$bar.append($barFill, $barText);

// Draggable + saved positions
$titleL.style.cursor = "move";
$titleR.style.cursor = "move";
$titleS.style.cursor = "move";
applySavedPos($wrapL, "kcp_pos_left", { left: "24px", top: "120px" });
applySavedPos($wrapR, "kcp_pos_right", { right: "24px", top: "260px" });
applySavedPos($status, "kcp_pos_status", { left: "24px", top: "340px" });

//progress bar positioning
function centerProgressBar() {
  // lock to center
  $progress.style.left = "50%";
  $progress.style.right = "";
  $progress.style.transform = "translateX(-50%)";
}
if (S.autoCenterProgress) {
  centerProgressBar();
  window.addEventListener("resize", () => {
    if (S.autoCenterProgress) centerProgressBar();
  });
}
makeDraggable($progress, $barText, "kcp_pos_progress", () => {
  // onDragStart
  GM_setValue("kcp_progress_autocenter", false);
  S.autoCenterProgress = false;
  // remove the transform so absolute left/top apply cleanly
  $progress.style.transform = "";
});

GM_registerMenuCommand("Progress Bar: Re-center & lock", () => {
  GM_setValue("kcp_progress_autocenter", true);
  S.autoCenterProgress = true;
  centerProgressBar();
  alert("Progress bar re-centered and locked to center.");
});

if (S.autoCenterProgress) {
  centerProgressBar();
} else {
  applySavedPos($progress, "kcp_pos_progress", { left: "calc(50% - 300px)", top: "calc(100vh - 52px)" });
}

makeDraggable($wrapL, $titleL, "kcp_pos_left");
makeDraggable($wrapR, $titleR, "kcp_pos_right");
makeDraggable($status, $titleS, "kcp_pos_status");
makeDraggable($progress, $barText, "kcp_pos_progress");

// ---------- PAGE WATCHER (now safe) ----------
function isRaceOrLobbyPath() {
  const p = location.pathname || "";
  return /^\/(race|lobbies)(\/|$)/i.test(p);
}
function ensureHudMounted() {
  const b = document.body;
  if (!b) return;
  if ($wrapL && !$wrapL.isConnected) b.appendChild($wrapL);
  if ($wrapR && !$wrapR.isConnected) b.appendChild($wrapR);
  if ($progress && !$progress.isConnected) b.appendChild($progress);
  if ($settings && !$settings.isConnected) b.appendChild($settings);
  if ($status && !$status.isConnected) b.appendChild($status); // null-guard added
}
function setHudVisible(visible) {
  const disp = visible ? "" : "none";
  $wrapL.style.display = disp;
  $wrapR.style.display = disp;
  $progress.style.display = disp;
  $settings.style.display = disp;
  $status.style.display = disp;
}
function refreshHudVisibility() {
  ensureHudMounted();
  setHudVisible(isRaceOrLobbyPath());
}
function hookHistoryNavigation(onChange) {
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) { const ret = origPush.apply(this, args); try { onChange(); } catch {} return ret; };
  history.replaceState = function (...args) { const ret = origReplace.apply(this, args); try { onChange(); } catch {} return ret; };
  window.addEventListener("popstate", onChange);
}
let kcpDomObserver = null;
function startDomObserver() {
  if (kcpDomObserver) return;
  kcpDomObserver = new MutationObserver(() => { Promise.resolve().then(refreshHudVisibility); });
  kcpDomObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
}
function initPageWatcher() {
  refreshHudVisibility();
  hookHistoryNavigation(refreshHudVisibility);
  startDomObserver();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshHudVisibility(); });
  setInterval(refreshHudVisibility, 4000);
}
initPageWatcher();

  // Racers Nearby (above/below + activity)
  $status.append($titleS, $rowsS);

  document.body.append($wrapL, $wrapR, $progress, $settings, $status);
  $wrapL.append($titleL, $rowsL);
  $wrapR.append($titleR, $rowsR);
  $progress.append($bar);
  $bar.append($barFill, $barText);

  // Draggable + saved positions
  $titleL.style.cursor = "move";
  $titleR.style.cursor = "move";
  $titleS.style.cursor = "move";
  applySavedPos($wrapL, "kcp_pos_left", { left: "24px", top: "120px" });
  applySavedPos($wrapR, "kcp_pos_right", { right: "24px", top: "260px" });
  applySavedPos($status, "kcp_pos_status", { left: "24px", top: "340px" });
  applySavedPos($progress, "kcp_pos_progress", { left: "calc(50% - 300px)", top: "calc(100vh - 52px)" });
  makeDraggable($wrapL, $titleL, "kcp_pos_left");
  makeDraggable($wrapR, $titleR, "kcp_pos_right");
  makeDraggable($status, $titleS, "kcp_pos_status");
  makeDraggable($progress, $barText, "kcp_pos_progress");

  // Settings content
  const $setThemeBtn = button("Change Theme");
  const $curInput = input(S.currentUser, "Your user");
  const $tgtSelect = select([], S.targetUser);
  const $applyUsers = button("Save Users");

  $settings.append(
    rowInline("Theme:", $setThemeBtn),
    rowInline("You:", $curInput),
    rowInline("Track:", $tgtSelect),
    $applyUsers
  );

  $setThemeBtn.onclick = () => {
    const v = prompt("Hex color (e.g., #031920):", S.theme);
    if (!v) return;
    S.theme = v.trim();
    GM_setValue("kcp_theme", S.theme);
    repaintPanels();
  };
  $applyUsers.onclick = () => {
    S.currentUser = $curInput.value.trim();
    S.targetUser = $tgtSelect.value.trim();
    GM_setValue("kcp_current_user", S.currentUser);
    GM_setValue("kcp_target_user", S.targetUser);
    alert("Saved.");
  };

  function repaintPanels() {
    GM_addStyle(`
      .kcp-panel { border-color: ${S.theme} !important; }
      .kcp-bar   { border-color: ${S.theme} !important; }
      .kcp-btn   { border-color: ${S.theme} !important; }
    `);
  }

  // --------------------- Live Loop ---------------------
  let lastUserPoints = 0;
  let lastGain = 0;

  async function populateTargetList() {
    const list = await listTopPlayers("season", "points", 100);
    const names = (list || []).filter(Boolean);
    if (S.targetUser && !names.some((n) => norm(n) === norm(S.targetUser))) names.unshift(S.targetUser);
    $tgtSelect.replaceChildren(...names.map((n) => option(n, n, norm(n) === norm(S.targetUser))));
  }

  function computePointsGain(wpm, acc) {
    // Blend function mirrored from desktop HUD
    const ACC = toFloat(acc, 0);
    const WPM = toFloat(wpm, 0);
    const val = (100 + WPM * 2) * (100 - ((100 - ACC) * 5)) / 100;
    return Math.max(val, 1);
  }

  function updateProgressBar(up, tp) {
    const totalW = 600, padding = 8;
    const innerW = totalW - 2 * padding;
    if (up != null && tp != null && tp > 0) {
      const ratio = Math.min(Math.max(up / tp, 0), 1);
      const pct = Math.round(ratio * 100);
      const fillW = Math.floor(innerW * ratio);
      $barFill.style.width = `${fillW}px`;
      $barFill.style.background = ratio > 0.75 ? "#00ff5f" : ratio > 0.5 ? "#ffaa00" : "#ff4444";
      $barText.textContent = `Progress: ${pct}%`;
    } else {
      $barFill.style.width = `0px`;
      $barFill.style.background = "#ff4444";
      $barText.textContent = `Progress: ??%`;
    }
  }


// ----------------------Utils---------------------------------

// Map medal keys -> filenames (one per tier)
const MEDAL_FILES = {
  "Architect":   "medal_architect.png",
  "Tester":      "medal_tester.png",
  "Primordial":  "medal_primordial.png",
  "Champion":    "medal_champion.png",
  "Ascendant":   "medal_ascendant.png",
  "Celestial":   "medal_celestial.png",
  "Grandmaster": "medal_grandmaster.png",
  "Elite":       "medal_elite.png",
  "Prodigy":     "medal_prodigy.png",
  "Rising Star": "medal_rising.png",
  "Unranked":    "medal_unranked.png",
};

// ----- Rank logic -----
function getMedalLabel(rank, user) {
  if (user === "🔥The𝒲𝓇𝒾𝓉𝒾𝓃𝑔𝔽𝕠𝕩🔥") return "Primordial ✦ The First Flame";
  if (rank == null) return "Unranked";
  if (rank === 1) return "Champion ✦ Ultimate";
  if (rank === 2) return "Ascendant ✦ Ultimate";
  if (rank === 3) return "Celestial ✦ Ultimate";
  if (rank >= 4 && rank <= 6) return "Grandmaster ✦ Tier I";
  if (rank >= 7 && rank <= 8) return "Grandmaster ✦ Tier II";
  if (rank >= 9 && rank <= 10) return "Grandmaster ✦ Tier III";
  if (rank >= 11 && rank <= 15) return "Elite ✦ Tier I";
  if (rank >= 16 && rank <= 20) return "Elite ✦ Tier II";
  if (rank >= 21 && rank <= 25) return "Elite ✦ Tier III";
  if (rank >= 26 && rank <= 33) return "Prodigy ✦ Tier I";
  if (rank >= 34 && rank <= 41) return "Prodigy ✦ Tier II";
  if (rank >= 42 && rank <= 50) return "Prodigy ✦ Tier III";
  if (rank >= 51 && rank <= 65) return "Rising Star ✦ Tier I";
  if (rank >= 66 && rank <= 80) return "Rising Star ✦ Tier II";
  if (rank >= 81 && rank <= 100) return "Rising Star ✦ Tier III";
  return "Unranked";
}
function getMedalSymbol(rank, user) {
  if (user === "🔥The𝒲𝓇𝒾𝓃𝑔𝔽𝕠𝕩🔥") return "Primordial";
  if (rank == null) return null;
  if (rank === 1) return "Champion of Klavia";
  if (rank === 2) return "Ascendant";
  if (rank === 3) return "Celestial";
  if (rank >= 4 && rank <= 8) return "Grandmaster";
  if (rank >= 9 && rank <= 10) return "Grandmaster";
  if (rank >= 11 && rank <= 25) return "Elite Racer";
  if (rank >= 26 && rank <= 50) return "Prodigy Tier";
  if (rank >= 51 && rank <= 100) return "Rising Star";
  return "Unranked";
}
function getMedalImageKey(rank, user) {
  if (user === "🔥The𝒲𝓇𝒾𝓃𝑔𝔽𝕠𝕩🔥") return "Primordial";
  if (rank == null || rank > 100) return "Unranked";
  if (rank === 1) return "Champion";
  if (rank === 2) return "Ascendant";
  if (rank === 3) return "Celestial";
  if (rank >= 4 && rank <= 10) return "Grandmaster";
  if (rank >= 11 && rank <= 25) return "Elite";
  if (rank >= 26 && rank <= 50) return "Prodigy";
  if (rank >= 51 && rank <= 100) return "Rising Star";
  return "Unranked";
}

// Try embedded → hosted base URL → emoji fallback
function loadMedalImage(key) {
  const file = MEDAL_FILES[key];
  if (!file) return null;

  // Embedded (only if you pasted EMBEDDED_MEDALS above)
  if (typeof EMBEDDED_MEDALS !== "undefined" && EMBEDDED_MEDALS[file]) {
    const img = new Image();
    img.src = EMBEDDED_MEDALS[file];
    return img;
  }

  // Hosted (optional)
  if (S.medalBaseUrl) {
    const url = `${S.medalBaseUrl.replace(/\/+$/,'')}/${file}`;
    const img = new Image();
    img.src = url;
    return img;
  }

  return null; // will use emoji fallback
}


function updateRankHUD(rank, user) {
  const label  = getMedalLabel(rank, user);
  const symbol = getMedalSymbol(rank, user) || "";
  const key    = getMedalImageKey(rank, user);

  $rankName.textContent = label;
  $rankSub.textContent  = symbol;

  const img = loadMedalImage(key);
  if (img) {
    // set as background
    $rankImg.textContent = "";
    $rankImg.style.backgroundImage = `url("${img.src}")`;
    $rankImg.style.backgroundSize = "cover";
    $rankImg.style.backgroundPosition = "center";
  } else {
    // emoji fallback per tier
    const emoji = key === "Champion"   ? "👑"
                : key === "Ascendant"  ? "🚀"
                : key === "Celestial"  ? "🌟"
                : key === "Grandmaster"? "🛡️"
                : key === "Elite"      ? "⚔️"
                : key === "Prodigy"    ? "🎖️"
                : key === "Rising Star"? "⭐"
                : "🏅";
    $rankImg.textContent = emoji;
    $rankImg.style.backgroundImage = "";
  }
}




  async function loop() {
    if (!S.currentUser) {
      $rowsL.textContent = "Set your username via the panel or Tampermonkey menu.";
      await sleep(1500); return loop();
    }
    if (!S.token) {
      $rowsL.textContent = "Set your API token via Tampermonkey menu.";
      await sleep(1500); return loop();
    }

    try {
      // Pull points/rank + neighbors in one pass
      const { userPoints: up, targetPoints: tp, gapStr, userRank, neighbors } =
        await getPointsAndNeighbors(S.currentUser, S.targetUser, "season");

      // Track last gain like the desktop HUD
      if (Number.isFinite(up)) {
        if (up > lastUserPoints) lastGain = up - lastUserPoints;
        lastUserPoints = up;
      }

      // Batch stats & activity for your user and neighbors (reduces calls)
      const [wpm, acc, races] = await Promise.all([
        getUserStat(S.currentUser, "wpm", S.wpmTp),
        getUserStat(S.currentUser, "accuracy", S.accTp),
        getUserStat(S.currentUser, "races", S.racesTp),
      ]);

      const activityMap = await getActivityMap([
        S.currentUser,
        neighbors?.above?.name,
        neighbors?.below?.name,
        S.targetUser,
      ]);

      const myActive = (activityMap[S.currentUser]?.[1]) || "⏳";
      const aboveActive = neighbors?.above?.name ? (activityMap[neighbors.above.name]?.[1] || "⏳") : null;
      const belowActive = neighbors?.below?.name ? (activityMap[neighbors.below.name]?.[1] || "⏳") : null;

      const WPM = toInt(wpm, 0);
      const ACC = toPct(acc, 0.0);
      const RACES = toInt(races, 0);

      const gainPerRace = computePointsGain(WPM, ACC);
      const pointsNeeded = (Number.isFinite(up) && Number.isFinite(tp)) ? Math.max(tp - up + 1, 0) : 0;
      const racesNeeded = gainPerRace > 0 ? Math.ceil(pointsNeeded / gainPerRace) : 0;

      // Left panel (Your Stats)
      $rowsL.textContent =
        `Points: ${Number.isFinite(up) ? up.toLocaleString() : "—"}\n` +
        `Channel K Season Races: ${RACES}\n` +
        `WPM Leaderboard (${S.wpmTp}): ${WPM}\n` +
        `Accuracy Leaderboard (${S.accTp}): ${ACC}%\n` +
        `Last Race Gain: ${lastGain.toLocaleString()}\n` +
        `Status: ${myActive === "Yes" ? "✅ Active" : myActive === "No" ? "❌ Idle" : "⏳ Unknown"}\n` +
        (userRank ? `Rank: ${userRank}` : "");
updateRankHUD(userRank, S.currentUser);

      // Right panel (Target)
      $rowsR.textContent =
        `Target: ${S.targetUser}\n` +
        `Points: ${Number.isFinite(tp) ? tp.toLocaleString() : "—"}\n` +
        `Race Gap: ${gapStr}\n` +
        `Races Needed: ${Number.isFinite(up) && Number.isFinite(tp) ? racesNeeded : "—"}\n` +
        `Refresh: 2s`;

      // Nearby racers block
      let lines = ["Racers\n"];
      if (neighbors?.above?.name) {
        lines.push(
          `Racer Above: ${neighbors.above.name} • ${Number.isFinite(neighbors.above.points) ? neighbors.above.points.toLocaleString() + " pts" : "—"} • ${
            aboveActive === "Yes" ? "✅ Active" : aboveActive === "No" ? "❌ Inactive" : "⏳ Unknown"
          }`
        );
      } else {
        lines.push("Racer Above: —");
      }
      lines.push(""); // spacer
      if (neighbors?.below?.name) {
        lines.push(
          `Racer Below: ${neighbors.below.name} • ${Number.isFinite(neighbors.below.points) ? neighbors.below.points.toLocaleString() + " pts" : "—"} • ${
            belowActive === "Yes" ? "✅ Active" : belowActive === "No" ? "❌ Inactive" : "⏳ Unknown"
          }`
        );
      } else {
        lines.push("Racer Below: —");
      }
      $rowsS.textContent = lines.join("\n");

      updateProgressBar(up, tp);
    } catch (e) {
      console.error("[KCP] Loop error:", e);
      $rowsL.textContent = "Error fetching data. Check console.";
    }

    await sleep(2000);
    loop();
  }

  // Populate target options and start
  populateTargetList().then(() => {
    if (![...$tgtSelect.options].some(o => norm(o.value) === norm(S.targetUser))) {
      $tgtSelect.append(option(S.targetUser, S.targetUser, true));
    }
  });
  loop();

  // --------------------- Position Save/Drag Helpers ---------------------
  function loadPos(key, fallback) {
    const k = `${location.hostname}:${key}`;
    return GM_getValue(k, fallback);
  }
  function savePos(key, css) {
    const k = `${location.hostname}:${key}`;
    GM_setValue(k, css);
  }
 function makeDraggable(containerEl, handleEl, storageKey, onStart) {
  let startX=0, startY=0, startLeft=0, startTop=0, dragging=false;
  const onDown = (e) => {
    dragging = true;
    if (typeof onStart === "function") onStart();
    const rect = containerEl.getBoundingClientRect();
    startLeft = rect.left + window.scrollX;
    startTop = rect.top + window.scrollY;
    startX = e.clientX; startY = e.clientY;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    containerEl.style.left = `${startLeft + dx}px`;
    containerEl.style.top = `${startTop + dy}px`;
    containerEl.style.right = "";
  };
  const onUp = () => {
    dragging = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const rect = containerEl.getBoundingClientRect();
    savePos(storageKey, { left: `${Math.round(rect.left + window.scrollX)}px`, top: `${Math.round(rect.top + window.scrollY)}px` });
  };
  handleEl.addEventListener('mousedown', onDown);
}

  function applySavedPos(el, storageKey, defaults) {
    const p = loadPos(storageKey, defaults);
    if (p.right) el.style.right = p.right; else el.style.left = p.left;
    el.style.top = p.top;
  }

  // --------------------- Mini DOM helpers ---------------------
  function div(cls, text) {
    const d = document.createElement("div");
    if (Array.isArray(cls)) d.className = cls.join(" ");
    else if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }
  function button(text) {
    const b = document.createElement("button");
    b.textContent = text;
    b.className = "kcp-btn";
    return b;
  }
  function input(value, placeholder) {
    const i = document.createElement("input");
    i.value = value || "";
    i.placeholder = placeholder || "";
    i.className = "kcp-select";
    i.style.minWidth = "160px";
    return i;
  }
  function select(items, selected) {
    const s = document.createElement("select");
    s.className = "kcp-select";
    for (const it of items) s.append(option(it, it, norm(it) === norm(selected)));
    return s;
  }
  function option(label, value, sel) {
    const o = document.createElement("option");
    o.textContent = label;
    o.value = value;
    if (sel) o.selected = true;
    return o;
  }
  function rowInline(label, node) {
    const w = div(["kcp-inline"]);
    w.append(div(null, label), node);
    return w;
  }
})();
