function applyProgressAdvance(team, targetState, scannedValue){
  const sequence = sequenceForTeam(team, targetState);
  const expected = clueTokenForId(sequence[targetState.progressIndex]);
  if (!expected){
    return { status: "finished", message: "This team has already finished every clue." };
  }

  const finishedStep = sequence[targetState.progressIndex];
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
    if (!quiet) setFeedback(message, "warn");
    setScanInsight("Pick a team on this device before scanning eggs.");
    return { status: "no-team", message };
  }

  const expected = expectedTokenForState(state, teamKey);
  if (!expected){
    const message = "This team has already finished every clue.";
    if (!quiet) setFeedback(message, "warn");
    setScanInsight("This device has already cleared the whole hunt. Ask an admin if you need to clear the saved team on this phone.");
    return { status: "finished", message };
  }

  if ((token || "").trim() !== expected){
    const message = "Wrong QR code. Try again.";
    const insight = describeWrongToken(token);
    if (!quiet) setFeedback(message, "warn");
    setScanInsight(insight, "scanInsightStrong");
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
    card.classList.remove("finalMissionGlow");
    return;
  }

  if (state.finished){
    card.classList.remove("hidden");
    card.classList.add("finalMissionGlow");
    const place = finishPlacementForTeam(teamKey) || 1;
    const prizeText = placementPrizeText(place);
    badge.textContent = "🏆 Victory locked";
    title.textContent = `Your team finished in ${placementLabel(place)} and won ${prizeText}.`;
    copy.textContent = `Go to Andy for ${prizeText}. Your placement is locked in and the leaderboard has been updated.`;
    viewBtn.classList.remove("hidden");
    return;
  }

  if (isOnFinalClue(state, teamKey)){
    card.classList.remove("hidden");
    card.classList.add("finalMissionGlow");
    badge.textContent = "🥚 Final clue";
    title.textContent = "Your final clue is unlocked.";
    copy.textContent = "Find the final egg and scan its QR code to finish the hunt. The house is down to one last secret.";
    viewBtn.classList.add("hidden");
    return;
  }

  card.classList.add("hidden");
  card.classList.remove("finalMissionGlow");
}

function hideVictoryOverlay(){
  const overlay = el("victoryOverlay");
  if (overlay) overlay.classList.add("hidden");
}

function showVictoryOverlay(){
  if (!teamKey || !state || !state.finished) return;
  const place = finishPlacementForTeam(teamKey) || 1;
  const prizeText = placementPrizeText(place);
  if (el("victoryTitle")) el("victoryTitle").textContent = `${teamIdentity(state.teamName, teamKey).displayName} found the final egg!`;
  if (el("victoryPlacement")) el("victoryPlacement").textContent = `Your team came in ${placementLabel(place)} and earned ${prizeText}.`;
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
    setScanInsight("Scan your team's next live egg. If you hit the wrong one, the scanner will tell you why.");
  } catch (error){
    console.error(error);
    showPhotoPlaceholder("Could not open the camera. Use Retake to try again.");
    setScanMessage("Could not open the camera. Use Retake to try again.");
    setScanStatus("error", "Camera access failed. Use Retake to try again.");
    setScanInsight("Camera access was blocked. You can still type a QR value manually.");
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
    setScanInsight();
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
      setFeedback("No QR code detected. Try again.", "warn");
      setScanInsight("Fill more of the frame with the QR, avoid glare, and keep the code flat.");
      setScanStatus("no-qr", "No QR code detected. Try again.");
      return;
    }
    const result = await unlockToken(decodedText, { quiet: true });
    setScanMessage(result.message);
    setFeedback(result.message, result.status === "wrong" ? "warn" : (result.status === "correct" || result.status === "ready-final-egg" || result.status === "finished" ? "success" : "info"));
    setScanStatus(result.status, result.message);
  } catch (error){
    console.error(error);
    setScanMessage("No QR code detected. Try again.");
    setFeedback("No QR code detected. Try again.", "warn");
    setScanInsight("Try again with the QR filling most of the frame.");
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
      setFeedback("No QR code detected. Try again.", "warn");
      setScanInsight("Try a brighter photo and make sure the code is fully visible.");
      setScanStatus("no-qr", "No QR code detected. Try again.");
      return;
    }
    const result = await unlockToken(decodedText, { quiet: true });
    setScanMessage(result.message);
    setFeedback(result.message, result.status === "wrong" ? "warn" : (result.status === "correct" || result.status === "ready-final-egg" || result.status === "finished" ? "success" : "info"));
    setScanStatus(result.status, result.message);
  } catch (error){
    console.error(error);
    setScanMessage("No QR code detected. Try again.");
    setFeedback("No QR code detected. Try again.", "warn");
    setScanInsight("Try again with a clearer photo or use the manual code box.");
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
  const teams = joinableTeamSummaries();
  const current = select.value || teamKey || teams[0]?.id || "";
  select.innerHTML = "";
  teams.forEach(entry => {
    const opt = document.createElement("option");
    opt.value = entry.id;
    opt.textContent = entry.identity.displayName;
    if (entry.id === current) opt.selected = true;
    select.appendChild(opt);
  });
  select.disabled = teams.length === 0;
}

async function syncAdminFields(){
  const select = el("adminTeamSelect");
  if (!select) return;
  if (!select.value){
    el("adminTeamName").value = "";
    return;
  }
  const team = select.value;
  const remote = await loadRemoteProgress(team);
  const local = loadLocalState(team);
  const rawName = remote?.teamName || local.teamName || cachedBoardState(team)?.team_name || teamFallbackLabel(team);
  el("adminTeamName").value = teamIdentity(rawName, team).displayName;
}

async function adminCopySnapshot(){
  const teams = joinableTeamSummaries();
  if (!teams.length){
    el("adminPanelFeedback").textContent = "No teams have been created yet.";
    return;
  }
  const lines = teams.map(entry => {
    const key = entry.id;
    const progress = progressStateFor(key) || defaultState(teamFallbackLabel(key));
    const identity = teamIdentity(progress.teamName, key);
    const currentId = sequenceForTeam(key, progress)[progress.progressIndex];
    const current = currentId ? CLUES[currentId] : null;
    return `${identity.displayName} (${identity.mascot.label}) - ${progress.finished ? "Finished" : current ? `On clue ${progress.progressIndex + 1}: ${current.location}` : "Not started"} - ${progress.completed?.length || 0} clues found`;
  }).join("\n");
  try {
    await navigator.clipboard.writeText(lines);
    el("adminPanelFeedback").textContent = "Copied a team status snapshot to your clipboard.";
  } catch (error) {
    console.error(error);
    el("adminPanelFeedback").textContent = "Clipboard copy failed on this device.";
  }
}

async function adminSaveTeamName(){
  const team = el("adminTeamSelect").value;
  if (!team){
    el("adminPanelFeedback").textContent = "Create a team first.";
    return;
  }
  const newName = el("adminTeamName").value.trim();
  if (!newName){
    el("adminPanelFeedback").textContent = "Enter a team name first.";
    return;
  }
  const existingMatch = findExistingTeamByName(newName);
  if (existingMatch && existingMatch.id !== team){
    el("adminPanelFeedback").textContent = "That team name already exists.";
    return;
  }

  let targetState = await loadRemoteProgress(team) || loadLocalState(team);
  const existingIdentity = teamIdentity(targetState.teamName, team);
  targetState.teamName = encodeTeamIdentity(newName, existingIdentity.mascotKey, teamFallbackLabel(team));
  if (!targetState.finished) targetState.lastUpdatedAt = Date.now();
  await upsertSharedTeamState(team, targetState);

  if (teamKey === team && state){
    state.teamName = targetState.teamName;
    await renderAll({ persist: false });
  } else {
    renderBoard();
  }

  maybeRefreshGateSelection();
  el("adminPanelFeedback").textContent = supabaseReady ? "Team name updated everywhere." : "Team name updated on this device only.";
}

async function adminResetTeam(){
  const team = el("adminTeamSelect").value;
  if (!team){
    el("adminPanelFeedback").textContent = "Create a team first.";
    return;
  }
  let existing = await loadRemoteProgress(team) || loadLocalState(team);
  const existingIdentity = teamIdentity(existing.teamName, team);
  const fresh = defaultState(existingIdentity.displayName, normalizeSequence(existing.sequence || generateRandomSequence()));
  fresh.teamName = encodeTeamIdentity(existingIdentity.displayName, existingIdentity.mascotKey, existingIdentity.displayName);
  fresh.startedAt = 0;
  fresh.lastUpdatedAt = 0;
  await upsertSharedTeamState(team, fresh);

  if (rememberedTeam() === team){
    releaseTeamSelection("That team was reset. Pick a team to join again.");
  }
  renderBoard();

  await syncAdminFields();
  maybeRefreshGateSelection();
  el("adminPanelFeedback").textContent = supabaseReady ? "Selected team reset everywhere and cleared from remembered devices." : "Selected team reset on this device only.";
}


async function adminGrantNext(){
  const team = el("adminTeamSelect").value;
  if (!team){
    el("adminPanelFeedback").textContent = "Create a team first.";
    return;
  }
  let targetState = await loadRemoteProgress(team) || loadLocalState(team);
  const label = teamLabelText(team, targetState);

  let result = null;
  let currentStep = targetState.progressIndex + 1;
  let activeClueId = sequenceForTeam(team, targetState)[targetState.progressIndex];
  let currentClue = activeClueId ? CLUES[activeClueId] : null;

  if (isReadyForVictory(targetState, team)) {
    targetState.finished = true;
    targetState.lastUpdatedAt = Date.now();
    result = { status: "finished", message: `${label} finished the hunt.` };
  } else {
    const expected = expectedTokenForState(targetState, team);
    if (!expected){
      el("adminPanelFeedback").textContent = "That team has already finished the hunt.";
      return;
    }
    result = applyProgressAdvance(team, targetState, expected);
  }

  await upsertSharedTeamState(team, targetState);

  if (teamKey === team){
    state = targetState;
    await renderAll({ persist: false });
    if (state.finished) showVictoryOverlay();
  } else {
    renderBoard();
  }

  await syncAdminFields();
  const clueName = currentClue?.location || `Clue ${activeClueId}`;
  if (targetState.finished) {
    const place = finishPlacementForTeam(team) || finishedPlacementRows().length;
    el("adminPanelFeedback").textContent = `${label} finished the hunt in ${placementLabel(place)} and won ${placementPrizeText(place)}.`;
  } else if (result.status === "ready-final-egg") {
    el("adminPanelFeedback").textContent = `Granted ${label} the final clue. They still need to scan the final egg QR code to finish.`;
  } else {
    el("adminPanelFeedback").textContent = `Granted ${label} past ${clueName} (step ${currentStep}).`;
  }
}


async function adminGrantHint(){
  const team = el("adminTeamSelect").value;
  if (!team){
    el("adminPanelFeedback").textContent = "Create a team first.";
    return;
  }
  let targetState = await loadRemoteProgress(team) || loadLocalState(team);
  targetState.usedHints = Number(targetState.usedHints || 0) - 1;
  targetState.nextHintAt = null;
  targetState.lastUpdatedAt = Date.now();

  await upsertSharedTeamState(team, targetState);

  if (teamKey === team){
    state = targetState;
    await renderAll({ persist: false });
  } else {
    renderAdminStatuses();
  }

  await syncAdminFields();
  const stats = hintStats(targetState);
  el("adminPanelFeedback").textContent = `${teamLabelText(team, targetState)} now has ${stats.remaining} hint${stats.remaining === 1 ? "" : "s"} available.`;
}

async function adminSkipHintTimer(){
  const team = el("adminTeamSelect").value;
  if (!team){
    el("adminPanelFeedback").textContent = "Create a team first.";
    return;
  }
  let targetState = await loadRemoteProgress(team) || loadLocalState(team);
  targetState.nextHintAt = null;
  targetState.lastUpdatedAt = Date.now();

  await upsertSharedTeamState(team, targetState);

  if (teamKey === team){
    state = targetState;
    await renderAll({ persist: false });
  } else {
    renderAdminStatuses();
  }

  await syncAdminFields();
  el("adminPanelFeedback").textContent = `${teamLabelText(team, targetState)} can use its next hint immediately.`;
}


async function adminResetAll(){
  if (!window.confirm("Reset the full game for every team?")) return;
  visibleTeamIds().forEach(team => localStorage.removeItem(storageKey(team)));
  localStorage.setItem(leaderboardKey(), JSON.stringify({}));
  liveProgressCache = {};
  liveBoardCache = {};
  if (supabaseReady) {
    await supabaseClient.from("team_progress_sigtau").delete().neq("team_id", SHARED_SETTINGS_TEAM_ID);
    await supabaseClient.from("leaderboard_sigtau").delete().neq("team_id", "__never__");
  }
  setLocalMapEnabled(true);
  if (supabaseReady) await pushSharedSettings();
  releaseTeamSelection("The full game was reset. Pick a team to join again.");
  renderBoard();
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
  if (!team){
    el("adminPanelFeedback").textContent = "Create a team first.";
    return;
  }
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
