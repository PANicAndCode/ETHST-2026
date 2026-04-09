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
  if (el("adminCopySnapshotBtn")) el("adminCopySnapshotBtn").addEventListener("click", adminCopySnapshot);
  if (el("adminGrantNextBtn")) el("adminGrantNextBtn").addEventListener("click", adminGrantNext);
  if (el("adminGrantHintBtn")) el("adminGrantHintBtn").addEventListener("click", adminGrantHint);
  if (el("adminSkipHintTimerBtn")) el("adminSkipHintTimerBtn").addEventListener("click", adminSkipHintTimer);
  if (el("adminToggleMapBtn")) el("adminToggleMapBtn").addEventListener("click", adminToggleMap);
  if (el("adminResetTeamBtn")) el("adminResetTeamBtn").addEventListener("click", adminResetTeam);
  if (el("adminResetAllBtn")) el("adminResetAllBtn").addEventListener("click", adminResetAll);
  if (el("adminReloadTeamBtn")) el("adminReloadTeamBtn").addEventListener("click", adminReloadTeam);
  if (el("missionCloseX")) el("missionCloseX").addEventListener("click", hideMissionOverlay);
  if (el("missionOverlay")) el("missionOverlay").addEventListener("click", e => { if (e.target === el("missionOverlay")) hideMissionOverlay(); });
  if (el("victoryCloseX")) el("victoryCloseX").addEventListener("click", hideVictoryOverlay);
  if (el("victoryLeaderboardBtn")) el("victoryLeaderboardBtn").addEventListener("click", () => {
    hideVictoryOverlay();
  hideMissionOverlay();
  applyTeamTheme(encodeTeamIdentity("Sig Tau", DEFAULT_MASCOT, "Sig Tau"), null);
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
      setFeedback(result.message, result.status === "wrong" ? "warn" : (result.status === "correct" || result.status === "ready-final-egg" || result.status === "finished" ? "success" : "info"));
      setScanStatus(result.status, result.message);
      el("manualCode").value = "";
    });
  }

  if (el("claimVictoryBtn")) el("claimVictoryBtn").addEventListener("click", claimVictory);
  if (el("viewVictoryBtn")) el("viewVictoryBtn").addEventListener("click", showVictoryOverlay);
}

document.querySelectorAll(".menuBtn[data-page]").forEach(btn => btn.addEventListener("click", () => setPage(btn.dataset.page)));
applyMapVisibility();
if (el("gateModeJoinBtn")) el("gateModeJoinBtn").addEventListener("click", () => setGateMode("join"));
if (el("gateModeCreateBtn")) el("gateModeCreateBtn").addEventListener("click", () => setGateMode("create"));
if (el("adminLeaveDeviceBtn")) el("adminLeaveDeviceBtn").addEventListener("click", leaveThisDevice);

if (el("startGameBtn")) {
  el("startGameBtn").addEventListener("click", async () => {
    if (gateMode === "create") {
      const enteredName = (el("gateTeamName").value || "").trim();
      const selectedMascot = normalizeMascotKey(el("gateMascotSelect")?.value || DEFAULT_MASCOT);
      if (!enteredName){
        setFeedback("Enter a team name first.", "warn");
        return;
      }
      const existing = findExistingTeamByName(enteredName);
      if (existing){
        setFeedback("That team name already exists. Join it instead or choose a new name.", "warn");
        setGateMode("join");
        teamKey = existing.id;
        renderGateTeams(teamKey);
        renderDeviceState();
        return;
      }
      teamKey = generateTeamId();
      state = defaultState(enteredName, generateRandomSequence());
      state.teamName = encodeTeamIdentity(enteredName, selectedMascot, enteredName);
      state.startedAt = Date.now();
      state.lastUpdatedAt = state.startedAt;
      rememberTeam(teamKey, state.startedAt);
      el("teamGate").classList.add("hidden");
      setFeedback("Your team is live. Start chasing eggs.", "success");
      await renderAll();
      return;
    }

    if (!teamKey){
      setFeedback("Choose a team first.", "warn");
      return;
    }

    const remote = await loadRemoteProgress(teamKey);
    state = remote || loadLocalState(teamKey);
    state.sequence = normalizeSequence(state.sequence || generateRandomSequence());
    if (!state.startedAt) state.startedAt = Date.now();
    if (!state.lastUpdatedAt) state.lastUpdatedAt = Date.now();
    rememberTeam(teamKey, state.startedAt);
    el("teamGate").classList.add("hidden");
    setFeedback(`Joined ${teamIdentity(state.teamName, teamKey).displayName}.`, "success");
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
    return false;
  }
  teamKey = saved;
  state = remote || loadLocalState(saved);
  state.sequence = normalizeSequence(state.sequence || generateRandomSequence());
  if (!state.startedAt) state.startedAt = Date.now();
  if (!state.lastUpdatedAt) state.lastUpdatedAt = Date.now();
  renderGateTeams(saved);
  populateMascotOptions(teamIdentity(state.teamName, saved).mascotKey);
  if (el("teamGate")) el("teamGate").classList.add("hidden");
  rememberTeam(saved, state.startedAt);
  await renderAll();
  return true;
}

async function refreshSharedData(){
  if (!supabaseReady) return;
  await fetchLeaderboard();
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
  renderGateTeams(null);
  populateMascotOptions();
  setGateMode("join");
  renderBoard();
  renderActivityTicker();
  renderDeviceState();
  renderSyncBadge();
  updateSharedModeText();
  resetPhotoArea();
  setScanStatus("idle", "Camera will open automatically.");
  setPage("choresPage");
  wireAdminEvents();
  wireScannerEvents();
  try {
    await initSupabase();
  } catch (error){
    console.error(error);
    supabaseReady = false;
    updateSharedModeText();
    renderBoard();
  }
  try {
    await autoResumeRememberedTeam();
  } catch (error){
    console.error(error);
    releaseTeamSelection("We could not restore the saved team. Pick a team to join again.");
  }
  setInterval(() => {
    now = Date.now();
    if (state){
      renderTop();
      renderHint();
      renderFinalEggCard();
      renderDeviceState();
    }
  }, 1000);
  setInterval(() => { refreshSharedData().catch(console.error); }, 3000);
  window.addEventListener("focus", () => { refreshSharedData().catch(console.error); });
})();
