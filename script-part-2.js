
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

function buildBoardRow(key, rawName, found, finished, lastUpdatedAt){
  const identity = teamIdentity(rawName, key);
  return {
    key,
    teamName: identity.displayName,
    teamNameRaw: identity.raw,
    mascotKey: identity.mascotKey,
    mascot: identity.mascot,
    found,
    finished,
    lastUpdatedAt,
    sequence: sequenceForTeam(key, liveProgressCache[key] || loadLocalState(key))
  };
}

function localBoardRows(){
  const board = readJson(leaderboardKey(), {});
  return visibleTeamIds().map(key => buildBoardRow(
    key,
    board[key]?.teamName || loadLocalState(key)?.teamName || teamFallbackLabel(key),
    board[key]?.found || 0,
    board[key]?.finished || false,
    board[key]?.lastUpdatedAt || 0
  )).sort(compareBoardRows);
}

function remoteBoardRows(){
  return visibleTeamIds().map(key => buildBoardRow(
    key,
    liveBoardCache[key]?.team_name || liveProgressCache[key]?.teamName || teamFallbackLabel(key),
    liveBoardCache[key]?.found || liveProgressCache[key]?.completed?.length || 0,
    liveBoardCache[key]?.finished || liveProgressCache[key]?.finished || false,
    liveBoardCache[key]?.last_updated_at || liveProgressCache[key]?.lastUpdatedAt || 0
  )).sort(compareBoardRows);
}

function boardRows(){
  return supabaseReady ? remoteBoardRows() : localBoardRows();
}

function teamTotal(team = teamKey){
  return sequenceForTeam(team, team === teamKey ? state : liveProgressCache[team] || loadLocalState(team)).length;
}

function isReadyForVictory(targetState, team = teamKey){
  return !!targetState && targetState.finished;
}

function isOnFinalClue(targetState, team = teamKey){
  if (!targetState || targetState.finished) return false;
  return Number(currentClueId(targetState, team)) === FINAL_CLUE_ID;
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
  return CLUES[FINAL_CLUE_ID] || {
    title: "FINAL EGG: Find the last egg!",
    location: "Final egg location",
    hint: "Find the final egg."
  };
}

function finalEggReadyMessage(){
  return "Your final clue is unlocked. Find the final egg and scan its QR code to finish.";
}

function setFeedback(msg, tone = "info"){
  const box = el("feedbackBox");
  if (!box) return;
  box.textContent = msg;
  box.classList.remove("feedbackSuccess", "feedbackWarn", "feedbackError");
  if (tone === "success") box.classList.add("feedbackSuccess");
  if (tone === "warn") box.classList.add("feedbackWarn");
  if (tone === "error") box.classList.add("feedbackError");
}
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

function describeWrongToken(token){
  const trimmed = String(token || "").trim();
  if (!trimmed) return "No code was detected. Try filling more of the frame with the QR.";
  const clueId = clueIdForToken(trimmed);
  if (!clueId){
    return "That QR is not in this hunt set. Make sure you are scanning one of the live house eggs.";
  }
  const clue = CLUES[clueId];
  if (teamKey && state){
    const sequence = sequenceForTeam(teamKey, state);
    const stepIndex = sequence.indexOf(clueId);
    if (stepIndex >= 0){
      return `That QR belongs to your step ${stepIndex + 1}${clue ? ` at ${clue.location}` : ""}, but this device only accepts your next live QR.`;
    }
  }
  return `That QR belongs to ${clue?.location || `clue ${clueId}`}. This device only accepts the next live QR for your team.`;
}

function normalizeRemoteProgress(data){
  if (!data) return null;
  return {
    teamName: data.team_name,
    sequence: normalizeSequence(data.sequence),
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
  if (remoteProgress?.teamName) return remoteProgress.teamName;
  const rawLocal = localStorage.getItem(storageKey(team));
  if (rawLocal){
    const local = readJson(storageKey(team), null);
    if (local?.teamName) return local.teamName;
  }
  return null;
}

function describeSharedProgressChange(team, previous, next){
  if (!next || team === SHARED_SETTINGS_TEAM_ID) return null;
  const identity = teamIdentity(next.teamName, team);
  const name = `${identity.displayName} ${identity.mascot.emoji}`;
  if (!previous) return `${name} just joined the hunt.`;
  if (!previous.finished && next.finished) return `${name} just found the final egg and locked in a finish.`;
  if (previous.teamName !== next.teamName) return `${identity.displayName} updated its team identity.`;
  if (Number(next.progressIndex || 0) > Number(previous.progressIndex || 0)) {
    const solvedId = Array.isArray(next.completed) && next.completed.length ? next.completed[next.completed.length - 1] : null;
    const solved = solvedId ? CLUES[solvedId] : null;
    if (isOnFinalClue(next, team)) return `${name} just unlocked the final clue.`;
    return `${name} just cleared ${solved?.location || "a clue"} and moved ahead.`;
  }
  return null;
}

function updateSharedModeText(){
  renderSyncBadge();
}

async function initSupabase(){
  try{
    setSyncState("pending", "Connecting to shared game...");
    const cfg = (window.SUPABASE_CONFIG && typeof window.SUPABASE_CONFIG === "object") ? window.SUPABASE_CONFIG : {};
    const url = cfg.url || window.SUPABASE_URL || "";
    const anonKey = cfg.anonKey || window.SUPABASE_ANON_KEY || "";
    if (!url || !anonKey || String(url).startsWith("PASTE_")){
      if (el("leaderboardModeText")){
        el("leaderboardModeText").textContent = "Using local device leaderboard only.";
        el("leaderboardModeText").hidden = false;
        el("leaderboardModeText").style.display = "block";
      }
      setSyncState("local", "Cross-device sync needs Supabase configured in supabase-config.js.");
      updateSharedModeText();
      renderBoard();
      return;
    }
    supabaseClient = window.supabase.createClient(url, anonKey);
    supabaseReady = true;
    if (el("leaderboardModeText")){
      el("leaderboardModeText").textContent = "";
      el("leaderboardModeText").hidden = true;
      el("leaderboardModeText").style.display = "none";
    }
    await Promise.allSettled([fetchLeaderboard(), fetchAllRemoteProgress()]);
    setSyncState("live", "Shared progress is live across devices.");
    updateSharedModeText();
    subscribeLeaderboard();
    subscribeTeamProgress();
  } catch (error){
    console.error(error);
    supabaseReady = false;
    if (el("leaderboardModeText")){
      el("leaderboardModeText").textContent = "Using local device leaderboard only.";
      el("leaderboardModeText").hidden = false;
      el("leaderboardModeText").style.display = "block";
    }
    setSyncState("error", "Shared sync hit a snag. Using device cache while it reconnects.");
    updateSharedModeText();
    renderBoard();
  }
}

async function fetchLeaderboard(){
  if (!supabaseReady) return;
  const { data, error } = await supabaseClient.from("leaderboard_sigtau").select("*");
  if (error){
    console.error(error);
    setSyncState("error", "Leaderboard refresh failed. Realtime may reconnect shortly.");
    return;
  }
  setSyncState("live", "Shared progress is live across devices.");
  liveBoardCache = {};
  const boardCache = {};
  (data || []).forEach(row => {
    liveBoardCache[row.team_id] = row;
    boardCache[row.team_id] = {
      teamName: row.team_name,
      found: row.found,
      finished: row.finished,
      lastUpdatedAt: row.last_updated_at
    };
  });
  localStorage.setItem(leaderboardKey(), JSON.stringify(boardCache));
  renderGateTeams(teamKey);
  renderBoard();
}

async function fetchAllRemoteProgress(){
  if (!supabaseReady) return;
  const { data, error } = await supabaseClient.from("team_progress_sigtau").select("*");
  if (error){
    console.error(error);
    setSyncState("error", "Shared team progress stalled. Trying again in the background.");
    return;
  }
  const previousCache = { ...liveProgressCache };
  liveProgressCache = {};
  (data || []).forEach(row => {
    const normalized = normalizeRemoteProgress(row);
    const previous = previousCache[row.team_id];
    const local = loadLocalState(row.team_id);
    if (local && Number(local.startedAt || 0) === Number(normalized.startedAt || 0) && Number(local.progressIndex || 0) === Number(normalized.progressIndex || 0) && local.revealedHintClueId != null && normalized.revealedHintClueId == null) {
      normalized.revealedHintClueId = local.revealedHintClueId;
    }
    liveProgressCache[row.team_id] = normalized;
    localStorage.setItem(storageKey(row.team_id), JSON.stringify(normalized));
    if (sharedDataPrimed) pushSharedActivity(describeSharedProgressChange(row.team_id, previous, normalized));
  });
  sharedDataPrimed = true;
  setSyncState("live", "Shared progress is live across devices.");
  renderGateTeams(teamKey);
  renderAdminStatuses();
}

function subscribeLeaderboard(){
  if (!supabaseReady) return;
  supabaseClient.channel("leaderboard-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "leaderboard_sigtau" }, payload => {
      const row = payload.new || payload.old;
      if (!row || !row.team_id) return;
      const localBoard = readJson(leaderboardKey(), {});
      if (payload.eventType === "DELETE") {
        delete liveBoardCache[row.team_id];
        delete localBoard[row.team_id];
      } else {
        liveBoardCache[row.team_id] = row;
        localBoard[row.team_id] = {
          teamName: row.team_name,
          found: row.found,
          finished: row.finished,
          lastUpdatedAt: row.last_updated_at
        };
      }
      localStorage.setItem(leaderboardKey(), JSON.stringify(localBoard));
      setSyncState("live", "Shared progress is live across devices.");
      populateAdminTeams();
      renderBoard();
    }).subscribe();
}

function maybeRefreshGateSelection(){
  if (!el("teamGate") || el("teamGate").classList.contains("hidden")) return;
  renderGateTeams(teamKey);
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
        const localBoard = readJson(leaderboardKey(), {});
        delete localBoard[row.team_id];
        localStorage.setItem(leaderboardKey(), JSON.stringify(localBoard));
        const remembered = rememberedTeamRecord();
        if ((remembered && remembered.team === row.team_id) || teamKey === row.team_id){
          releaseTeamSelection("That team was cleared. Pick a team to join again.");
        }
      } else {
        const previous = liveProgressCache[row.team_id];
        const normalized = normalizeRemoteProgress(row);
        const local = loadLocalState(row.team_id);
        if (local && Number(local.startedAt || 0) === Number(normalized.startedAt || 0) && Number(local.progressIndex || 0) === Number(normalized.progressIndex || 0) && local.revealedHintClueId != null && normalized.revealedHintClueId == null) {
          normalized.revealedHintClueId = local.revealedHintClueId;
        }
        liveProgressCache[row.team_id] = normalized;
        localStorage.setItem(storageKey(row.team_id), JSON.stringify(normalized));
        pushSharedActivity(describeSharedProgressChange(row.team_id, previous, normalized));
        setSyncState("live", "Shared progress is live across devices.");

        const remembered = rememberedTeamRecord();
        const startedChanged = remembered && remembered.team === row.team_id
          && Number(remembered.startedAt || 0) !== Number(normalized.startedAt || 0);

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
      populateAdminTeams();
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
    setSyncState("error", "A shared team lookup failed. Trying again in the background.");
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
    setSyncState("live", "Shared progress is live across devices.");
  }
  return normalized;
}

async function getClaimedTeamName(team){
  const cached = getCachedClaimedTeamName(team);
  if (cached) return cached;
  const remote = await loadRemoteProgress(team);
  if (remote && hasTeamBeenClaimed(remote, team)) return remote.teamName;
  return null;
}

function setGateNameLock(locked, value){
  const fallback = teamExists(teamKey) ? teamFallbackLabel(teamKey) : "Team";
  populateMascotOptions(parseTeamIdentity(value, fallback).mascotKey);
  setTeamIdentityInputs(value || fallback, locked);
}

async function pushRemoteProgress(){
  if (!supabaseReady || !teamKey || !state) return;
  const payload = {
    team_id: teamKey,
    team_name: state.teamName,
    sequence: state.sequence,
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
  if (error) {
    console.error(error);
    setSyncState("error", "Shared progress write failed. Retrying on the next refresh.");
  } else {
    setSyncState("live", "Shared progress is live across devices.");
  }
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
  if (error) {
    console.error(error);
    setSyncState("error", "Shared leaderboard write failed. Retrying in the background.");
  } else {
    setSyncState("live", "Shared progress is live across devices.");
  }
}

function cacheTeamLocally(team, targetState){
  liveProgressCache[team] = { ...targetState };
  localStorage.setItem(storageKey(team), JSON.stringify(targetState));
}

function cacheBoardLocally(team, targetState){
  const localBoard = readJson(leaderboardKey(), {});
  localBoard[team] = {
    teamName: targetState.teamName,
    found: targetState.completed.length,
    finished: targetState.finished,
    lastUpdatedAt: targetState.lastUpdatedAt
  };
  localStorage.setItem(leaderboardKey(), JSON.stringify(localBoard));
  liveBoardCache[team] = {
    team_id: team,
    team_name: targetState.teamName,
    found: targetState.completed.length,
    finished: targetState.finished,
    last_updated_at: targetState.lastUpdatedAt
  };
}

async function upsertSharedTeamState(team, targetState){
  cacheTeamLocally(team, targetState);
  cacheBoardLocally(team, targetState);
  if (!supabaseReady) return;
  const progressResult = await supabaseClient.from("team_progress_sigtau").upsert({
    team_id: team,
    team_name: targetState.teamName,
    sequence: targetState.sequence,
    progress_index: targetState.progressIndex,
    completed: targetState.completed,
    scanned_tokens: targetState.scannedTokens,
    used_hints: targetState.usedHints,
    next_hint_at: targetState.nextHintAt,
    finished: targetState.finished,
    started_at: targetState.startedAt,
    last_updated_at: targetState.lastUpdatedAt
  }, { onConflict: "team_id" });

  const boardResult = await supabaseClient.from("leaderboard_sigtau").upsert({
    team_id: team,
    team_name: targetState.teamName,
    found: targetState.completed.length,
    finished: targetState.finished,
    last_updated_at: targetState.lastUpdatedAt
  }, { onConflict: "team_id" });

  if (progressResult.error || boardResult.error){
    console.error(progressResult.error || boardResult.error);
    setSyncState("error", "Shared progress write failed. Retrying on the next refresh.");
  } else {
    setSyncState("live", "Shared progress is live across devices.");
  }
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
  const emptyNote = el("emptyJoinNote");
  const teams = joinableTeamSummaries();
  if (selected && !teams.some(entry => entry.id === selected)) teamKey = null;
  if (emptyNote) emptyNote.classList.toggle("hidden", teams.length > 0);
  teams.forEach(entry => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "teamBtn" + (entry.id === selected ? " selected" : "");
    btn.innerHTML = `<span class="teamBtnLabel">${escapeHtml(entry.identity.displayName)}</span><span class="teamBtnMeta">${escapeHtml(entry.finished ? "Finished hunt" : entry.found > 0 ? `${entry.found} clues cleared` : "Ready to join")}</span>`;
    btn.addEventListener("click", async () => {
      const selectedTeam = entry.id;
      teamKey = selectedTeam;
      renderGateTeams(teamKey);
      renderDeviceState();
    });
    mount.appendChild(btn);
  });
  if (!teams.length) teamKey = gateMode === "join" ? null : teamKey;
  renderDeviceState();
}

function renderTop(){
  if (!teamKey || !state) return;
  const total = sequenceForTeam(teamKey, state).length;
  const activeId = currentClueId();
  const stats = hintStats(state);
  const locked = clueAllowsHint(activeId) && state.nextHintAt && now < toMillis(state.nextHintAt);
  const identity = teamIdentity(state.teamName, teamKey);
  el("progressCount").textContent = `${state.completed.length} / ${total}`;
  el("progressBar").style.width = `${(state.completed.length / total) * 100}%`;
  buildEggProgressDots();
  el("hintCount").textContent = `${stats.usedDisplay} / ${stats.total}`;
  el("hintStatus").textContent = !clueAllowsHint(activeId)
    ? "No hint for this clue"
    : (locked ? `Next hint in ${fmtCountdown(toMillis(state.nextHintAt) - now)}` : (stats.remaining <= 0 ? "No hints left" : "Hint ready"));
  el("teamDisplay").innerHTML = `${mascotBadgeMarkup(identity, { showLabel: true })}<span><strong>${escapeHtml(identity.displayName)}</strong><div class="small">${escapeHtml(identity.mascot.title)}</div></span>`;
  applyTeamTheme(state.teamName, teamKey);
  renderDeviceState();
  updateFinalMissionMode();
}

function renderChores(){
  if (!teamKey || !state) return;
  const seq = sequenceForTeam(teamKey, state);
  const list = el("choreList");
  list.innerHTML = "";
  seq.forEach((id, idx) => {
    const div = document.createElement("div");
    div.className = idx < state.progressIndex ? "item complete" : idx === state.progressIndex ? "item active" : "item locked";
    const clue = CLUES[id];
    const stateLabel = idx < state.progressIndex ? "Cleared" : idx === state.progressIndex ? "Live clue" : "Sealed";
    const header = `<div class="clueHeader"><span class="clueIndex">Case ${idx + 1}</span><span class="clueState">${stateLabel}</span></div>`;
    if (idx < state.progressIndex) {
      div.innerHTML = `${header}<strong>${clue.title}</strong>${clue.subtitle ? `<div class="muted">${clue.subtitle}</div>` : ""}<div class="muted">Found at: <strong>${clue.location}</strong></div>`;
    } else if (idx === state.progressIndex) {
      const activeCopy = isOnFinalClue(state, teamKey)
        ? "Find the final egg, scan its QR, and lock in your finish."
        : "Crack the QR code to unlock the next mission.";
      div.innerHTML = `${header}<strong>${clue.title}</strong>${clue.subtitle ? `<div class="muted">${clue.subtitle}</div>` : ""}<div class="muted">${activeCopy}</div>`;
    } else {
      div.innerHTML = `${header}<strong>Locked mission</strong><div class="muted">Scan the correct egg to unlock this item.</div>`;
    }
    list.appendChild(div);
  });
}

function renderMap(){
  applyMapVisibility();
  if (!isMapEnabled()) return;
  if (!teamKey || !state) return;
  const seq = sequenceForTeam(teamKey, state);
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
  const rows = boardRows();
  board.innerHTML = "";
  renderLeadBanner(rows);
  renderActivityTicker();
  rows.forEach((row, i) => {
    const place = i + 1;
    const trophy = row.finished ? trophyInfoForPlacement(place) : null;
    const identity = teamIdentity(row.teamNameRaw || row.teamName, row.key);
    const div = document.createElement("div");
    div.className = `leaderRow ${identity.mascot.badgeClass}`;
    div.innerHTML = `
      <div class="leaderMain">
        ${trophy ? `<span class="${trophy.className}" aria-label="${trophy.label}">${trophy.icon}</span>` : mascotBadgeMarkup(identity)}
        <div class="leaderText">
          <strong>${place}. ${escapeHtml(identity.displayName)}</strong>
          <div class="leaderSubline">
            ${mascotBadgeMarkup(identity, { showLabel: true })}
            <span class="leaderMiniMeta">${escapeHtml(row.finished ? "Finished" : row.found > 0 ? `${row.found} clues cleared` : "Ready")}</span>
            ${place <= 3 && row.finished ? `<span class="candyBadge">🍬 ${escapeHtml(placementPrizeText(place))}</span>` : ""}
          </div>
          <div class="muted">${row.finished ? `${placementLabel(place)} • ${placementPrizeText(place)} at Andy's table` : (row.sequence?.[row.found] === FINAL_CLUE_ID ? "Final clue unlocked" : "In progress")}</div>
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
  const teams = joinableTeamSummaries();
  if (!teams.length){
    mount.innerHTML = `<div class="note">No teams have been created yet.</div>`;
    return;
  }
  teams.forEach(entry => {
    const key = entry.id;
    const progress = progressStateFor(key) || defaultState(teamFallbackLabel(key));
    const currentId = sequenceForTeam(key, progress)[progress.progressIndex];
    const current = currentId ? CLUES[currentId] : null;
    const lastSolvedId = Array.isArray(progress.completed) && progress.completed.length ? progress.completed[progress.completed.length - 1] : null;
    const lastSolved = lastSolvedId ? CLUES[lastSolvedId] : null;
    const identity = teamIdentity(progress.teamName, key);
    const row = document.createElement("div");
    row.className = `adminStatusRow ${identity.mascot.badgeClass}`;
    row.innerHTML = `
      <strong>${escapeHtml(identity.displayName)}</strong>
      <div class="leaderSubline">
        ${mascotBadgeMarkup(identity, { showLabel: true })}
        <span class="leaderMiniMeta">${escapeHtml(progress.finished ? "Finished" : `Step ${Math.min(progress.progressIndex + 1, teamTotal(key))} of ${teamTotal(key)}`)}</span>
      </div>
      <div class="adminStatusLocation">${progress.finished ? "Finished" : current ? `On clue ${progress.progressIndex + 1}: ${escapeHtml(current.location)}` : "Not started"}</div>
      <div class="adminStatusMeta">${progress.completed?.length || 0} clues found${lastSolved ? ` • Last cleared: ${escapeHtml(lastSolved.location)}` : ""}</div>`;
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
  renderDeviceState();
  renderSyncBadge();
  updateFinalMissionMode();
  if (shouldPersist) await persistAll();
}

