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

  function render(state) {
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
    show("clueCard", clues.length > 0);
    const list = el("clues");
    list.textContent = "";
    for (const clue of clues) {
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
    if (!response.ok) throw new Error("Session unavailable.");
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
      throw new Error("Session not found or not yet published.");
    }
    return payload[0];
  }

  async function poll() {
    if (stopped) return;

    if (!session) {
      el("connectionText").textContent = "No Player Desk session code was provided.";
      return;
    }

    try {
      const state = transport === "online"
        ? await fetchOnlineState()
        : await fetchLocalState();

      render(state);
      el("connectionDot").classList.add("online");
      el("connectionText").textContent =
        transport === "online"
          ? "Connected to Online DM Console"
          : "Connected to Local DM Console";
    } catch (err) {
      el("connectionDot").classList.remove("online");
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
