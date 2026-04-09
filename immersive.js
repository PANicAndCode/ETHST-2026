(function(){
  if (typeof document === "undefined") return;

  const $el = typeof el === "function" ? el : (id => document.getElementById(id));
  let syncState = "pending";
  let syncMessage = "Connecting to shared game...";
  let sharedActivities = [];
  let sharedDataPrimed = false;
  let immersiveAudioContext = null;

  Object.assign(MASCOTS.rabbit, { title: "Burrow Blitz", flavor: "Fast starts, lucky breaks, and spring chaos." });
  Object.assign(MASCOTS.knight, { title: "Honor Guard", flavor: "Steady hands, brave scans, and noble finishes." });
  Object.assign(MASCOTS.raven, { title: "Night Watch", flavor: "Sharp eyes, sly routes, and quiet steals." });
  Object.assign(MASCOTS.wolf, { title: "Moon Pack", flavor: "Hunt together, move fast, and never flinch." });
  Object.assign(MASCOTS.fox, { title: "Firetrail Crew", flavor: "Quick pivots, clever reads, and flashy escapes." });
  Object.assign(MASCOTS.cobra, { title: "Garden Strike", flavor: "Patient reads, perfect timing, and clean finishes." });

  function syncMessageForState(mode){
    if (mode === "live") return "Shared progress is live across devices.";
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
    const badge = $el("syncBadge");
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
    const shared = $el("sharedModeText");
    if (shared){
      shared.hidden = false;
      shared.style.display = "block";
      shared.textContent = syncMessage || syncMessageForState(syncState);
    }
  }

  function setScanInsight(message = "", tone = ""){
    const box = $el("scanInsight");
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
    const ticker = $el("activityTicker");
    if (!ticker) return;
    ticker.textContent = sharedActivities[0]?.message || "Rival movement and admin updates will appear here.";
  }

  function updateThemePill(rawValue = state?.teamName, team = teamKey){
    const pill = $el("teamThemePill");
    if (!pill) return;
    if (!rawValue || !team || !TEAMS[team]){
      pill.className = "teamThemePill";
      pill.textContent = "Mascot theme waiting";
      return;
    }
    const identity = teamIdentity(rawValue, team);
    pill.className = `teamThemePill ${identity.mascot.badgeClass}`;
    pill.textContent = `${identity.mascot.emoji} ${identity.mascot.title}`;
  }

  function renderDeviceState(){
    const badge = $el("deviceTeamBadge");
    const meta = $el("deviceStatusMeta");
    const gateNote = $el("gateDeviceNote");
    const remembered = typeof rememberedTeam === "function" ? rememberedTeam() : null;
    const activeTeam = teamKey || remembered;
    const rawValue = state?.teamName
      || (teamKey && TEAMS[teamKey] && typeof currentGateIdentityRaw === "function" ? currentGateIdentityRaw() : null)
      || (activeTeam && TEAMS[activeTeam] ? encodeTeamIdentity(TEAMS[activeTeam].label, DEFAULT_MASCOT, TEAMS[activeTeam].label) : null);
    const assigned = !!(activeTeam && TEAMS[activeTeam]);
    if (badge){
      if (!assigned){
        badge.textContent = "No team on this device";
      } else {
        const identity = teamIdentity(rawValue, activeTeam);
        badge.innerHTML = `${mascotBadgeMarkup(identity)} <span>${escapeHtml(TEAMS[activeTeam].label)} • ${escapeHtml(identity.displayName)}</span>`;
      }
    }
    if (meta){
      if (!assigned){
        meta.textContent = "Choose a team, claim a mascot, and start the hunt.";
      } else {
        const identity = teamIdentity(rawValue, activeTeam);
        meta.textContent = `${identity.mascot.title}: ${identity.mascot.flavor}`;
      }
    }
    if (gateNote){
      gateNote.textContent = assigned
        ? `This phone is carrying ${TEAMS[activeTeam].label}. Use Leave this device if you want to hand it to another team.`
        : "This phone will remember its team until you tell it to leave this device.";
    }
    ["leaveDeviceBtn", "gateLeaveDeviceBtn"].forEach(id => {
      const button = $el(id);
      if (!button) return;
      button.classList.toggle("hidden", !assigned);
      button.classList.toggle("leaveDeviceActive", assigned);
    });
    updateThemePill(rawValue, activeTeam);
  }

  function updateGateSelectionStatus(locked, identity){
    const status = $el("gateSelectionStatus");
    if (!status) return;
    if (!teamKey || !TEAMS[teamKey]){
      status.textContent = "Choose a team to unlock your mascot roster.";
      return;
    }
    if (locked){
      status.textContent = `${TEAMS[teamKey].label} is already locked in as ${identity.displayName}.`;
      return;
    }
    status.textContent = `${TEAMS[teamKey].label} is open. Pick a mascot, give it a rally name, and start the chase.`;
  }

  function renderMascotCards(selected = DEFAULT_MASCOT, locked = false){
    const mount = $el("gateMascotCards");
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
        const select = $el("gateMascotSelect");
        if (select) select.value = key;
        renderMascotCards(key, false);
        updateMascotPreview(key);
        renderDeviceState();
      });
      mount.appendChild(button);
    });
  }

  function playUiTone(kind = "success"){
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      if (!immersiveAudioContext) immersiveAudioContext = new AudioCtor();
      if (immersiveAudioContext.state === "suspended") immersiveAudioContext.resume();
      const notes = kind === "victory"
        ? [523.25, 659.25, 783.99]
        : kind === "wrong"
          ? [246.94, 220]
          : [392, 523.25];
      notes.forEach((frequency, idx) => {
        const osc = immersiveAudioContext.createOscillator();
        const gain = immersiveAudioContext.createGain();
        osc.type = kind === "wrong" ? "triangle" : "sine";
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, immersiveAudioContext.currentTime + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(kind === "wrong" ? 0.03 : 0.05, immersiveAudioContext.currentTime + idx * 0.07 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, immersiveAudioContext.currentTime + idx * 0.07 + 0.18);
        osc.connect(gain);
        gain.connect(immersiveAudioContext.destination);
        osc.start(immersiveAudioContext.currentTime + idx * 0.07);
        osc.stop(immersiveAudioContext.currentTime + idx * 0.07 + 0.2);
      });
    } catch (error){
      console.error(error);
    }
  }

  function describeSharedProgressChange(team, previous, next){
    if (!next || team === SHARED_SETTINGS_TEAM_ID) return null;
    const identity = teamIdentity(next.teamName, team);
    const name = `${identity.displayName} ${identity.mascot.emoji}`;
    if (!previous) return null;
    if (!previous.finished && next.finished) return `${name} just found the final egg and locked in a finish.`;
    if (previous.teamName !== next.teamName) return `${TEAMS[team].label} is now racing as ${identity.displayName}.`;
    if (Number(next.progressIndex || 0) > Number(previous.progressIndex || 0)) {
      const solvedId = Array.isArray(next.completed) && next.completed.length ? next.completed[next.completed.length - 1] : null;
      const solved = solvedId ? CLUES[solvedId] : null;
      if (isOnFinalClue(next, team)) return `${name} just unlocked the final clue.`;
      return `${name} just cleared ${solved?.location || "a clue"} and moved ahead.`;
    }
    return null;
  }

  function describeWrongToken(token){
    const trimmed = String(token || "").trim();
    if (!trimmed) return "No code was detected. Try filling more of the frame with the QR.";
    const matches = [];
    Object.entries(TOKENS).forEach(([team, tokens]) => {
      const idx = tokens.findIndex(value => value === trimmed);
      if (idx >= 0) matches.push({ team, step: idx + 1, clueId: TEAMS[team]?.sequence?.[idx] });
    });
    if (!matches.length){
      return "That QR is not in this hunt set. Make sure you are scanning one of the live house eggs.";
    }
    const ownMatch = teamKey ? matches.find(match => match.team === teamKey) : null;
    if (ownMatch){
      const clue = CLUES[ownMatch.clueId];
      return `That QR belongs to ${TEAMS[teamKey].label}'s step ${ownMatch.step}${clue ? ` at ${clue.location}` : ""}, but this phone only accepts your next live QR.`;
    }
    const match = matches[0];
    const clue = CLUES[match.clueId];
    return `That QR belongs to ${TEAMS[match.team].label}${clue ? ` at ${clue.location}` : ""}. This device only accepts the next live QR for ${TEAMS[teamKey]?.label || "your team"}.`;
  }

  function leaveThisDevice(){
    if (!rememberedTeam() && !teamKey && !state) return;
    if (!window.confirm("Clear this device's saved team and make it ready for a new squad?")) return;
    releaseTeamSelection("This device is ready for a different team.");
  }

  const originalInitSupabase = initSupabase;
  initSupabase = async function(){
    setSyncState("pending", "Connecting to shared game...");
    try {
      const result = await originalInitSupabase.apply(this, arguments);
      setSyncState(supabaseReady ? "live" : "local", supabaseReady ? "Shared progress is live across devices." : "Cross-device sync needs Supabase configured in supabase-config.js.");
      return result;
    } catch (error){
      setSyncState("error", "Shared sync hit a snag. Using device cache while it reconnects.");
      throw error;
    }
  };

  const originalFetchLeaderboard = fetchLeaderboard;
  fetchLeaderboard = async function(){
    try {
      const result = await originalFetchLeaderboard.apply(this, arguments);
      if (supabaseReady) setSyncState("live", "Shared progress is live across devices.");
      return result;
    } catch (error){
      setSyncState("error", "Leaderboard refresh failed. Realtime may reconnect shortly.");
      throw error;
    }
  };

  const originalFetchAllRemoteProgress = fetchAllRemoteProgress;
  fetchAllRemoteProgress = async function(){
    const previousCache = {};
    Object.entries(liveProgressCache || {}).forEach(([key, value]) => {
      previousCache[key] = value ? { ...value } : value;
    });
    try {
      const result = await originalFetchAllRemoteProgress.apply(this, arguments);
      Object.entries(liveProgressCache || {}).forEach(([key, next]) => {
        if (sharedDataPrimed) pushSharedActivity(describeSharedProgressChange(key, previousCache[key], next));
      });
      sharedDataPrimed = true;
      if (supabaseReady) setSyncState("live", "Shared progress is live across devices.");
      renderActivityTicker();
      return result;
    } catch (error){
      setSyncState("error", "Shared team progress stalled. Trying again in the background.");
      throw error;
    }
  };

  const originalLoadRemoteProgress = loadRemoteProgress;
  loadRemoteProgress = async function(){
    try {
      const result = await originalLoadRemoteProgress.apply(this, arguments);
      if (result && supabaseReady) setSyncState("live", "Shared progress is live across devices.");
      return result;
    } catch (error){
      setSyncState("error", "A shared team lookup failed. Trying again in the background.");
      throw error;
    }
  };

  const originalPushRemoteProgress = pushRemoteProgress;
  pushRemoteProgress = async function(){
    try {
      const result = await originalPushRemoteProgress.apply(this, arguments);
      if (supabaseReady) setSyncState("live", "Shared progress is live across devices.");
      return result;
    } catch (error){
      setSyncState("error", "Shared progress write failed. Retrying on the next refresh.");
      throw error;
    }
  };

  const originalPushLeaderboard = pushLeaderboard;
  pushLeaderboard = async function(){
    try {
      const result = await originalPushLeaderboard.apply(this, arguments);
      if (supabaseReady) setSyncState("live", "Shared progress is live across devices.");
      return result;
    } catch (error){
      setSyncState("error", "Shared leaderboard write failed. Retrying in the background.");
      throw error;
    }
  };

  const originalPushSharedSettings = pushSharedSettings;
  pushSharedSettings = async function(){
    try {
      const result = await originalPushSharedSettings.apply(this, arguments);
      if (supabaseReady) setSyncState("live", "Shared progress is live across devices.");
      return result;
    } catch (error){
      setSyncState("error", "Shared map settings failed to update. Retrying soon.");
      throw error;
    }
  };

  updateSharedModeText = function(){
    renderSyncBadge();
  };

  const originalReleaseTeamSelection = releaseTeamSelection;
  releaseTeamSelection = function(message){
    const result = originalReleaseTeamSelection.apply(this, arguments);
    setScanInsight();
    renderDeviceState();
    if (message) setFeedback(message, "warn");
    return result;
  };

  updateMascotPreview = function(selected){
    const preview = $el("gateMascotPreview");
    if (!preview) return;
    const mascot = mascotMeta(selected);
    preview.className = `mascotPreviewCard ${mascot.badgeClass}`;
    preview.innerHTML = `<span class="mascotPreviewEmoji">${mascot.emoji}</span><div><strong>${escapeHtml(mascot.label)} • ${escapeHtml(mascot.title)}</strong><div class="small">${escapeHtml(mascot.flavor)} This mascot becomes your badge, color theme, and hunt vibe.</div></div>`;
  };

  setTeamIdentityInputs = function(rawValue, locked){
    const hasTeam = !!(teamKey && TEAMS[teamKey]);
    const identity = parseTeamIdentity(rawValue, hasTeam ? TEAMS[teamKey].label : "");
    const input = $el("gateTeamName");
    const select = $el("gateMascotSelect");
    if (input){
      const displayName = !hasTeam ? "" : (identity.displayName === TEAMS[teamKey]?.label ? "" : identity.displayName);
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
  };

  populateMascotOptions = function(selected = DEFAULT_MASCOT){
    const select = $el("gateMascotSelect");
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
  };

  setFeedback = function(msg, tone = "info"){
    const box = $el("feedbackBox");
    if (!box) return;
    box.textContent = msg;
    box.classList.remove("feedbackSuccess", "feedbackWarn", "feedbackError");
    if (tone === "success") box.classList.add("feedbackSuccess");
    if (tone === "warn") box.classList.add("feedbackWarn");
    if (tone === "error") box.classList.add("feedbackError");
  };

  const originalBurstCelebration = burstCelebration;
  burstCelebration = function(type = "success"){
    const result = originalBurstCelebration.apply(this, arguments);
    playUiTone(type === "victory" ? "victory" : "success");
    return result;
  };

  showMissionOverlay = function({ badge = "✅ Mission update", title = "Mission unlocked", copy = "You unlocked your next clue.", flavor = "A fresh page just slid out of the dossier.", stamp = "CASE FILE OPENED", meta = "Head back to the mission board for your next riddle.", page = "choresPage" } = {}){
    if ($el("missionBadge")) $el("missionBadge").textContent = badge;
    if ($el("missionTitle")) $el("missionTitle").textContent = title;
    if ($el("missionCopy")) $el("missionCopy").textContent = copy;
    if ($el("missionFlavor")) $el("missionFlavor").textContent = flavor;
    if ($el("missionStamp")) $el("missionStamp").textContent = stamp;
    if ($el("missionMeta")) $el("missionMeta").textContent = meta;
    const btn = $el("missionActionBtn");
    if (btn) btn.onclick = () => {
      hideMissionOverlay();
      setPage(page);
    };
    const overlay = $el("missionOverlay");
    if (overlay) overlay.classList.remove("hidden");
  };

  renderGateTeams = function(selected){
    const mount = $el("gateTeamButtons");
    if (!mount) return;
    mount.innerHTML = "";
    Object.entries(TEAMS).forEach(([key, team]) => {
      const claimedName = getCachedClaimedTeamName(key);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "teamBtn" + (key === selected ? " selected" : "");
      btn.innerHTML = `<span class="teamBtnLabel">${escapeHtml(team.label)}</span><span class="teamBtnMeta">${escapeHtml(claimedName ? `Locked in as ${teamIdentity(claimedName, key).displayName}` : "Open slot for a new crew")}</span>`;
      btn.addEventListener("click", async () => {
        const selectedTeam = key;
        teamKey = selectedTeam;
        renderGateTeams(teamKey);
        const claimed = await getClaimedTeamName(selectedTeam);
        if (teamKey !== selectedTeam) return;
        if (claimed) {
          setGateNameLock(true, claimed);
        } else {
          const local = loadLocalState(selectedTeam);
          setGateNameLock(false, local?.teamName || team.label);
        }
      });
      mount.appendChild(btn);
    });
    if (!selected) populateMascotOptions();
    renderDeviceState();
  };

  renderTop = function(){
    if (!teamKey || !state) return;
    const total = TEAMS[teamKey].sequence.length;
    const activeId = currentClueId();
    const stats = hintStats(state);
    const locked = clueAllowsHint(activeId) && state.nextHintAt && now < toMillis(state.nextHintAt);
    const identity = teamIdentity(state.teamName, teamKey);
    $el("progressCount").textContent = `${state.completed.length} / ${total}`;
    $el("progressBar").style.width = `${(state.completed.length / total) * 100}%`;
    buildEggProgressDots();
    $el("hintCount").textContent = `${stats.usedDisplay} / ${stats.total}`;
    $el("hintStatus").textContent = !clueAllowsHint(activeId)
      ? "No hint for this clue"
      : (locked ? `Next hint in ${fmtCountdown(toMillis(state.nextHintAt) - now)}` : (stats.remaining <= 0 ? "No hints left" : "Hint ready"));
    $el("teamDisplay").innerHTML = `${mascotBadgeMarkup(identity, { showLabel: true })}<span><strong>${escapeHtml(TEAMS[teamKey].label)} • ${escapeHtml(identity.displayName)}</strong><div class="small">${escapeHtml(identity.mascot.title)}</div></span>`;
    applyTeamTheme(state.teamName, teamKey);
    renderDeviceState();
    updateFinalMissionMode();
  };

  renderChores = function(){
    if (!teamKey || !state) return;
    const seq = TEAMS[teamKey].sequence;
    const list = $el("choreList");
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
  };

  renderBoard = function(){
    const board = $el("leaderboard");
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
              <span class="leaderMiniMeta">${escapeHtml(TEAMS[row.key]?.label || row.key)}</span>
              ${place <= 3 && row.finished ? `<span class="candyBadge">🍬 ${escapeHtml(placementPrizeText(place))}</span>` : ""}
            </div>
            <div class="muted">${row.finished ? `${placementLabel(place)} • ${placementPrizeText(place)} at Andy's table` : (TEAMS[row.key]?.sequence?.[row.found] === 11 ? "Final clue unlocked" : "In progress")}</div>
          </div>
        </div>
        <div class="leaderRight">
          <strong>${row.found}</strong>
          <div class="small">clues found</div>
        </div>`;
      board.appendChild(div);
    });
    renderAdminStatuses();
  };

  renderAdminStatuses = function(){
    const mount = $el("adminStatusList");
    if (!mount) return;
    mount.innerHTML = "";
    Object.entries(TEAMS).forEach(([key, team]) => {
      const progress = liveProgressCache[key] || loadLocalState(key) || defaultState(team.label);
      const currentId = team.sequence[progress.progressIndex];
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
          <span class="leaderMiniMeta">${escapeHtml(team.label)}</span>
        </div>
        <div class="adminStatusLocation">${progress.finished ? "Finished" : current ? `On clue ${progress.progressIndex + 1}: ${escapeHtml(current.location)}` : "Not started"}</div>
        <div class="adminStatusMeta">${progress.completed?.length || 0} clues found${lastSolved ? ` • Last cleared: ${escapeHtml(lastSolved.location)}` : ""}</div>`;
      mount.appendChild(row);
    });
  };

  const originalRenderAll = renderAll;
  renderAll = async function(options = {}){
    const result = await originalRenderAll.apply(this, arguments);
    renderDeviceState();
    renderSyncBadge();
    renderActivityTicker();
    return result;
  };

  unlockToken = async function(token, options = {}){
    const quiet = !!options.quiet;
    if (!teamKey || !state) {
      const message = "Pick a team first.";
      if (!quiet) setFeedback(message, "warn");
      setScanInsight("Pick a team on this device before scanning eggs.");
      return { status: "no-team", message };
    }

    const expected = TOKENS[teamKey][state.progressIndex];
    if (!expected){
      const message = "This team has already finished every clue.";
      if (!quiet) setFeedback(message, "warn");
      setScanInsight("This device has already cleared the whole hunt. Use Leave this device to start another team here.");
      return { status: "finished", message };
    }

    if ((token || "").trim() !== expected){
      const message = "Wrong QR code. Try again.";
      if (!quiet) setFeedback(message, "warn");
      setScanInsight(describeWrongToken(token), "scanInsightStrong");
      playUiTone("wrong");
      return { status: "wrong", message };
    }

    setScanInsight("Perfect scan. Your dossier is updating now.");
    const result = applyProgressAdvance(teamKey, state, expected);
    await renderAll();
    if (result.status === "ready-final-egg") {
      setPage("choresPage");
      burstCelebration("success");
      showMissionOverlay({
        badge: "🏁 Final mission unlocked",
        stamp: "FINAL DOSSIER",
        title: "The last riddle is live",
        copy: "You broke into the final stretch. Head back to the mission board for your last location.",
        flavor: "The house just narrowed to a single remaining secret.",
        meta: "Only one more egg stands between your team and the candy table."
      });
    } else if (result.status === "correct") {
      const nextId = currentClueId();
      const nextClue = CLUES[nextId];
      setPage("choresPage");
      burstCelebration("success");
      showMissionOverlay({
        badge: "✅ Mission unlocked",
        stamp: "UNSEALED",
        title: "Nice scan. Next clue unlocked.",
        copy: nextClue ? nextClue.title : "Your next mission is ready.",
        flavor: "Another sealed page cracked open and dropped onto the board.",
        meta: "Head back to the mission board and decode the next riddle before another team jumps you."
      });
    }
    if (state.finished) {
      setPage("choresPage");
      burstCelebration("victory");
      showVictoryOverlay();
    }
    if (!quiet) setFeedback(result.message, "success");
    return result;
  };

  const originalStartCamera = startCamera;
  startCamera = async function(){
    try {
      const result = await originalStartCamera.apply(this, arguments);
      setScanInsight("Scan your team's next live egg. If you hit the wrong one, the scanner will tell you why.");
      return result;
    } catch (error){
      setScanInsight("Camera access was blocked. You can still type a QR value manually.");
      throw error;
    }
  };

  const originalResetPhotoArea = resetPhotoArea;
  resetPhotoArea = function(options = {}){
    const result = originalResetPhotoArea.apply(this, arguments);
    if (!options.keepStatus) setScanInsight();
    return result;
  };

  const originalAnalyzeCanvas = analyzeCanvas;
  analyzeCanvas = async function(canvas){
    try {
      const result = await originalAnalyzeCanvas.apply(this, arguments);
      return result;
    } catch (error){
      setScanInsight("Try again with the QR filling most of the frame.");
      throw error;
    }
  };

  const originalCheckPhotoFile = checkPhotoFile;
  checkPhotoFile = async function(file){
    try {
      const result = await originalCheckPhotoFile.apply(this, arguments);
      return result;
    } catch (error){
      setScanInsight("Try again with a clearer photo or use the manual code box.");
      throw error;
    }
  };

  adminCopySnapshot = async function(){
    const lines = Object.entries(TEAMS).map(([key, team]) => {
      const progress = liveProgressCache[key] || loadLocalState(key) || defaultState(team.label);
      const identity = teamIdentity(progress.teamName, key);
      const currentId = team.sequence[progress.progressIndex];
      const current = currentId ? CLUES[currentId] : null;
      return `${team.label}: ${identity.displayName} (${identity.mascot.label}) - ${progress.finished ? "Finished" : current ? `On clue ${progress.progressIndex + 1}: ${current.location}` : "Not started"} - ${progress.completed?.length || 0} clues found`;
    }).join("\n");
    try {
      await navigator.clipboard.writeText(lines);
      $el("adminPanelFeedback").textContent = "Copied a team status snapshot to your clipboard.";
    } catch (error){
      console.error(error);
      $el("adminPanelFeedback").textContent = "Clipboard copy failed on this device.";
    }
  };

  function wireExtras(){
    const gateName = $el("gateTeamName");
    if (gateName && !gateName.dataset.immersiveBound){
      gateName.dataset.immersiveBound = "true";
      gateName.addEventListener("input", () => renderDeviceState());
    }
    const gateLeave = $el("gateLeaveDeviceBtn");
    if (gateLeave && !gateLeave.dataset.immersiveBound){
      gateLeave.dataset.immersiveBound = "true";
      gateLeave.addEventListener("click", leaveThisDevice);
    }
    const stripLeave = $el("leaveDeviceBtn");
    if (stripLeave && !stripLeave.dataset.immersiveBound){
      stripLeave.dataset.immersiveBound = "true";
      stripLeave.addEventListener("click", leaveThisDevice);
    }
    const copyBtn = $el("adminCopySnapshotBtn");
    if (copyBtn && !copyBtn.dataset.immersiveBound){
      copyBtn.dataset.immersiveBound = "true";
      copyBtn.addEventListener("click", adminCopySnapshot);
    }
    const startBtn = $el("startGameBtn");
    if (startBtn && !startBtn.dataset.immersiveBound){
      startBtn.dataset.immersiveBound = "true";
      startBtn.addEventListener("click", () => {
        window.setTimeout(() => {
          if (teamKey && state && $el("teamGate")?.classList.contains("hidden")) {
            setFeedback("Your squad is locked in. Start chasing eggs.", "success");
            renderDeviceState();
          }
        }, 0);
      });
    }
  }

  function refreshImmersiveUi(){
    renderSyncBadge();
    renderActivityTicker();
    renderDeviceState();
    if ($el("teamGate") && !$el("teamGate").classList.contains("hidden")) {
      renderGateTeams(teamKey || null);
      if (teamKey && TEAMS[teamKey]) {
        const claimedName = getCachedClaimedTeamName(teamKey);
        if (claimedName) setGateNameLock(true, claimedName);
      }
    } else if (teamKey && state) {
      renderTop();
      renderChores();
      renderBoard();
    } else {
      renderBoard();
    }
  }

  const bootstrapConfig = (window.SUPABASE_CONFIG && typeof window.SUPABASE_CONFIG === "object") ? window.SUPABASE_CONFIG : {};
  const bootstrapUrl = bootstrapConfig.url || window.SUPABASE_URL || "";
  const bootstrapAnonKey = bootstrapConfig.anonKey || window.SUPABASE_ANON_KEY || "";
  const bootstrapHasSharedConfig = !!(bootstrapUrl && bootstrapAnonKey && !String(bootstrapUrl).startsWith("PASTE_"));

  wireExtras();
  renderMascotCards(DEFAULT_MASCOT, false);
  setScanInsight();
  setSyncState(
    supabaseReady ? "live" : (bootstrapHasSharedConfig ? "pending" : "local"),
    supabaseReady
      ? "Shared progress is live across devices."
      : (bootstrapHasSharedConfig ? "Connecting to shared game..." : "Cross-device sync needs Supabase configured in supabase-config.js.")
  );
  window.setTimeout(refreshImmersiveUi, 0);
  window.setTimeout(refreshImmersiveUi, 250);
})();
