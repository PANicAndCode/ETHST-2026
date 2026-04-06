const COOLDOWN_MINUTES = 10;
const BASE_HINTS = 3;
const STORAGE_PREFIX = "sigtau-easter-hunt-v1";
const REMEMBERED_TEAM_KEY = `${STORAGE_PREFIX}-remembered-team`;
const REMEMBERED_TEAM_STARTED_KEY = `${STORAGE_PREFIX}-remembered-team-started`;
const ADMIN_PASSCODE = "bunnyboss";
const MAP_ENABLED_KEY = `${STORAGE_PREFIX}-map-enabled`;
const SHARED_SETTINGS_TEAM_ID = "__settings__";

let teamKey = null;
let state = null;
let now = Date.now();
let supabaseReady = false;
let supabaseClient = null;
let liveBoardCache = {};
let liveProgressCache = {};
let fileQrScanner = null;
let cameraStream = null;
let capturedCanvas = null;
let mapEnabled = localMapEnabled();

function el(id){ return document.getElementById(id); }
function storageKey(team){ return `${STORAGE_PREFIX}-${team}`; }
function leaderboardKey(){ return `${STORAGE_PREFIX}-leaderboard`; }
function rememberedTeamRecord(){
  const saved = localStorage.getItem(REMEMBERED_TEAM_KEY);
  if (!saved || !TEAMS[saved]) return null;
  const startedRaw = localStorage.getItem(REMEMBERED_TEAM_STARTED_KEY);
  return { team: saved, startedAt: startedRaw ? Number(startedRaw) : 0 };
}
function rememberedTeam(){
  return rememberedTeamRecord()?.team || null;
}
function rememberTeam(team, startedAt){
  if (!team || !TEAMS[team]) return;
  localStorage.setItem(REMEMBERED_TEAM_KEY, team);
  localStorage.setItem(REMEMBERED_TEAM_STARTED_KEY, String(Number(startedAt) || 0));
}
function clearRememberedTeam(team){
  const saved = localStorage.getItem(REMEMBERED_TEAM_KEY);
  if (!team || saved === team){
    localStorage.removeItem(REMEMBERED_TEAM_KEY);
    localStorage.removeItem(REMEMBERED_TEAM_STARTED_KEY);
  }
}
function releaseTeamSelection(message){
  clearRememberedTeam();
  teamKey = null;
  state = null;
  stopCamera();
  hideAdminOverlay();
  hideAdminPanel();
  hideVictoryOverlay();
  if (el("teamGate")) el("teamGate").classList.remove("hidden");
  renderGateTeams(null);
  setGateNameLock(false, "");
  if (el("gateTeamName")) el("gateTeamName").value = "";
  if (message) setFeedback(message);
}
function clueStatusForTeam(team){
  const progress = liveProgressCache[team] || loadLocalState(team);
  if (!progress) return "Not started";
  if (progress.finished) return "Finished";
  const clueId = TEAMS[team]?.sequence?.[progress.progressIndex];
  if (!clueId) return "Finished";
  return `On clue ${progress.progressIndex + 1}: ${CLUES[clueId]?.location || `Clue ${clueId}`}`;
}
function toMillis(value){
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function hintStats(targetState = state){
  const usedRaw = Number(targetState?.usedHints || 0);
  const total = BASE_HINTS + Math.max(0, -usedRaw);
  const remaining = Math.max(0, BASE_HINTS - usedRaw);
  const usedDisplay = Math.max(0, total - remaining);
  return { usedRaw, usedDisplay, total, remaining };
}

function revealedHintForClue(targetState = state, team = teamKey){
  const activeId = currentClueId(targetState, team);
  return !!(activeId && targetState && Number(targetState.revealedHintClueId) === Number(activeId));
}

function currentClueId(targetState = state, team = teamKey){
  return team && targetState ? TEAMS[team]?.sequence?.[targetState.progressIndex] : null;
}

function hasTeamBeenClaimed(progress, team){
  if (!progress) return false;
  const joined = Number(progress.startedAt || 0) > 0
    || Number(progress.progressIndex || 0) > 0
    || (Array.isArray(progress.completed) && progress.completed.length > 0)
    || !!progress.finished;
  const displayName = (progress.teamName || "").trim();
  return joined || (!!displayName && displayName !== TEAMS[team].label);
}

function clueAllowsHint(clueId){
  const clue = clueId ? CLUES[clueId] : null;
  return !!(clue && clue.hint && !clue.noHint);
}


function localMapEnabled(){
  const raw = localStorage.getItem(MAP_ENABLED_KEY);
  return raw === null ? true : raw === "true";
}

function setLocalMapEnabled(value){
  mapEnabled = !!value;
  localStorage.setItem(MAP_ENABLED_KEY, String(mapEnabled));
}

function sharedSettingsState(){
  const remote = liveProgressCache[SHARED_SETTINGS_TEAM_ID];
  if (remote && typeof remote.mapEnabled === "boolean") return remote;
  return { mapEnabled: localMapEnabled() };
}

function isMapEnabled(){
  const shared = sharedSettingsState();
  return typeof shared.mapEnabled === "boolean" ? shared.mapEnabled : true;
}

async function pushSharedSettings(){
  if (!supabaseReady) return;
  const payload = {
    team_id: SHARED_SETTINGS_TEAM_ID,
    team_name: "Shared Settings",
    progress_index: 0,
    completed: [],
    scanned_tokens: [],
    used_hints: 0,
    next_hint_at: null,
    finished: false,
    started_at: Date.now(),
    last_updated_at: Date.now(),
    map_enabled: !!mapEnabled
  };
  await supabaseClient.from("team_progress_sigtau").upsert(payload, { onConflict: "team_id" });
}

function updateAdminMapButton(){
  const btn = el("adminToggleMapBtn");
  if (!btn) return;
  btn.textContent = isMapEnabled() ? "Turn map off for everyone" : "Turn map on for everyone";
}

function applyMapVisibility(){
  const enabled = isMapEnabled();
  const mapPage = el("mapPage");
  const mapCard = mapPage ? mapPage.querySelector("#mapCard") : null;
  const grid = mapPage ? mapPage.querySelector("#mapPageGrid") : null;
  const navBtn = document.querySelector('.menuBtn[data-page="mapPage"]');
  if (mapCard) mapCard.classList.toggle("hidden", !enabled);
  if (grid) grid.classList.toggle("mapPageLeaderboardOnly", !enabled);
  if (navBtn) navBtn.textContent = enabled ? "Map & Leaderboard" : "Leaderboard";
  updateAdminMapButton();
}

function defaultState(teamLabel){
  return {
    teamName: teamLabel,
    progressIndex: 0,
    completed: [],
    scannedTokens: [],
    usedHints: 0,
    nextHintAt: null,
    revealedHintClueId: null,
    finished: false,
    startedAt: Date.now(),
    lastUpdatedAt: Date.now()
  };
}

function readJson(key, fallback){
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error){
    console.error(error);
    return fallback;
  }
}

function loadLocalState(team){
  const saved = readJson(storageKey(team), defaultState(TEAMS[team].label));
  if (saved && typeof saved.revealedHintClueId === "undefined") saved.revealedHintClueId = null;
  return saved;
}

function saveLocalState(){
  if (teamKey && state) localStorage.setItem(storageKey(teamKey), JSON.stringify(state));
}

function saveLocalBoard(){
  if (!teamKey || !state) return;
  const board = readJson(leaderboardKey(), {});
  board[teamKey] = { teamName: state.teamName, found: state.completed.length, finished: state.finished, lastUpdatedAt: state.lastUpdatedAt };
  localStorage.setItem(leaderboardKey(), JSON.stringify(board));
}

function compareBoardRows(a, b){
  if (!!a.finished !== !!b.finished) return a.finished ? -1 : 1;
  if (a.finished && b.finished){
    return (toMillis(a.lastUpdatedAt) - toMillis(b.lastUpdatedAt))
      || (b.found - a.found)
      || a.teamName.localeCompare(b.teamName);
  }
  return (b.found - a.found)
    || (toMillis(a.lastUpdatedAt) - toMillis(b.lastUpdatedAt))
    || a.teamName.localeCompare(b.teamName);
}

function localBoardRows(){
  const board = readJson(leaderboardKey(), {});
  return Object.entries(TEAMS).map(([key, t]) => ({
    key,
    teamName: board[key]?.teamName || t.label,
    found: board[key]?.found || 0,
    finished: board[key]?.finished || false,
    lastUpdatedAt: board[key]?.lastUpdatedAt || 0
  })).sort(compareBoardRows);
}

function remoteBoardRows(){
  return Object.entries(TEAMS).map(([key, t]) => ({
    key,
    teamName: liveBoardCache[key]?.team_name || t.label,
    found: liveBoardCache[key]?.found || 0,
    finished: liveBoardCache[key]?.finished || false,
    lastUpdatedAt: liveBoardCache[key]?.last_updated_at || 0
  })).sort(compareBoardRows);
}

function boardRows(){
  return supabaseReady ? remoteBoardRows() : localBoardRows();
}

function teamTotal(team = teamKey){
  return TEAMS[team]?.sequence?.length || 0;
}

function isReadyForVictory(targetState, team = teamKey){
  return !!targetState && targetState.finished;
}

function isOnFinalClue(targetState, team = teamKey){
  if (!targetState || targetState.finished) return false;
  const activeId = TEAMS[team]?.sequence?.[targetState.progressIndex];
  return Number(activeId) === 11;
}

function ordinalWord(place){
  return ["zeroth", "first", "second", "third", "fourth", "fifth"][place] || `${place}th`;
}

function placementLabel(place){
  return `${ordinalWord(place)} place`;
}

function trophyInfoForPlacement(place){
  if (place === 1) return { icon: "🏆", className: "trophyBadge trophyGold", label: "Gold trophy" };
  if (place === 2) return { icon: "🏆", className: "trophyBadge trophySilver", label: "Silver trophy" };
  if (place === 3) return { icon: "🏆", className: "trophyBadge trophyBronze", label: "Bronze trophy" };
  return null;
}

function finishedPlacementRows(){
  return boardRows().filter(row => row.finished).sort((a, b) => (toMillis(a.lastUpdatedAt) - toMillis(b.lastUpdatedAt)) || a.teamName.localeCompare(b.teamName));
}

function finishPlacementForTeam(team = teamKey){
  const idx = finishedPlacementRows().findIndex(row => row.key === team);
  return idx >= 0 ? idx + 1 : null;
}

function placementPrize(place){
  if (place === 1) return 50;
  if (place === 2) return 20;
  if (place === 3) return 10;
  return 0;
}

function placementPrizeText(place){
  const amount = placementPrize(place);
  if (place === 1) return "1st pick of candy";
  if (place === 2) return "2nd pick of candy";
  if (place === 3) return "3rd pick of candy";
  return "a finish on the board";
}

function finalEggInfo(){
  return CLUES[11] || {
    title: "FINAL EGG: Find the last egg!",
    location: "Final egg location",
    hint: "Find the final egg."
  };
}

function finalEggReadyMessage(){
  return "Your final clue is unlocked. Find the final egg and scan its QR code to finish.";
}

function setFeedback(msg){ if (el("feedbackBox")) el("feedbackBox").textContent = msg; }
function setScanMessage(msg){ if (el("scanMessage")) el("scanMessage").textContent = msg; }
function setScanStatus(status, msg){
  const box = el("scanStatusBox");
  if (!box) return;
  const classMap = {
    idle: "scanStatusIdle",
    checking: "scanStatusChecking",
    correct: "scanStatusSuccess",
    "ready-final-egg": "scanStatusSuccess",
    wrong: "scanStatusError",
    "no-qr": "scanStatusWarn",
    "no-team": "scanStatusError",
    finished: "scanStatusSuccess",
    error: "scanStatusError"
  };
  box.className = `scanStatus ${classMap[status] || "scanStatusChecking"}`;
  box.textContent = msg;
}

function fmtCountdown(ms){
  const secs = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function normalizeRemoteProgress(data){
  if (!data) return null;
  return {
    teamName: data.team_name,
    progressIndex: data.progress_index ?? 0,
    completed: Array.isArray(data.completed) ? data.completed : [],
    scannedTokens: Array.isArray(data.scanned_tokens) ? data.scanned_tokens : [],
    usedHints: data.used_hints ?? 0,
    nextHintAt: data.next_hint_at,
    finished: !!data.finished,
    startedAt: data.started_at,
    lastUpdatedAt: data.last_updated_at,
    revealedHintClueId: data.revealed_hint_clue_id ?? null,
    mapEnabled: typeof data.map_enabled === "boolean" ? data.map_enabled : undefined
  };
}

function cachedRemoteProgress(team){
  return liveProgressCache[team] ? { ...liveProgressCache[team] } : null;
}

function getCachedClaimedTeamName(team){
  const remoteProgress = cachedRemoteProgress(team);
  if (remoteProgress && hasTeamBeenClaimed(remoteProgress, team)) return remoteProgress.teamName;
  const local = loadLocalState(team);
  if (local && hasTeamBeenClaimed(local, team)) return local.teamName;
  return null;
}

let syncPollTimer = null;

function getSupabaseConfig(){
  const cfg = (window.SUPABASE_CONFIG && typeof window.SUPABASE_CONFIG === "object") ? window.SUPABASE_CONFIG : {};
  return {
    url: cfg.url || window.SUPABASE_URL || "",
    anonKey: cfg.anonKey || window.SUPABASE_ANON_KEY || ""
  };
}

function startSharedPolling(){
  if (syncPollTimer) clearInterval(syncPollTimer);
  if (!supabaseReady) return;
  syncPollTimer = setInterval(async () => {
    if (!supabaseReady) return;
    await Promise.allSettled([fetchLeaderboard(), fetchAllRemoteProgress()]);
  }, 4000);
}

function stopSharedPolling(){
  if (!syncPollTimer) return;
  clearInterval(syncPollTimer);
  syncPollTimer = null;
}

function updateSharedModeText(){
  const mode = el("sharedModeText");
  if (!mode) return;
  if (supabaseReady){
    mode.hidden = false;
    mode.style.display = "block";
    mode.textContent = "Shared progress is live across devices.";
  } else {
    mode.hidden = false;
    mode.style.display = "block";
    mode.textContent = "Cross-device sync needs Supabase configured in supabase-config.js.";
  }
}

async function initSupabase(){
  try{
    const supabaseConfig = getSupabaseConfig();
    if (!supabaseConfig.url || !supabaseConfig.anonKey || supabaseConfig.url.startsWith("PASTE_")){
      if (el("leaderboardModeText")){
        el("leaderboardModeText").textContent = "Using local device leaderboard only.";
        el("leaderboardModeText").hidden = false;
        el("leaderboardModeText").style.display = "block";
      }
      updateSharedModeText();
      renderBoard();
      return;
    }
    supabaseClient = window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey);
    supabaseReady = true;
    if (el("leaderboardModeText")){
      el("leaderboardModeText").textContent = "";
      el("leaderboardModeText").hidden = true;
      el("leaderboardModeText").style.display = "none";
    }
    updateSharedModeText();
    await Promise.all([fetchLeaderboard(), fetchAllRemoteProgress()]);
    subscribeLeaderboard();
    subscribeTeamProgress();
    startSharedPolling();
  } catch (error){
    console.error(error);
    supabaseReady = false;
    stopSharedPolling();
    stopSharedPolling();
    if (el("leaderboardModeText")){
      el("leaderboardModeText").textContent = "Using local device leaderboard only.";
      el("leaderboardModeText").hidden = false;
      el("leaderboardModeText").style.display = "block";
    }
    updateSharedModeText();
    renderBoard();
  }
}

async function fetchLeaderboard(){
  if (!supabaseReady) return;
  const { data, error } = await supabaseClient.from("leaderboard_sigtau").select("*");
  if (error){
    console.error(error);
    supabaseReady = false;
    if (el("leaderboardModeText")){
      el("leaderboardModeText").textContent = "Using local device leaderboard only.";
      el("leaderboardModeText").hidden = false;
      el("leaderboardModeText").style.display = "block";
    }
    updateSharedModeText();
    renderBoard();
    return;
  }
  liveBoardCache = {};
  (data || []).forEach(row => liveBoardCache[row.team_id] = row);
  renderBoard();
}

async function fetchAllRemoteProgress(){
  if (!supabaseReady) return;
  const { data, error } = await supabaseClient.from("team_progress_sigtau").select("*");
  if (error){
    console.error(error);
    return;
  }
  liveProgressCache = {};
  (data || []).forEach(row => {
    const normalized = normalizeRemoteProgress(row);
    const local = loadLocalState(row.team_id);
    if (local && Number(local.startedAt || 0) === Number(normalized.startedAt || 0) && Number(local.progressIndex || 0) === Number(normalized.progressIndex || 0) && local.revealedHintClueId != null && normalized.revealedHintClueId == null) {
      normalized.revealedHintClueId = local.revealedHintClueId;
    }
    liveProgressCache[row.team_id] = normalized;
    localStorage.setItem(storageKey(row.team_id), JSON.stringify(normalized));
  });
}

function subscribeLeaderboard(){
  if (!supabaseReady) return;
  supabaseClient.channel("leaderboard-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "leaderboard_sigtau" }, payload => {
      const row = payload.new || payload.old;
      if (!row || !row.team_id) return;
      if (payload.eventType === "DELETE") delete liveBoardCache[row.team_id];
      else liveBoardCache[row.team_id] = row;
      renderBoard();
    }).subscribe();
}

function maybeRefreshGateSelection(){
  if (!teamKey || !el("teamGate") || el("teamGate").classList.contains("hidden")) return;
  const claimedName = getCachedClaimedTeamName(teamKey);
  if (claimedName) setGateNameLock(true, claimedName);
}

function subscribeTeamProgress(){
  if (!supabaseReady) return;
  supabaseClient.channel("team-progress-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "team_progress_sigtau" }, async payload => {
      const row = payload.new || payload.old;
      if (!row || !row.team_id) return;

      if (payload.eventType === "DELETE") {
        delete liveProgressCache[row.team_id];
        localStorage.removeItem(storageKey(row.team_id));
      } else {
        const normalized = normalizeRemoteProgress(row);
        const local = loadLocalState(row.team_id);
        if (local && Number(local.startedAt || 0) === Number(normalized.startedAt || 0) && Number(local.progressIndex || 0) === Number(normalized.progressIndex || 0) && local.revealedHintClueId != null && normalized.revealedHintClueId == null) {
          normalized.revealedHintClueId = local.revealedHintClueId;
        }
        liveProgressCache[row.team_id] = normalized;
        localStorage.setItem(storageKey(row.team_id), JSON.stringify(normalized));

        const remembered = rememberedTeamRecord();
        const startedChanged = remembered && remembered.team === row.team_id
          && Number(remembered.startedAt || 0) > 0
          && Number(normalized.startedAt || 0) > 0
          && Number(remembered.startedAt) !== Number(normalized.startedAt);

        if (startedChanged){
          releaseTeamSelection("That team was reset. Pick a team to join again.");
        } else if (teamKey === row.team_id){
          const incomingTs = toMillis(normalized.lastUpdatedAt);
          const currentTs = toMillis(state?.lastUpdatedAt);
          if (!state || incomingTs >= currentTs){
            state = normalized;
            await renderAll({ persist: false });
          }
        }
      }

      if (el("adminTeamSelect") && el("adminTeamSelect").value === row.team_id) {
        await syncAdminFields();
      }
      maybeRefreshGateSelection();
      renderBoard();
    }).subscribe();
}

async function loadRemoteProgress(team){
  if (!supabaseReady) return null;
  const cached = cachedRemoteProgress(team);
  if (cached) return cached;
  const { data, error } = await supabaseClient.from("team_progress_sigtau").select("*").eq("team_id", team).maybeSingle();
  if (error){
    console.error(error);
    return null;
  }
  const normalized = normalizeRemoteProgress(data);
  if (normalized) {
    const local = loadLocalState(team);
    if (local && Number(local.startedAt || 0) === Number(normalized.startedAt || 0) && Number(local.progressIndex || 0) === Number(normalized.progressIndex || 0) && local.revealedHintClueId != null && normalized.revealedHintClueId == null) {
      normalized.revealedHintClueId = local.revealedHintClueId;
    }
    liveProgressCache[team] = normalized;
    localStorage.setItem(storageKey(team), JSON.stringify(normalized));
  }
  return normalized;
}

async function getClaimedTeamName(team){
  const cached = getCachedClaimedTeamName(team);
  if (cached) return cached;
  const remote = await loadRemoteProgress(team);
  if (remote && remote.teamName && remote.teamName !== TEAMS[team].label) return remote.teamName;
  return null;
}

function setGateNameLock(locked, value){
  const input = el("gateTeamName");
  if (!input) return;
  input.value = value || "";
  input.readOnly = !!locked;
  input.disabled = !!locked;
  input.placeholder = locked ? "Team name already locked" : "Enter team name";
}

async function pushRemoteProgress(){
  if (!supabaseReady || !teamKey || !state) return;
  const payload = {
    team_id: teamKey,
    team_name: state.teamName,
    progress_index: state.progressIndex,
    completed: state.completed,
    scanned_tokens: state.scannedTokens,
    used_hints: state.usedHints,
    next_hint_at: state.nextHintAt,
    finished: state.finished,
    started_at: state.startedAt,
    last_updated_at: state.lastUpdatedAt
  };
  const { error } = await supabaseClient.from("team_progress_sigtau").upsert(payload, { onConflict: "team_id" });
  if (error) console.error(error);
}

async function pushLeaderboard(){
  saveLocalBoard();
  if (!supabaseReady || !teamKey || !state) return;
  const payload = {
    team_id: teamKey,
    team_name: state.teamName,
    found: state.completed.length,
    finished: state.finished,
    last_updated_at: state.lastUpdatedAt
  };
  const { error } = await supabaseClient.from("leaderboard_sigtau").upsert(payload, { onConflict: "team_id" });
  if (error) console.error(error);
}

function setPage(pageId){
  document.querySelectorAll(".page").forEach(p => p.classList.remove("activePage"));
  const page = el(pageId);
  if (page) page.classList.add("activePage");
  document.querySelectorAll(".menuBtn").forEach(btn => btn.classList.toggle("active", btn.dataset.page === pageId));

  if (pageId === "scanPage") {
    const canvas = el("qrCanvas");
    if (!capturedCanvas && (!canvas || canvas.classList.contains("hidden"))) startCamera();
  } else {
    stopCamera();
  }
}

function renderGateTeams(selected){
  const mount = el("gateTeamButtons");
  if (!mount) return;
  mount.innerHTML = "";
  Object.entries(TEAMS).forEach(([key, team]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "teamBtn" + (key === selected ? " selected" : "");
    btn.textContent = team.label;
    btn.addEventListener("click", async () => {
      teamKey = key;
      renderGateTeams(teamKey);
      const claimedName = await getClaimedTeamName(teamKey);
      if (claimedName) {
        setGateNameLock(true, claimedName);
      } else {
        const local = loadLocalState(teamKey);
        setGateNameLock(false, (local && local.teamName && local.teamName !== team.label) ? local.teamName : "");
      }
    });
    mount.appendChild(btn);
  });
}

function renderTop(){
  if (!teamKey || !state) return;
  const total = TEAMS[teamKey].sequence.length;
  const activeId = currentClueId();
  const stats = hintStats(state);
  const locked = clueAllowsHint(activeId) && state.nextHintAt && now < toMillis(state.nextHintAt);
  el("progressCount").textContent = `${state.completed.length} / ${total}`;
  el("progressBar").style.width = `${(state.completed.length / total) * 100}%`;
  el("hintCount").textContent = `${stats.usedDisplay} / ${stats.total}`;
  el("hintStatus").textContent = !clueAllowsHint(activeId)
    ? "No hint for this clue"
    : (locked ? `Next hint in ${fmtCountdown(toMillis(state.nextHintAt) - now)}` : (stats.remaining <= 0 ? "No hints left" : "Hint ready"));
  el("teamDisplay").textContent = `${TEAMS[teamKey].label} • ${state.teamName}`;
}

function renderChores(){
  if (!teamKey || !state) return;
  const seq = TEAMS[teamKey].sequence;
  const list = el("choreList");
  list.innerHTML = "";
  seq.forEach((id, idx) => {
    const div = document.createElement("div");
    div.className = idx < state.progressIndex ? "item complete" : idx === state.progressIndex ? "item active" : "item locked";
    const clue = CLUES[id];
    if (idx < state.progressIndex) {
      div.innerHTML = `<strong>${clue.title}</strong>${clue.subtitle ? `<div class="muted">${clue.subtitle}</div>` : ""}<div class="muted">Found at: <strong>${clue.location}</strong></div>`;
    } else if (idx === state.progressIndex) {
      const activeCopy = isOnFinalClue(state, teamKey)
        ? "Find the final egg, then scan its QR code to finish the hunt."
        : "Find the egg, then scan its QR code to unlock the next chore.";
      div.innerHTML = `<strong>${clue.title}</strong>${clue.subtitle ? `<div class="muted">${clue.subtitle}</div>` : ""}<div class="muted">${activeCopy}</div>`;
    } else {
      div.innerHTML = `<strong>Locked chore</strong><div class="muted">Scan the correct egg to unlock this item.</div>`;
    }
    list.appendChild(div);
  });
}

function renderMap(){
  applyMapVisibility();
  if (!isMapEnabled()) return;
  if (!teamKey || !state) return;
  const seq = TEAMS[teamKey].sequence;
  const mapPins = el("mapPins");
  if (!mapPins) return;
  mapPins.innerHTML = "";
  seq.forEach((id, idx) => {
    if (idx >= state.progressIndex) return;
    const clue = CLUES[id];
    const pin = document.createElement("div");
    pin.className = "pin complete";
    pin.style.left = `${clue.zone.x}%`;
    pin.style.top = `${clue.zone.y}%`;
    pin.textContent = clue.location;
    mapPins.appendChild(pin);
  });
}

function renderHint(){
  if (!teamKey || !state) return;
  const activeId = currentClueId();
  const clue = CLUES[activeId];
  const stats = hintStats(state);
  const canHint = clueAllowsHint(activeId);
  const locked = canHint && state.nextHintAt && now < toMillis(state.nextHintAt);
  const showingHint = revealedHintForClue(state, teamKey);
  el("hintBtn").disabled = !canHint || stats.remaining <= 0 || locked || !clue || showingHint;
  el("hintsLeft").textContent = canHint ? `Hints left: ${stats.remaining}` : "Hints are disabled for this clue.";
  el("hintBox").textContent = !clue
    ? "No active clue."
    : (!canHint ? (clue.hint || "Hints are disabled for this clue.") : (showingHint ? clue.hint : "No hint displayed yet for this active clue."));
  if (locked){
    el("hintTimerPill").hidden = false;
    el("hintTimerPill").textContent = fmtCountdown(toMillis(state.nextHintAt) - now);
  } else {
    el("hintTimerPill").hidden = true;
  }
}

function renderBoard(){
  const board = el("leaderboard");
  if (!board) return;
  board.innerHTML = "";
  boardRows().forEach((row, i) => {
    const place = i + 1;
    const trophy = row.finished ? trophyInfoForPlacement(place) : null;
    const div = document.createElement("div");
    div.className = "leaderRow";
    div.innerHTML = `
      <div class="leaderMain">
        ${trophy ? `<span class="${trophy.className}" aria-label="${trophy.label}">${trophy.icon}</span>` : ""}
        <div class="leaderText">
          <strong>${place}. ${row.teamName}</strong>
          <div class="muted">${row.finished ? `${placementLabel(place)} • ${placementPrizeText(place)}` : (TEAMS[row.key]?.sequence?.[row.found] === 11 ? "Final clue unlocked" : "In progress")}</div>
        </div>
      </div>
      <div class="leaderRight">
        <strong>${row.found}</strong>
        <div class="small">clues found</div>
      </div>`;
    board.appendChild(div);
  });
  renderAdminStatuses();
}

function renderAdminStatuses(){
  const mount = el("adminStatusList");
  if (!mount) return;
  mount.innerHTML = "";
  Object.entries(TEAMS).forEach(([key, team]) => {
    const progress = liveProgressCache[key] || loadLocalState(key) || defaultState(team.label);
    const currentId = team.sequence[progress.progressIndex];
    const current = currentId ? CLUES[currentId] : null;
    const row = document.createElement("div");
    row.className = "adminStatusRow";
    row.innerHTML = `<strong>${progress.teamName || team.label}</strong><div class="adminStatusMeta">${progress.finished ? "Finished" : current ? `On clue ${progress.progressIndex + 1}: ${current.location}` : "Not started"}</div><div class="adminStatusMeta">${progress.completed?.length || 0} clues found</div>`;
    mount.appendChild(row);
  });
}

async function persistAll(){
  saveLocalState();
  saveLocalBoard();
  if (supabaseReady){
    await pushRemoteProgress();
    await pushLeaderboard();
  }
}

async function renderAll(options = {}){
  const shouldPersist = options.persist !== false;
  applyMapVisibility();
  renderTop();
  renderChores();
  renderMap();
  renderHint();
  renderFinalEggCard();
  renderBoard();
  if (shouldPersist) await persistAll();
}


function applyProgressAdvance(team, targetState, scannedValue){
  const expected = TOKENS[team]?.[targetState.progressIndex];
  if (!expected){
    return { status: "finished", message: "This team has already finished every clue." };
  }

  const finishedStep = TEAMS[team].sequence[targetState.progressIndex];
  targetState.completed = Array.isArray(targetState.completed) ? targetState.completed : [];
  targetState.scannedTokens = Array.isArray(targetState.scannedTokens) ? targetState.scannedTokens : [];
  targetState.completed.push(finishedStep);
  targetState.scannedTokens.push(scannedValue || expected);
  targetState.progressIndex += 1;
  targetState.revealedHintClueId = null;
  targetState.lastUpdatedAt = Date.now();

  if (isOnFinalClue(targetState, team)) {
    targetState.finished = false;
    return { status: "ready-final-egg", message: finalEggReadyMessage() };
  }

  if (targetState.progressIndex >= teamTotal(team)) {
    targetState.finished = true;
    return { status: "finished", message: "That was the final QR code. You found the final egg!" };
  }

  targetState.finished = false;
  return { status: "correct", message: "That was the right QR code. Your next chore is unlocked." };
}

async function unlockToken(token, options = {}){
  const quiet = !!options.quiet;
  if (!teamKey || !state) {
    const message = "Pick a team first.";
    if (!quiet) setFeedback(message);
    return { status: "no-team", message };
  }

  const expected = TOKENS[teamKey][state.progressIndex];
  if (!expected){
    const message = "This team has already finished every clue.";
    if (!quiet) setFeedback(message);
    return { status: "finished", message };
  }

  if ((token || "").trim() !== expected){
    const message = "Wrong QR code. Try again.";
    if (!quiet) setFeedback(message);
    return { status: "wrong", message };
  }

  const result = applyProgressAdvance(teamKey, state, expected);
  await renderAll();
  if (result.status === "ready-final-egg") setPage("choresPage");
  if (state.finished) {
    setPage("choresPage");
    showVictoryOverlay();
  }

  if (!quiet) setFeedback(result.message);
  return result;
}


function renderFinalEggCard(){
  const card = el("finalEggCard");
  const claimBtn = el("claimVictoryBtn");
  const viewBtn = el("viewVictoryBtn");
  const title = el("finalEggTitle");
  const copy = el("finalEggCopy");
  const badge = el("finalEggBadge");
  if (!card || !claimBtn || !viewBtn || !title || !copy || !badge) return;

  claimBtn.classList.add("hidden");

  if (!teamKey || !state){
    card.classList.add("hidden");
    return;
  }

  if (state.finished){
    const place = finishPlacementForTeam(teamKey) || 1;
    const prizeText = placementPrizeText(place);
    card.classList.remove("hidden");
    badge.textContent = "🏆 Victory locked";
    title.textContent = `Your team finished in ${placementLabel(place)} and won ${prizeText}.`;
    copy.textContent = `Go to Andy for ${prizeText}. Your placement is locked in and the leaderboard has been updated.`;
    viewBtn.classList.remove("hidden");
    return;
  }

  if (isOnFinalClue(state, teamKey)){
    card.classList.remove("hidden");
    badge.textContent = "🥚 Final clue";
    title.textContent = "Your final clue is unlocked.";
    copy.textContent = "Find the final egg and scan its QR code to finish the hunt.";
    viewBtn.classList.add("hidden");
    return;
  }

  card.classList.add("hidden");
}

function hideVictoryOverlay(){
  const overlay = el("victoryOverlay");
  if (overlay) overlay.classList.add("hidden");
}

function showVictoryOverlay(){
  if (!teamKey || !state || !state.finished) return;
  const place = finishPlacementForTeam(teamKey) || 1;
  const prizeText = placementPrizeText(place);
  if (el("victoryTitle")) el("victoryTitle").textContent = `${state.teamName} found the final egg!`;
  if (el("victoryPlacement")) el("victoryPlacement").textContent = `Your team came in ${placementLabel(place)} and won ${prizeText}.`;
  if (el("victoryRankWord")) el("victoryRankWord").textContent = placementLabel(place).replace(/^./, char => char.toUpperCase());
  if (el("victoryMeta")) el("victoryMeta").textContent = place <= 3
    ? `Go to Andy for your ${prizeText}. The final egg was at ${finalEggInfo().location}. The leaderboard has been updated and your team earned the ${place === 1 ? "gold" : place === 2 ? "silver" : "bronze"} trophy.`
    : `The final egg was at ${finalEggInfo().location}. The leaderboard has been updated with your final placement.`;
  const overlay = el("victoryOverlay");
  if (overlay) overlay.classList.remove("hidden");
}

async function claimVictory(){
  if (!teamKey || !state) return;
  if (state.finished) {
    showVictoryOverlay();
  } else {
    setFeedback("Find the final egg and scan its QR code to finish.");
  }
}

function showPhotoPlaceholder(message){
  const placeholder = el("photoPlaceholder");
  if (!placeholder) return;
  placeholder.textContent = message;
  placeholder.classList.remove("hidden");
}

function hidePhotoPlaceholder(){
  const placeholder = el("photoPlaceholder");
  if (placeholder) placeholder.classList.add("hidden");
}

async function stopCamera(){
  if (cameraStream){
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  const video = el("qrVideo");
  if (video){
    video.pause();
    video.srcObject = null;
    video.classList.add("hidden");
  }
}

async function startCamera(){
  const video = el("qrVideo");
  const canvas = el("qrCanvas");
  if (!video || !canvas) return;

  setScanMessage("Opening camera...");
  setScanStatus("checking", "Opening camera...");

  try {
    await stopCamera();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });
    cameraStream = stream;
    video.srcObject = stream;
    video.classList.remove("hidden");
    canvas.classList.add("hidden");
    capturedCanvas = null;
    hidePhotoPlaceholder();
    await video.play();
    setScanMessage("Take a picture of the QR code.");
    setScanStatus("idle", "Camera ready. Take a picture.");
  } catch (error){
    console.error(error);
    showPhotoPlaceholder("Could not open the camera. Use Retake to try again.");
    setScanMessage("Could not open the camera. Use Retake to try again.");
    setScanStatus("error", "Camera access failed. Use Retake to try again.");
  }
}

function resetPhotoArea(options = {}){
  const { keepStatus = false } = options;
  const reader = el("qr-reader");
  const video = el("qrVideo");
  const canvas = el("qrCanvas");
  if (reader){
    const existingImg = reader.querySelector("img.previewImage");
    if (existingImg && existingImg.src && existingImg.src.startsWith("blob:")) {
      try { URL.revokeObjectURL(existingImg.src); } catch (error) {}
      existingImg.remove();
    }
  }
  if (video){
    video.classList.add("hidden");
    video.srcObject = null;
  }
  if (canvas){
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.classList.add("hidden");
  }
  capturedCanvas = null;
  
  showPhotoPlaceholder("Camera will start automatically on this page.");
  stopCamera();
  if (!keepStatus){
    setScanMessage("Line up the QR code in the camera and take a picture.");
    setScanStatus("idle", "Camera will open automatically.");
  }
}

function renderPhotoPreview(file){
  const reader = el("qr-reader");
  const video = el("qrVideo");
  const canvas = el("qrCanvas");
  if (!reader) return null;
  if (video) video.classList.add("hidden");
  if (canvas) canvas.classList.add("hidden");
  hidePhotoPlaceholder();
  const objectUrl = URL.createObjectURL(file);
  const oldImg = reader.querySelector("img.previewImage");
  if (oldImg && oldImg.src && oldImg.src.startsWith("blob:")) {
    try { URL.revokeObjectURL(oldImg.src); } catch (error) {}
    oldImg.remove();
  }
  const img = document.createElement("img");
  img.src = objectUrl;
  img.alt = "Selected QR code photo";
  img.className = "previewImage";
  reader.appendChild(img);
  return objectUrl;
}

async function fileToLoadedImage(file){
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read image file."));
    };
    img.src = objectUrl;
  });
}

function canvasFromImage(img, maxDim = 2200){
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cloneCanvas(sourceCanvas){
  const canvas = document.createElement("canvas");
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0);
  return canvas;
}

function rotateCanvas(sourceCanvas, degrees){
  const radians = degrees * Math.PI / 180;
  const swap = Math.abs(degrees) % 180 === 90;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? sourceCanvas.height : sourceCanvas.width;
  canvas.height = swap ? sourceCanvas.width : sourceCanvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(radians);
  ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
  return canvas;
}

function scaledCanvas(sourceCanvas, scale){
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  canvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function thresholdCanvas(sourceCanvas, threshold = 140){
  const canvas = cloneCanvas(sourceCanvas);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4){
    const gray = (0.299 * data[i]) + (0.587 * data[i + 1]) + (0.114 * data[i + 2]);
    const value = gray > threshold ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function decodeWithBarcodeDetector(canvas){
  if (!("BarcodeDetector" in window)) return null;
  try {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const results = await detector.detect(canvas);
    if (results && results[0] && results[0].rawValue) return results[0].rawValue;
  } catch (error) {
    console.warn("BarcodeDetector failed", error);
  }
  return null;
}

function decodeWithJsQr(canvas){
  if (typeof jsQR === "undefined") return null;
  const scales = [1, 0.85, 0.65, 1.25, 1.5];
  for (const scale of scales){
    const working = scale === 1 ? canvas : scaledCanvas(canvas, scale);
    const ctx = working.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, working.width, working.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
    if (result && result.data) return result.data;
  }
  return null;
}

async function decodeQrFromCanvas(sourceCanvas){
  const orientations = [0, 90, 180, 270];
  for (const degrees of orientations){
    const oriented = degrees === 0 ? sourceCanvas : rotateCanvas(sourceCanvas, degrees);
    const variants = [
      oriented,
      thresholdCanvas(oriented, 110),
      thresholdCanvas(oriented, 140),
      thresholdCanvas(oriented, 170)
    ];
    for (const variant of variants){
      const detectorResult = await decodeWithBarcodeDetector(variant);
      if (detectorResult) return detectorResult;
      const jsqrResult = decodeWithJsQr(variant);
      if (jsqrResult) return jsqrResult;
    }
  }
  return null;
}

async function decodeQrFromFile(file){
  const img = await fileToLoadedImage(file);
  const baseCanvas = canvasFromImage(img);
  const decoded = await decodeQrFromCanvas(baseCanvas);
  if (decoded) return decoded;

  if (typeof Html5Qrcode !== "undefined"){
    try {
      if (!fileQrScanner) fileQrScanner = new Html5Qrcode("qr-reader");
      return await fileQrScanner.scanFile(file, false);
    } catch (error) {
      console.warn("Html5Qrcode fallback failed", error);
    }
  }

  return null;
}

function captureCurrentFrame(){
  const video = el("qrVideo");
  const canvas = el("qrCanvas");
  if (!video || !canvas || !video.videoWidth || !video.videoHeight) return null;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.classList.remove("hidden");
  video.classList.add("hidden");
  hidePhotoPlaceholder();
  capturedCanvas = cloneCanvas(canvas);
  return capturedCanvas;
}

async function analyzeCanvas(canvas){
  setScanMessage("Checking picture...");
  setScanStatus("checking", "Checking picture...");
  try {
    const decodedText = await decodeQrFromCanvas(canvas);
    if (!decodedText){
      setScanMessage("No QR code detected. Try again.");
      setFeedback("No QR code detected. Try again.");
      setScanStatus("no-qr", "No QR code detected. Try again.");
      return;
    }
    const result = await unlockToken(decodedText, { quiet: true });
    setScanMessage(result.message);
    setFeedback(result.message);
    setScanStatus(result.status, result.message);
  } catch (error){
    console.error(error);
    setScanMessage("No QR code detected. Try again.");
    setFeedback("No QR code detected. Try again.");
    setScanStatus("no-qr", "No QR code detected. Try again.");
  }
}

async function captureAndCheckPhoto(){
  const frame = captureCurrentFrame();
  if (!frame){
    setScanMessage("Camera is not ready yet.");
    setScanStatus("error", "Camera is not ready yet.");
    return;
  }
  await stopCamera();
  await analyzeCanvas(frame);
}

async function checkPhotoFile(file){
  if (!file) return;
  await stopCamera();
  const previewUrl = renderPhotoPreview(file);

  setScanMessage("Checking picture...");
  setScanStatus("checking", "Checking picture...");

  try {
    const decodedText = await decodeQrFromFile(file);
    if (!decodedText){
      setScanMessage("No QR code detected. Try again.");
      setFeedback("No QR code detected. Try again.");
      setScanStatus("no-qr", "No QR code detected. Try again.");
      return;
    }
    const result = await unlockToken(decodedText, { quiet: true });
    setScanMessage(result.message);
    setFeedback(result.message);
    setScanStatus(result.status, result.message);
  } catch (error){
    console.error(error);
    setScanMessage("No QR code detected. Try again.");
    setFeedback("No QR code detected. Try again.");
    setScanStatus("no-qr", "No QR code detected. Try again.");
  } finally {
    if (previewUrl && el("qrPhotoInput")?.value === "") {
      URL.revokeObjectURL(previewUrl);
    }
  }
}
function showAdminOverlay(){ const o = el("adminOverlay"); if (o) o.classList.remove("hidden"); }
function hideAdminOverlay(){ const o = el("adminOverlay"); if (o) o.classList.add("hidden"); }
function showAdminPanel(){ populateAdminTeams(); syncAdminFields(); applyMapVisibility(); const p = el("adminPanel"); if (p) p.classList.remove("hidden"); }
function hideAdminPanel(){ const p = el("adminPanel"); if (p) p.classList.add("hidden"); }
function openAdminPrompt(){
  hideAdminPanel();
  if (el("adminPasscode")) el("adminPasscode").value = "";
  if (el("adminFeedback")) el("adminFeedback").textContent = "Admin tools are hidden from players.";
  showAdminOverlay();
}

function populateAdminTeams(){
  const select = el("adminTeamSelect");
  if (!select) return;
  const current = select.value || teamKey || "Team1";
  select.innerHTML = "";
  Object.entries(TEAMS).forEach(([key, team]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = team.label;
    if (key === current) opt.selected = true;
    select.appendChild(opt);
  });
}

async function syncAdminFields(){
  const select = el("adminTeamSelect");
  if (!select) return;
  const team = select.value;
  const remote = await loadRemoteProgress(team);
  const local = loadLocalState(team);
  const name = remote?.teamName || local.teamName || TEAMS[team].label;
  el("adminTeamName").value = name;
}

async function adminSaveTeamName(){
  const team = el("adminTeamSelect").value;
  const newName = el("adminTeamName").value.trim();
  if (!newName){
    el("adminPanelFeedback").textContent = "Enter a team name first.";
    return;
  }

  let targetState = await loadRemoteProgress(team) || loadLocalState(team);
  targetState.teamName = newName;
  if (!targetState.finished) targetState.lastUpdatedAt = Date.now();
  liveProgressCache[team] = { ...targetState };
  localStorage.setItem(storageKey(team), JSON.stringify(targetState));

  const localBoard = readJson(leaderboardKey(), {});
  localBoard[team] = { teamName: newName, found: targetState.completed.length, finished: targetState.finished, lastUpdatedAt: targetState.lastUpdatedAt };
  localStorage.setItem(leaderboardKey(), JSON.stringify(localBoard));

  if (supabaseReady){
    await supabaseClient.from("team_progress_sigtau").upsert({
      team_id: team,
      team_name: newName,
      progress_index: targetState.progressIndex,
      completed: targetState.completed,
      scanned_tokens: targetState.scannedTokens,
      used_hints: targetState.usedHints,
      next_hint_at: targetState.nextHintAt,
      finished: targetState.finished,
      started_at: targetState.startedAt,
      last_updated_at: targetState.lastUpdatedAt
    }, { onConflict: "team_id" });

    await supabaseClient.from("leaderboard_sigtau").upsert({
      team_id: team,
      team_name: newName,
      found: targetState.completed.length,
      finished: targetState.finished,
      last_updated_at: targetState.lastUpdatedAt
    }, { onConflict: "team_id" });

    liveBoardCache[team] = { team_id: team, team_name: newName, found: targetState.completed.length, finished: targetState.finished, last_updated_at: targetState.lastUpdatedAt };
  }

  if (teamKey === team && state){
    state.teamName = newName;
    await renderAll({ persist: false });
  } else {
    renderBoard();
  }

  maybeRefreshGateSelection();
  el("adminPanelFeedback").textContent = supabaseReady ? "Team name updated everywhere." : "Team name updated on this device only.";
}

async function adminResetTeam(){
  const team = el("adminTeamSelect").value;
  const fresh = defaultState(TEAMS[team].label);
  fresh.startedAt = 0;
  fresh.lastUpdatedAt = Date.now();
  liveProgressCache[team] = { ...fresh };
  localStorage.setItem(storageKey(team), JSON.stringify(fresh));

  const localBoard = readJson(leaderboardKey(), {});
  localBoard[team] = { teamName: fresh.teamName, found: 0, finished: false, lastUpdatedAt: 0 };
  localStorage.setItem(leaderboardKey(), JSON.stringify(localBoard));

  if (supabaseReady){
    await supabaseClient.from("team_progress_sigtau").upsert({
      team_id: team,
      team_name: fresh.teamName,
      progress_index: 0,
      completed: [],
      scanned_tokens: [],
      used_hints: 0,
      next_hint_at: null,
      finished: false,
      started_at: fresh.startedAt,
      last_updated_at: fresh.lastUpdatedAt,
      revealed_hint_clue_id: null
    }, { onConflict: "team_id" });

    await supabaseClient.from("leaderboard_sigtau").upsert({
      team_id: team,
      team_name: fresh.teamName,
      found: 0,
      finished: false,
      last_updated_at: 0
    }, { onConflict: "team_id" });

    liveBoardCache[team] = { team_id: team, team_name: fresh.teamName, found: 0, finished: false, last_updated_at: 0 };
  }

  if (rememberedTeam() === team){
    releaseTeamSelection("That team was reset. Pick a team to join again.");
  } else {
    renderBoard();
  }

  await syncAdminFields();
  maybeRefreshGateSelection();
  el("adminPanelFeedback").textContent = supabaseReady ? "Selected team reset everywhere and cleared from remembered devices." : "Selected team reset on this device only.";
}


async function adminGrantNext(){
  const team = el("adminTeamSelect").value;
  let targetState = await loadRemoteProgress(team) || loadLocalState(team);

  let result = null;
  let currentStep = targetState.progressIndex + 1;
  let currentClueId = TEAMS[team].sequence[targetState.progressIndex];
  let currentClue = currentClueId ? CLUES[currentClueId] : null;

  if (isReadyForVictory(targetState, team)) {
    targetState.finished = true;
    targetState.lastUpdatedAt = Date.now();
    result = { status: "finished", message: `${TEAMS[team].label} finished the hunt.` };
  } else {
    const expected = TOKENS[team]?.[targetState.progressIndex];
    if (!expected){
      el("adminPanelFeedback").textContent = "That team has already finished the hunt.";
      return;
    }
    result = applyProgressAdvance(team, targetState, expected);
  }

  liveProgressCache[team] = { ...targetState };
  localStorage.setItem(storageKey(team), JSON.stringify(targetState));

  const localBoard = readJson(leaderboardKey(), {});
  localBoard[team] = {
    teamName: targetState.teamName,
    found: targetState.completed.length,
    finished: targetState.finished,
    lastUpdatedAt: targetState.lastUpdatedAt
  };
  localStorage.setItem(leaderboardKey(), JSON.stringify(localBoard));

  if (supabaseReady){
    await supabaseClient.from("team_progress_sigtau").upsert({
      team_id: team,
      team_name: targetState.teamName,
      progress_index: targetState.progressIndex,
      completed: targetState.completed,
      scanned_tokens: targetState.scannedTokens,
      used_hints: targetState.usedHints,
      next_hint_at: targetState.nextHintAt,
      finished: targetState.finished,
      started_at: targetState.startedAt,
      last_updated_at: targetState.lastUpdatedAt
    }, { onConflict: "team_id" });

    await supabaseClient.from("leaderboard_sigtau").upsert({
      team_id: team,
      team_name: targetState.teamName,
      found: targetState.completed.length,
      finished: targetState.finished,
      last_updated_at: targetState.lastUpdatedAt
    }, { onConflict: "team_id" });

    liveBoardCache[team] = {
      team_id: team,
      team_name: targetState.teamName,
      found: targetState.completed.length,
      finished: targetState.finished,
      last_updated_at: targetState.lastUpdatedAt
    };
  }

  if (teamKey === team){
    state = targetState;
    await renderAll({ persist: false });
    if (state.finished) showVictoryOverlay();
  } else {
    renderBoard();
  }

  await syncAdminFields();
  const clueName = currentClue?.location || `Clue ${currentClueId}`;
  if (targetState.finished) {
    const place = finishPlacementForTeam(team) || finishedPlacementRows().length;
    el("adminPanelFeedback").textContent = `${TEAMS[team].label} finished the hunt in ${placementLabel(place)} and won ${placementPrizeText(place)}.`;
  } else if (result.status === "ready-final-egg") {
    el("adminPanelFeedback").textContent = `Granted ${TEAMS[team].label} the final clue. They still need to scan the final egg QR code to finish.`;
  } else {
    el("adminPanelFeedback").textContent = `Granted ${TEAMS[team].label} past ${clueName} (step ${currentStep}).`;
  }
}


async function adminGrantHint(){
  const team = el("adminTeamSelect").value;
  let targetState = await loadRemoteProgress(team) || loadLocalState(team);
  targetState.usedHints = Number(targetState.usedHints || 0) - 1;
  targetState.nextHintAt = null;
  targetState.lastUpdatedAt = Date.now();

  localStorage.setItem(storageKey(team), JSON.stringify(targetState));
  liveProgressCache[team] = { ...targetState };

  if (supabaseReady) {
    await supabaseClient.from("team_progress_sigtau").upsert({
      team_id: team,
      team_name: targetState.teamName,
      progress_index: targetState.progressIndex,
      completed: targetState.completed,
      scanned_tokens: targetState.scannedTokens,
      used_hints: targetState.usedHints,
      next_hint_at: targetState.nextHintAt,
      finished: targetState.finished,
      started_at: targetState.startedAt,
      last_updated_at: targetState.lastUpdatedAt
    }, { onConflict: "team_id" });
  }

  if (teamKey === team){
    state = targetState;
    await renderAll({ persist: false });
  } else {
    renderAdminStatuses();
  }

  await syncAdminFields();
  const stats = hintStats(targetState);
  el("adminPanelFeedback").textContent = `${TEAMS[team].label} now has ${stats.remaining} hint${stats.remaining === 1 ? "" : "s"} available.`;
}

async function adminSkipHintTimer(){
  const team = el("adminTeamSelect").value;
  let targetState = await loadRemoteProgress(team) || loadLocalState(team);
  targetState.nextHintAt = null;
  targetState.lastUpdatedAt = Date.now();

  localStorage.setItem(storageKey(team), JSON.stringify(targetState));
  liveProgressCache[team] = { ...targetState };

  if (supabaseReady) {
    await supabaseClient.from("team_progress_sigtau").upsert({
      team_id: team,
      team_name: targetState.teamName,
      progress_index: targetState.progressIndex,
      completed: targetState.completed,
      scanned_tokens: targetState.scannedTokens,
      used_hints: targetState.usedHints,
      next_hint_at: targetState.nextHintAt,
      finished: targetState.finished,
      started_at: targetState.startedAt,
      last_updated_at: targetState.lastUpdatedAt
    }, { onConflict: "team_id" });
  }

  if (teamKey === team){
    state = targetState;
    await renderAll({ persist: false });
  } else {
    renderAdminStatuses();
  }

  await syncAdminFields();
  el("adminPanelFeedback").textContent = `${TEAMS[team].label} can use its next hint immediately.`;
}


async function adminResetAll(){
  if (!window.confirm("Reset the full game for every team?")) return;
  const nowTs = Date.now();
  const boardReset = {};
  for (const [team, meta] of Object.entries(TEAMS)) {
    const fresh = defaultState(meta.label);
    fresh.startedAt = 0;
    fresh.lastUpdatedAt = nowTs;
    localStorage.setItem(storageKey(team), JSON.stringify(fresh));
    liveProgressCache[team] = { ...fresh };
    boardReset[team] = { teamName: fresh.teamName, found: 0, finished: false, lastUpdatedAt: 0 };
    if (supabaseReady) {
      await supabaseClient.from("team_progress_sigtau").upsert({
        team_id: team, team_name: fresh.teamName, progress_index: 0, completed: [], scanned_tokens: [], used_hints: 0, next_hint_at: null, finished: false, started_at: fresh.startedAt, last_updated_at: fresh.lastUpdatedAt, revealed_hint_clue_id: null
      }, { onConflict: "team_id" });
      await supabaseClient.from("leaderboard_sigtau").upsert({
        team_id: team, team_name: fresh.teamName, found: 0, finished: false, last_updated_at: 0
      }, { onConflict: "team_id" });
    }
  }
  localStorage.setItem(leaderboardKey(), JSON.stringify(boardReset));
  setLocalMapEnabled(true);
  if (supabaseReady) await pushSharedSettings();
  releaseTeamSelection("The full game was reset. Pick a team to join again.");
  if (el("adminPanelFeedback")) el("adminPanelFeedback").textContent = "Full game reset for every team and remembered team choices were cleared.";
}

async function adminToggleMap(){
  const nextValue = !isMapEnabled();
  setLocalMapEnabled(nextValue);
  applyMapVisibility();
  if (supabaseReady) await pushSharedSettings();
  await renderAll({ persist: false });
  el("adminPanelFeedback").textContent = supabaseReady
    ? `Map turned ${nextValue ? "on" : "off"} for everyone.`
    : `Map turned ${nextValue ? "on" : "off"} on this device only.`;
}

async function adminReloadTeam(){
  const team = el("adminTeamSelect").value;
  if (!supabaseReady){
    el("adminPanelFeedback").textContent = "Supabase is not configured.";
    return;
  }
  const remote = await loadRemoteProgress(team);
  if (!remote){
    el("adminPanelFeedback").textContent = "No shared progress found for that team.";
    return;
  }
  localStorage.setItem(storageKey(team), JSON.stringify(remote));
  if (teamKey === team){
    state = remote;
    await renderAll({ persist: false });
  }
  await syncAdminFields();
  el("adminPanelFeedback").textContent = "Selected team reloaded from shared progress.";
}

function wireAdminTrigger(node){
  if (!node) return;
  node.onclick = ev => {
    ev.preventDefault();
    ev.stopPropagation();
    openAdminPrompt();
  };
  node.addEventListener("touchend", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    openAdminPrompt();
  }, { passive: false });
}

function wireAdminEvents(){
  wireAdminTrigger(el("rabbitTrigger"));
  wireAdminTrigger(el("gateRabbitTrigger"));

  if (el("adminCloseX")) el("adminCloseX").addEventListener("click", hideAdminOverlay);
  if (el("adminPanelCloseX")) el("adminPanelCloseX").addEventListener("click", hideAdminPanel);

  if (el("adminUnlockBtn")) el("adminUnlockBtn").addEventListener("click", () => {
    const pass = (el("adminPasscode")?.value || "").trim();
    if (pass === ADMIN_PASSCODE){
      hideAdminOverlay();
      showAdminPanel();
    } else {
      if (el("adminPasscode")) el("adminPasscode").value = "";
      hideAdminOverlay();
    }
  });

  if (el("adminOverlay")) el("adminOverlay").addEventListener("click", e => { if (e.target === el("adminOverlay")) hideAdminOverlay(); });
  if (el("adminPanel")) el("adminPanel").addEventListener("click", e => { if (e.target === el("adminPanel")) hideAdminPanel(); });

  if (el("adminTeamSelect")) el("adminTeamSelect").addEventListener("change", syncAdminFields);
  if (el("adminSaveNameBtn")) el("adminSaveNameBtn").addEventListener("click", adminSaveTeamName);
  if (el("adminGrantNextBtn")) el("adminGrantNextBtn").addEventListener("click", adminGrantNext);
  if (el("adminGrantHintBtn")) el("adminGrantHintBtn").addEventListener("click", adminGrantHint);
  if (el("adminSkipHintTimerBtn")) el("adminSkipHintTimerBtn").addEventListener("click", adminSkipHintTimer);
  if (el("adminToggleMapBtn")) el("adminToggleMapBtn").addEventListener("click", adminToggleMap);
  if (el("adminResetTeamBtn")) el("adminResetTeamBtn").addEventListener("click", adminResetTeam);
  if (el("adminResetAllBtn")) el("adminResetAllBtn").addEventListener("click", adminResetAll);
  if (el("adminReloadTeamBtn")) el("adminReloadTeamBtn").addEventListener("click", adminReloadTeam);
  if (el("victoryCloseX")) el("victoryCloseX").addEventListener("click", hideVictoryOverlay);
  if (el("victoryLeaderboardBtn")) el("victoryLeaderboardBtn").addEventListener("click", () => {
    hideVictoryOverlay();
    setPage("mapPage");
  });
  if (el("victoryOverlay")) el("victoryOverlay").addEventListener("click", e => { if (e.target === el("victoryOverlay")) hideVictoryOverlay(); });
}

function wireScannerEvents(){
  if (el("takePhotoBtn")) {
    el("takePhotoBtn").addEventListener("click", captureAndCheckPhoto);
  }

  if (el("retakePhotoBtn")) {
    el("retakePhotoBtn").addEventListener("click", async () => {
      resetPhotoArea({ keepStatus: true });
      await startCamera();
    });
  }




  if (el("unlockBtn")) {
    el("unlockBtn").addEventListener("click", async () => {
      const val = el("manualCode").value.trim();
      if (!val) return;
      const result = await unlockToken(val, { quiet: true });
      setScanMessage(result.message);
      setFeedback(result.message);
      setScanStatus(result.status, result.message);
      el("manualCode").value = "";
    });
  }

  if (el("claimVictoryBtn")) el("claimVictoryBtn").addEventListener("click", claimVictory);
  if (el("viewVictoryBtn")) el("viewVictoryBtn").addEventListener("click", showVictoryOverlay);
}

document.querySelectorAll(".menuBtn[data-page]").forEach(btn => btn.addEventListener("click", () => setPage(btn.dataset.page)));
applyMapVisibility();

if (el("startGameBtn")) {
  el("startGameBtn").addEventListener("click", async () => {
    if (!teamKey){
      setFeedback("Choose a team first.");
      return;
    }
    const claimedName = await getClaimedTeamName(teamKey);
    const enteredName = (el("gateTeamName").value || "").trim();
    let loaded = loadLocalState(teamKey);
    const remote = await loadRemoteProgress(teamKey);
    if (remote) loaded = remote;
    state = loaded;
    state.teamName = claimedName || enteredName || state.teamName || TEAMS[teamKey].label;
    if (!state.startedAt) state.startedAt = Date.now();
    if (!state.lastUpdatedAt) state.lastUpdatedAt = Date.now();
    rememberTeam(teamKey, state.startedAt);
    el("teamGate").classList.add("hidden");
    await renderAll();
  });
}

if (el("hintBtn")) {
  el("hintBtn").addEventListener("click", async () => {
    if (!state) return;
    const activeId = currentClueId();
    const stats = hintStats(state);
    const locked = clueAllowsHint(activeId) && state.nextHintAt && now < toMillis(state.nextHintAt);
    if (!clueAllowsHint(activeId) || stats.remaining <= 0 || locked) return;
    state.usedHints += 1;
    state.revealedHintClueId = activeId;
    state.nextHintAt = hintStats(state).remaining <= 0 ? null : Date.now() + COOLDOWN_MINUTES * 60 * 1000;
    state.lastUpdatedAt = Date.now();
    await renderAll();
  });
}


document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCamera();
});
window.addEventListener("beforeunload", stopCamera);

async function autoResumeRememberedTeam(){
  const remembered = rememberedTeamRecord();
  if (!remembered) return false;
  const saved = remembered.team;
  const remote = await loadRemoteProgress(saved);
  if (remote && Number(remembered.startedAt || 0) !== Number(remote.startedAt || 0)) {
    clearRememberedTeam(saved);
    renderGateTeams(null);
    setGateNameLock(false, "");
    return false;
  }
  teamKey = saved;
  state = remote || loadLocalState(saved);
  if (!state.startedAt) state.startedAt = Date.now();
  if (!state.lastUpdatedAt) state.lastUpdatedAt = Date.now();
  renderGateTeams(saved);
  setGateNameLock(true, state.teamName || TEAMS[saved].label);
  if (el("teamGate")) el("teamGate").classList.add("hidden");
  rememberTeam(saved, state.startedAt);
  await renderAll();
  return true;
}

async function refreshSharedData(){
  if (!supabaseReady) return;
  await fetchRemoteBoard();
  await fetchAllRemoteProgress();
  if (teamKey) {
    const remote = await loadRemoteProgress(teamKey);
    if (remote) {
      state = remote;
      await renderAll({ persist: false });
    }
  }
  renderAdminStatuses();
}

(async function boot(){
  await initSupabase();
  renderGateTeams(null);
  setGateNameLock(false, "");
  renderBoard();
  updateSharedModeText();
  resetPhotoArea();
  setScanStatus("idle", "Camera will open automatically.");
  setPage("choresPage");
  wireAdminEvents();
  wireScannerEvents();
  await autoResumeRememberedTeam();
  setInterval(() => {
    now = Date.now();
    if (state){
      renderTop();
      renderHint();
      renderFinalEggCard();
    }
  }, 1000);
  setInterval(() => { refreshSharedData().catch(console.error); }, 5000);
  window.addEventListener("focus", () => { refreshSharedData().catch(console.error); });
})();
