const COOLDOWN_MINUTES = 10;
const BASE_HINTS = 3;
const STORAGE_PREFIX = "sigtau-easter-hunt-v1";
const REMEMBERED_TEAM_KEY = `${STORAGE_PREFIX}-remembered-team`;
const REMEMBERED_TEAM_STARTED_KEY = `${STORAGE_PREFIX}-remembered-team-started`;
const ADMIN_PASSCODE = "bunnyboss";
const TEAM_IDENTITY_SEPARATOR = "|||";
const DEFAULT_MASCOT = "rabbit";
const MASCOTS = {
  rabbit: { label: "Rabbits", emoji: "🐰", badgeClass: "mascot-rabbit", title: "Burrow Blitz", flavor: "Fast starts, lucky breaks, and spring chaos." },
  knight: { label: "Knights", emoji: "🛡️", badgeClass: "mascot-knight", title: "Honor Guard", flavor: "Steady hands, brave scans, and noble finishes." },
  raven: { label: "Ravens", emoji: "🪶", badgeClass: "mascot-raven", title: "Night Watch", flavor: "Sharp eyes, sly routes, and quiet steals." },
  wolf: { label: "Wolves", emoji: "🐺", badgeClass: "mascot-wolf", title: "Moon Pack", flavor: "Hunt together, move fast, and never flinch." },
  fox: { label: "Foxes", emoji: "🦊", badgeClass: "mascot-fox", title: "Firetrail Crew", flavor: "Quick pivots, clever reads, and flashy escapes." },
  cobra: { label: "Cobras", emoji: "🐍", badgeClass: "mascot-cobra", title: "Garden Strike", flavor: "Patient reads, perfect timing, and clean finishes." }
};
const MAP_ENABLED_KEY = `${STORAGE_PREFIX}-map-enabled`;
const SHARED_SETTINGS_TEAM_ID = "__settings__";
const FINAL_CLUE_ID = 11;
const LEGACY_TEAMS = typeof TEAMS === "object" ? TEAMS : {};
const CLUE_IDS = Object.keys(CLUES).map(Number).sort((a, b) => a - b);
const ROUTE_CLUE_IDS = CLUE_IDS.filter(id => id !== FINAL_CLUE_ID);
const CLUE_TOKEN_BY_ID = Object.freeze((() => {
  const tokenMap = {};
  Object.entries(LEGACY_TEAMS).forEach(([team, meta]) => {
    (meta.sequence || []).forEach((clueId, idx) => {
      const token = TOKENS?.[team]?.[idx];
      if (token && !tokenMap[clueId]) tokenMap[clueId] = token;
    });
  });
  return tokenMap;
})());

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
let syncState = "pending";
let syncMessage = "Connecting to shared game...";
let sharedActivities = [];
let sharedDataPrimed = false;
let audioContext = null;
let gateMode = "join";

function el(id){ return document.getElementById(id); }
function storageKey(team){ return `${STORAGE_PREFIX}-${team}`; }
function leaderboardKey(){ return `${STORAGE_PREFIX}-leaderboard`; }
function teamExists(team){ return !!team && team !== SHARED_SETTINGS_TEAM_ID; }
function teamFallbackLabel(team){ return LEGACY_TEAMS[team]?.label || "Team"; }
function clueTokenForId(clueId){ return CLUE_TOKEN_BY_ID[Number(clueId)] || null; }
function clueIdForToken(token){
  const trimmed = String(token || "").trim();
  if (!trimmed) return null;
  const match = Object.entries(CLUE_TOKEN_BY_ID).find(([, value]) => value === trimmed);
  return match ? Number(match[0]) : null;
}
function shuffleList(values){
  const list = values.slice();
  for (let i = list.length - 1; i > 0; i -= 1){
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
function generateRandomSequence(){
  return [...shuffleList(ROUTE_CLUE_IDS), FINAL_CLUE_ID];
}
function normalizeSequence(sequence){
  const raw = Array.isArray(sequence) ? sequence.map(Number).filter(id => CLUES[id]) : [];
  const used = new Set();
  const body = [];
  raw.forEach(id => {
    if (id === FINAL_CLUE_ID) return;
    if (used.has(id)) return;
    used.add(id);
    body.push(id);
  });
  ROUTE_CLUE_IDS.forEach(id => {
    if (!used.has(id)) body.push(id);
  });
  return [...body, FINAL_CLUE_ID];
}
function sequenceForTeam(team = teamKey, targetState = state){
  if (targetState && Array.isArray(targetState.sequence) && targetState.sequence.length) return normalizeSequence(targetState.sequence);
  if (team && Array.isArray(LEGACY_TEAMS[team]?.sequence)) return normalizeSequence(LEGACY_TEAMS[team].sequence);
  return normalizeSequence(generateRandomSequence());
}
function expectedTokenForState(targetState = state, team = teamKey){
  const clueId = currentClueId(targetState, team);
  return clueId ? clueTokenForId(clueId) : null;
}
function generateTeamId(){
  if (window.crypto?.randomUUID) return `team-${window.crypto.randomUUID()}`;
  return `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function normalizeTeamName(value){
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}
function allKnownTeamIds(){
  const ids = new Set();
  Object.keys(readJson(leaderboardKey(), {})).forEach(id => { if (teamExists(id)) ids.add(id); });
  Object.keys(liveBoardCache || {}).forEach(id => { if (teamExists(id)) ids.add(id); });
  Object.keys(liveProgressCache || {}).forEach(id => { if (teamExists(id)) ids.add(id); });
  if (teamExists(teamKey)) ids.add(teamKey);
  const remembered = localStorage.getItem(REMEMBERED_TEAM_KEY);
  if (teamExists(remembered)) ids.add(remembered);
  return [...ids];
}
function cachedBoardState(team){
  const board = readJson(leaderboardKey(), {});
  return liveBoardCache[team] || board[team] || null;
}
function progressStateFor(team){
  if (!teamExists(team)) return null;
  if (team === teamKey && state) return state;
  return liveProgressCache[team] || loadLocalState(team);
}
function cachedRawTeamName(team){
  const progress = progressStateFor(team);
  const board = cachedBoardState(team);
  return progress?.teamName || board?.team_name || board?.teamName || null;
}
function isCreatedTeamState(targetState, team, rawName = targetState?.teamName){
  if (!teamExists(team)) return false;
  const identity = teamIdentity(rawName || teamFallbackLabel(team), team);
  return Number(targetState?.startedAt || 0) > 0
    || Number(targetState?.lastUpdatedAt || 0) > 0
    || Number(targetState?.progressIndex || 0) > 0
    || !!targetState?.finished
    || (Array.isArray(targetState?.completed) && targetState.completed.length > 0)
    || normalizeTeamName(identity.displayName) !== normalizeTeamName(teamFallbackLabel(team));
}
function visibleTeamIds(){
  return allKnownTeamIds().filter(team => {
    const progress = progressStateFor(team);
    const board = cachedBoardState(team);
    const rawName = progress?.teamName || board?.team_name || board?.teamName || teamFallbackLabel(team);
    const found = Number(board?.found || progress?.completed?.length || 0);
    return isCreatedTeamState(progress, team, rawName) || found > 0 || !!board?.finished || !!progress?.finished;
  });
}
function teamLabelText(team, targetState = progressStateFor(team)){
  return teamIdentity(targetState?.teamName || cachedRawTeamName(team) || teamFallbackLabel(team), team).displayName;
}
function rememberedTeamRecord(){
  const saved = localStorage.getItem(REMEMBERED_TEAM_KEY);
  if (!teamExists(saved)) return null;
  const startedRaw = localStorage.getItem(REMEMBERED_TEAM_STARTED_KEY);
  return { team: saved, startedAt: startedRaw ? Number(startedRaw) : 0 };
}
function rememberedTeam(){
  return rememberedTeamRecord()?.team || null;
}
function rememberTeam(team, startedAt){
  if (!teamExists(team)) return;
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
  gateMode = "join";
  stopCamera();
  hideAdminOverlay();
  hideAdminPanel();
  hideVictoryOverlay();
  hideMissionOverlay();
  applyTeamTheme(encodeTeamIdentity("Sig Tau", DEFAULT_MASCOT, "Sig Tau"), null);
  if (el("teamGate")) el("teamGate").classList.remove("hidden");
  setGateMode("join");
  renderGateTeams(null);
  populateMascotOptions();
  if (el("gateTeamName")) el("gateTeamName").value = "";
  setScanInsight();
  renderDeviceState();
  if (message) setFeedback(message, "warn");
}

function leaveThisDevice(){
  if (!rememberedTeam() && !teamKey && !state) return;
  if (!window.confirm("Clear this device's saved team and make it ready for a new squad?")) return;
  releaseTeamSelection("This device is ready for a different team.");
}
function clueStatusForTeam(team){
  const progress = liveProgressCache[team] || loadLocalState(team);
  if (!progress) return "Not started";
  if (progress.finished) return "Finished";
  const clueId = currentClueId(progress, team);
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
  if (!team || !targetState) return null;
  const sequence = sequenceForTeam(team, targetState);
  return sequence[targetState.progressIndex] || null;
}

function clueAllowsHint(clueId){
  const clue = clueId ? CLUES[clueId] : null;
  return !!(clue && clue.hint && !clue.noHint);
}



function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
}

function normalizeMascotKey(key){
  return MASCOTS[key] ? key : DEFAULT_MASCOT;
}

function mascotMeta(key){
  return MASCOTS[normalizeMascotKey(key)];
}

function syncMessageForState(mode){
  if (mode === "live") return "Shared game live across devices.";
  if (mode === "local") return "Using this device only.";
  if (mode === "error") return "Shared sync hit a snag. Reconnecting...";
  return "Connecting to shared game...";
}

function setSyncState(mode, message){
  syncState = mode;
  syncMessage = message || syncMessageForState(mode);
  renderSyncBadge();
}

function renderSyncBadge(){
  const badge = el("syncBadge");
  if (badge){
    const classMap = {
      live: "syncLive",
      local: "syncLocal",
      error: "syncError",
      pending: "syncPending"
    };
    badge.className = `syncBadge ${classMap[syncState] || "syncPending"}`;
    badge.textContent = syncMessage || syncMessageForState(syncState);
  }
  const shared = el("sharedModeText");
  if (shared){
    shared.hidden = false;
    shared.style.display = "block";
    shared.textContent = syncMessage || syncMessageForState(syncState);
  }
}

function setScanInsight(message = "", tone = ""){
  const box = el("scanInsight");
  if (!box) return;
  box.className = `small scanInsight${tone ? ` ${tone}` : ""}`;
  box.textContent = message || "Wrong-scan tips and cross-team clues will show here.";
}

function pushSharedActivity(message){
  if (!message) return;
  if (sharedActivities[0]?.message === message) return;
  sharedActivities.unshift({ message, at: Date.now() });
  sharedActivities = sharedActivities.slice(0, 6);
  renderActivityTicker();
}

function renderActivityTicker(){
  const ticker = el("activityTicker");
  if (!ticker) return;
  ticker.textContent = sharedActivities[0]?.message || "Rival movement and admin updates will appear here.";
}

function updateThemePill(rawValue = state?.teamName, team = teamKey){
  const pill = el("teamThemePill");
  if (!pill){
    return;
  }
  if (!rawValue || !teamExists(team)){
    pill.className = "teamThemePill";
    pill.textContent = "Mascot theme waiting";
    return;
  }
  const identity = teamIdentity(rawValue, team);
  pill.className = `teamThemePill ${identity.mascot.badgeClass}`;
  pill.textContent = `${identity.mascot.emoji} ${identity.mascot.title}`;
}

function renderDeviceState(){
  const badge = el("deviceTeamBadge");
  const meta = el("deviceStatusMeta");
  const gateNote = el("gateDeviceNote");
  const remembered = rememberedTeam();
  const activeTeam = teamKey || remembered;
  const gateVisible = !!el("teamGate") && !el("teamGate").classList.contains("hidden");
  const rawValue = state?.teamName
    || (gateMode === "create" ? currentGateIdentityRaw() : null)
    || cachedRawTeamName(activeTeam)
    || (activeTeam ? encodeTeamIdentity(teamFallbackLabel(activeTeam), DEFAULT_MASCOT, teamFallbackLabel(activeTeam)) : null);
  const assigned = !!remembered || (!!teamKey && !!state && !gateVisible);
  if (badge){
    if (!assigned){
      if (activeTeam && rawValue){
        const identity = teamIdentity(rawValue, activeTeam);
        badge.innerHTML = `${mascotBadgeMarkup(identity)} <span>Preview: ${escapeHtml(identity.displayName)}</span>`;
      } else {
        badge.textContent = "No team on this device";
      }
    } else {
      const identity = teamIdentity(rawValue, activeTeam);
      badge.innerHTML = `${mascotBadgeMarkup(identity)} <span>${escapeHtml(identity.displayName)}</span>`;
    }
  }
  if (meta){
    if (!assigned){
      if (activeTeam && gateMode === "join"){
        meta.textContent = `Ready to join ${teamIdentity(rawValue, activeTeam).displayName} on this device.`;
      } else {
        meta.textContent = gateMode === "create"
          ? "Create a team, choose a mascot, and start the hunt."
          : "Join an existing team or create a new one.";
      }
    } else {
      const identity = teamIdentity(rawValue, activeTeam);
      meta.textContent = `${identity.mascot.title}: ${identity.mascot.flavor}`;
    }
  }
  if (gateNote){
    if (assigned){
      gateNote.textContent = `This phone is carrying ${teamIdentity(rawValue, activeTeam).displayName}. Ask an admin if you need to leave this device.`;
    } else if (activeTeam && gateMode === "join"){
      gateNote.textContent = `Tap Join hunt to lock this device to ${teamIdentity(rawValue, activeTeam).displayName}.`;
    } else {
      gateNote.textContent = "This phone will remember its team after the first join. Only admin can clear it later.";
    }
  }
  ["adminLeaveDeviceBtn"].forEach(id => {
    const button = el(id);
    if (!button) return;
    button.classList.toggle("hidden", !assigned);
    button.classList.toggle("leaveDeviceActive", assigned);
  });
  updateThemePill(rawValue, activeTeam);
}

function updateGateSelectionStatus(locked = false, identity = parseTeamIdentity(currentGateIdentityRaw(), "Team")){
  const status = el("gateSelectionStatus");
  if (!status) return;
  if (gateMode === "join"){
    status.textContent = teamKey
      ? `Join ${teamIdentity(cachedRawTeamName(teamKey) || teamFallbackLabel(teamKey), teamKey).displayName} on this device.`
      : "Choose an existing team to join.";
    return;
  }
  status.textContent = locked
    ? `${identity.displayName} is ready to create.`
    : "Create a team, pick a mascot, and the site will assign a random clue order.";
}

function renderMascotCards(selected = DEFAULT_MASCOT, locked = false){
  const mount = el("gateMascotCards");
  if (!mount) return;
  mount.innerHTML = "";
  Object.entries(MASCOTS).forEach(([key, mascot]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mascotChoice ${mascot.badgeClass}${key === selected ? " active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(key === selected));
    button.disabled = !!locked;
    button.innerHTML = `<strong>${mascot.emoji} ${escapeHtml(mascot.label)}</strong><small>${escapeHtml(mascot.title)}. ${escapeHtml(mascot.flavor)}</small>`;
    button.addEventListener("click", () => {
      if (locked) return;
      const select = el("gateMascotSelect");
      if (select) select.value = key;
      renderMascotCards(key, false);
      updateMascotPreview(key);
      renderDeviceState();
    });
    mount.appendChild(button);
  });
}

function encodeTeamIdentity(displayName, mascotKey = DEFAULT_MASCOT, fallbackName = "Team"){
  const cleanName = (displayName || fallbackName || "Team").trim() || fallbackName || "Team";
  return `${cleanName}${TEAM_IDENTITY_SEPARATOR}${normalizeMascotKey(mascotKey)}`;
}

function parseTeamIdentity(rawValue, fallbackName = "Team"){
  const fallback = (fallbackName || "Team").trim() || "Team";
  if (!rawValue || typeof rawValue !== "string") {
    const mascot = mascotMeta(DEFAULT_MASCOT);
    return { raw: encodeTeamIdentity(fallback, DEFAULT_MASCOT, fallback), displayName: fallback, mascotKey: DEFAULT_MASCOT, mascot };
  }
  const pieces = rawValue.split(TEAM_IDENTITY_SEPARATOR);
  const displayName = (pieces[0] || fallback).trim() || fallback;
  const mascotKey = normalizeMascotKey((pieces[1] || "").trim());
  const mascot = mascotMeta(mascotKey);
  return { raw: encodeTeamIdentity(displayName, mascotKey, fallback), displayName, mascotKey, mascot };
}

function teamIdentity(rawValue, team = teamKey){
  const fallback = team ? teamFallbackLabel(team) : "Team";
  return parseTeamIdentity(rawValue, fallback);
}


function hasTeamBeenClaimed(progress, team){
  if (!progress) return false;
  return Number(progress.progressIndex || 0) > 0
    || (Array.isArray(progress.completed) && progress.completed.length > 0)
    || !!progress.finished;
}

function mascotBadgeMarkup(identity, opts = {}){
  if (!identity) return "";
  const showLabel = !!opts.showLabel;
  const label = showLabel ? ` ${escapeHtml(identity.mascot.label)}` : "";
  return `<span class="mascotBadge ${identity.mascot.badgeClass}">${identity.mascot.emoji}${label}</span>`;
}

function teamThemeClass(rawValue, team = teamKey){
  return teamIdentity(rawValue, team).mascot.badgeClass;
}

function applyTeamTheme(rawValue, team = teamKey){
  const body = document.body;
  if (!body) return;
  Object.values(MASCOTS).forEach(meta => body.classList.remove(meta.badgeClass));
  body.classList.add(teamThemeClass(rawValue, team));
}

function updateMascotPreview(selected){
  const preview = el("gateMascotPreview");
  if (!preview) return;
  const mascot = mascotMeta(selected);
  preview.className = `mascotPreviewCard ${mascot.badgeClass}`;
  preview.innerHTML = `<span class="mascotPreviewEmoji">${mascot.emoji}</span><div><strong>${escapeHtml(mascot.label)} • ${escapeHtml(mascot.title)}</strong><div class="small">${escapeHtml(mascot.flavor)} This mascot becomes your badge, color theme, and hunt vibe.</div></div>`;
}

function setTeamIdentityInputs(rawValue, locked){
  const hasTeam = gateMode === "create";
  const identity = parseTeamIdentity(rawValue, hasTeam ? "Team" : "");
  const input = el("gateTeamName");
  const select = el("gateMascotSelect");
  if (input){
    const displayName = hasTeam ? identity.displayName : "";
    input.value = locked ? identity.displayName : displayName;
    input.readOnly = !!locked;
    input.disabled = !!locked;
    input.placeholder = locked ? "Team name already locked" : "Enter team name";
  }
  if (select){
    select.value = identity.mascotKey;
    select.disabled = !!locked;
  }
  renderMascotCards(identity.mascotKey, locked);
  updateMascotPreview(identity.mascotKey);
  updateGateSelectionStatus(locked, identity);
  renderDeviceState();
}

function currentGateIdentityRaw(){
  const select = el("gateMascotSelect");
  const input = el("gateTeamName");
  const mascotKey = normalizeMascotKey(select?.value || DEFAULT_MASCOT);
  const baseName = (input?.value || "").trim() || "Team";
  return encodeTeamIdentity(baseName, mascotKey, "Team");
}

function populateMascotOptions(selected = DEFAULT_MASCOT){
  const select = el("gateMascotSelect");
  if (!select) return;
  if (!select.options.length){
    Object.entries(MASCOTS).forEach(([key, mascot]) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = `${mascot.emoji} ${mascot.label}`;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      renderMascotCards(select.value, !!select.disabled);
      updateMascotPreview(select.value);
      renderDeviceState();
    });
  }
  select.value = normalizeMascotKey(selected);
  renderMascotCards(select.value, !!select.disabled);
  updateMascotPreview(select.value);
}

function joinableTeamSummaries(){
  return visibleTeamIds().map(id => {
    const progress = progressStateFor(id);
    const row = cachedBoardState(id) || {};
    const rawName = progress?.teamName || row.team_name || row.teamName || teamFallbackLabel(id);
    const identity = teamIdentity(rawName, id);
    return {
      id,
      rawName,
      identity,
      progress,
      found: row.found ?? progress?.completed?.length ?? 0,
      finished: row.finished ?? progress?.finished ?? false,
      lastUpdatedAt: row.lastUpdatedAt ?? row.last_updated_at ?? progress?.lastUpdatedAt ?? 0
    };
  }).sort((a, b) => a.identity.displayName.localeCompare(b.identity.displayName));
}

function findExistingTeamByName(displayName){
  const target = normalizeTeamName(displayName);
  return joinableTeamSummaries().find(entry => normalizeTeamName(entry.identity.displayName) === target) || null;
}

function setGateMode(mode){
  gateMode = mode === "create" ? "create" : "join";
  const joinBtn = el("gateModeJoinBtn");
  const createBtn = el("gateModeCreateBtn");
  const joinWrap = el("gateJoinWrap");
  const createWrap = el("gateCreateWrap");
  const startBtn = el("startGameBtn");
  if (joinBtn) joinBtn.classList.toggle("active", gateMode === "join");
  if (createBtn) createBtn.classList.toggle("active", gateMode === "create");
  if (joinWrap) joinWrap.classList.toggle("hidden", gateMode !== "join");
  if (createWrap) createWrap.classList.toggle("hidden", gateMode !== "create");
  if (startBtn) startBtn.textContent = gateMode === "create" ? "Create team and start" : "Join hunt";
  if (gateMode === "create"){
    teamKey = null;
    setTeamIdentityInputs(currentGateIdentityRaw(), false);
  }
  renderGateTeams(teamKey);
  updateGateSelectionStatus();
  renderDeviceState();
}

function buildEggProgressDots(){
  const mount = el("eggProgress");
  if (!mount || !teamKey) return;
  mount.innerHTML = "";
  const total = teamTotal();
  for (let i = 0; i < total; i += 1){
    const dot = document.createElement("span");
    dot.className = "eggDot";
    if (i < state.completed.length) dot.classList.add("complete");
    else if (i === state.progressIndex && !state.finished) dot.classList.add("current");
    mount.appendChild(dot);
  }
}

function playUiTone(kind = "success"){
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    if (!audioContext) audioContext = new AudioCtor();
    if (audioContext.state === "suspended") audioContext.resume();
    const notes = kind === "victory"
      ? [523.25, 659.25, 783.99]
      : kind === "wrong"
        ? [246.94, 220]
        : [392, 523.25];
    notes.forEach((frequency, idx) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = kind === "wrong" ? "triangle" : "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(kind === "wrong" ? 0.03 : 0.05, audioContext.currentTime + idx * 0.07 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + idx * 0.07 + 0.18);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(audioContext.currentTime + idx * 0.07);
      osc.stop(audioContext.currentTime + idx * 0.07 + 0.2);
    });
  } catch (error) {
    console.error(error);
  }
}

function burstCelebration(type = "success"){
  const emojis = type === "victory" ? ["🍬","🏁","✨","🥚","🎉"] : ["✨","🥚","✅","🐰"];
  for (let i = 0; i < 12; i += 1){
    const piece = document.createElement("span");
    piece.className = "burstEmoji";
    piece.textContent = emojis[i % emojis.length];
    piece.style.setProperty("--dx", `${(Math.random() * 320 - 160).toFixed(0)}px`);
    piece.style.setProperty("--dy", `${(-220 - Math.random() * 180).toFixed(0)}px`);
    document.body.appendChild(piece);
    piece.addEventListener("animationend", () => piece.remove(), { once: true });
  }
  playUiTone(type === "victory" ? "victory" : "success");
  if (navigator.vibrate) navigator.vibrate(type === "victory" ? [120, 70, 180] : [80, 40, 110]);
}

function showMissionOverlay({ badge = "✅ Mission update", title = "Mission unlocked", copy = "You unlocked your next clue.", flavor = "A fresh page just slid out of the dossier.", stamp = "CASE FILE OPENED", meta = "Head back to the mission board for your next riddle.", page = "choresPage" } = {}){
  if (el("missionBadge")) el("missionBadge").textContent = badge;
  if (el("missionTitle")) el("missionTitle").textContent = title;
  if (el("missionCopy")) el("missionCopy").textContent = copy;
  if (el("missionFlavor")) el("missionFlavor").textContent = flavor;
  if (el("missionStamp")) el("missionStamp").textContent = stamp;
  if (el("missionMeta")) el("missionMeta").textContent = meta;
  const btn = el("missionActionBtn");
  if (btn) btn.onclick = () => {
    hideMissionOverlay();
    setPage(page);
  };
  const overlay = el("missionOverlay");
  if (overlay) overlay.classList.remove("hidden");
}

function hideMissionOverlay(){
  const overlay = el("missionOverlay");
  if (overlay) overlay.classList.add("hidden");
}

function renderLeadBanner(rows = boardRows()){
  const banner = el("leadBanner");
  if (!banner) return;
  const activeRows = rows.filter(row => row.found > 0 || row.finished);
  if (!activeRows.length){
    banner.textContent = "The race is on. Crack the first egg and take the lead.";
    return;
  }
  const leader = rows[0];
  const identity = teamIdentity(leader.teamNameRaw || leader.teamName, leader.key);
  const suffix = leader.finished ? `${placementPrizeText(1)} goes to Andy.` : `${leader.found} clues solved so far.`;
  banner.innerHTML = `${mascotBadgeMarkup(identity)} <span><strong>${escapeHtml(identity.displayName)}</strong> is currently in the lead. ${escapeHtml(suffix)}</span>`;
}

function updateFinalMissionMode(){
  document.body.classList.toggle("finalMissionMode", !!state && (isOnFinalClue(state, teamKey) || state.finished));
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
  const { error } = await supabaseClient.from("team_progress_sigtau").upsert(payload, { onConflict: "team_id" });
  if (error) {
    console.error(error);
    setSyncState("error", "Shared map settings failed to update. Retrying soon.");
  } else {
    setSyncState("live", "Shared progress is live across devices.");
  }
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

function defaultState(teamLabel = "Team", sequence = generateRandomSequence()){
  return {
    teamName: encodeTeamIdentity(teamLabel, DEFAULT_MASCOT, teamLabel),
    sequence: normalizeSequence(sequence),
    progressIndex: 0,
    completed: [],
    scannedTokens: [],
    usedHints: 0,
    nextHintAt: null,
    revealedHintClueId: null,
    finished: false,
    startedAt: 0,
    lastUpdatedAt: 0
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
  const saved = readJson(storageKey(team), defaultState(teamFallbackLabel(team), sequenceForTeam(team)));
  if (!saved || typeof saved !== "object") return defaultState(teamFallbackLabel(team), sequenceForTeam(team));
  saved.sequence = normalizeSequence(saved.sequence || sequenceForTeam(team, saved));
  if (saved && typeof saved.revealedHintClueId === "undefined") saved.revealedHintClueId = null;
  return saved;
}
