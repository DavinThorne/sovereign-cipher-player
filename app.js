(() => {
  const params = new URLSearchParams(location.search);
  const session = (params.get("session") || "").toUpperCase();
  const transport = (params.get("transport") || "local").toLowerCase();
  const online = window.SOVEREIGN_ONLINE_CONFIG || {};
  let lastRevision = null;
  let updateTimer = null;
  let pollTimer = null;
  let stopped = false;

  const el = id => document.getElementById(id);

  function show(id, value) {
    el(id).hidden = !value;
  }

  function clearPlayerPayload() {
    show("documentCard", false);
    show("noticeCard", false);
    show("cipherCard", false);
    show("analysisCard", false);
    show("translationCard", false);
    show("clueCard", false);
    show("dateBlock", false);
    show("seriesBlock", false);
    show("investigationBlock", false);
    el("documentDate").textContent = "";
    el("series").textContent = "";
    el("investigation").textContent = "";
    el("notice").textContent = "";
    el("ciphertext").textContent = "";
    el("analysisResult").textContent = "";
    el("analysisText").textContent = "";
    el("translationTier").textContent = "";
    el("translationText").textContent = "";
    el("clues").textContent = "";
  }

  function renderUnavailable(kind, message) {
    clearPlayerPayload();
    show("sessionStateCard", true);

    if (kind === "closed") {
      el("sessionStateTitle").textContent = "SESSION ENDED";
      el("sessionStateMessage").textContent =
        message || "This Player Desk link is no longer active.";
    } else {
      el("sessionStateTitle").textContent = "DM CONSOLE OFFLINE";
      el("sessionStateMessage").textContent =
        message || "The DM Console is not currently connected. Waiting for it to reconnect.";
    }

    el("connectionDot").classList.remove("online");
  }

  function render(state) {
    show("sessionStateCard", false);
    show("documentCard", true);

    el("documentTitle").textContent = state.document_title || "Untitled Cipher Document";

    show("dateBlock", !!state.display_date);
    if (state.display_date) el("documentDate").textContent = state.display_date;

    show("seriesBlock", !!state.series);
    if (state.series) el("series").textContent = state.series;

    const hasInvestigation = Number.isInteger(state.investigation);
    show("investigationBlock", hasInvestigation);
    if (hasInvestigation) el("investigation").textContent = String(state.investigation);

    show("noticeCard", !!state.notice);
    if (state.notice) el("notice").textContent = state.notice;

    show("cipherCard", !!state.ciphertext);
    if (state.ciphertext) el("ciphertext").textContent = state.ciphertext;

    const clues = Array.isArray(state.clues) ? state.clues : [];
    const legacy = [];
    let analysis = null;
    let translation = null;

    for (const clue of clues) {
      if (clue && typeof clue === "object" && clue.kind === "investigation") {
        analysis = clue;
      } else if (clue && typeof clue === "object" && clue.kind === "translation") {
        translation = clue;
      } else {
        legacy.push(clue);
      }
    }

    show("analysisCard", !!analysis);
    if (analysis) {
      el("analysisResult").textContent = analysis.result || "Investigation clue";
      el("analysisText").textContent = analysis.text || "No additional reliable deduction was released.";
    }

    show("translationCard", !!translation && !!translation.text);
    if (translation && translation.text) {
      el("translationTier").textContent = `${translation.tier || "Partial"} translation`;
      el("translationText").textContent = translation.text;
    }

    show("clueCard", legacy.length > 0);
    const list = el("clues");
    list.textContent = "";
    for (const clue of legacy) {
      const li = document.createElement("li");
      li.textContent = String(clue);
      list.appendChild(li);
    }

    if (lastRevision !== null && state.revision !== lastRevision) {
      el("updateMark").hidden = false;
      clearTimeout(updateTimer);
      updateTimer = setTimeout(() => { el("updateMark").hidden = true; }, 5000);
    }
    lastRevision = state.revision;
  }

  async function fetchLocalState() {
    const response = await fetch(
      `/api/state?session=${encodeURIComponent(session)}`,
      {cache:"no-store"}
    );
    if (!response.ok) throw new Error("Local DM Console unavailable.");
    return await response.json();
  }

  async function fetchOnlineState() {
    const url = String(online.supabaseUrl || "").replace(/\/+$/, "");
    const key = String(online.publishableKey || "");
    if (!url || !key) {
      throw new Error("Online Player Desk has not been configured.");
    }

    const response = await fetch(
      `${url}/rest/v1/rpc/get_sovereign_player_session`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "apikey": key,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({p_session_code: session})
      }
    );
    if (!response.ok) throw new Error(`Online session service returned ${response.status}.`);

    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new Error("Session not found or not yet started.");
    }
    return payload[0];
  }

  async function poll() {
    if (stopped) return;

    if (!session) {
      renderUnavailable("closed", "No Player Desk session code was provided.");
      el("connectionText").textContent = "No session code";
      return;
    }

    try {
      const state = transport === "online"
        ? await fetchOnlineState()
        : await fetchLocalState();

      if (transport === "online" && state.is_live !== true) {
        const kind = state.session_state === "closed" ? "closed" : "offline";
        renderUnavailable(kind);
        el("connectionText").textContent =
          kind === "closed" ? "Session ended" : "DM Console offline";
      } else {
        render(state);
        el("connectionDot").classList.add("online");
        el("connectionText").textContent =
          transport === "online"
            ? "Connected to Online DM Console"
            : "Connected to Local DM Console";
      }
    } catch (err) {
      renderUnavailable("offline");
      el("connectionText").textContent = err.message || "Waiting for DM Console…";
    }

    pollTimer = setTimeout(poll, 3000);
  }

  window.addEventListener("pagehide", () => {
    stopped = true;
    clearTimeout(pollTimer);
    clearTimeout(updateTimer);
  });

  poll();
})();
