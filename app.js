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
  const show = (id, value) => { el(id).hidden = !value; };

  function clearPlayerPayload() {
    for (const id of [
      "documentCard","documentTextCard","noticeCard","cipherCard",
      "analysisCard","translationCard","clueCard",
      "dateBlock","seriesBlock","investigationBlock"
    ]) show(id, false);

    for (const id of [
      "documentDate","series","investigation","documentText","notice",
      "ciphertext","translationTier","translationCiphertext","translationRecovered","translationProgress"
    ]) el(id).textContent = "";

    el("analysisList").textContent = "";
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

  function renderFindingCard(finding, index, isLatest) {
    const card = document.createElement("article");
    card.className = "finding-card" + (isLatest ? " latest" : "");

    const head = document.createElement("div");
    head.className = "finding-head";

    const title = document.createElement("strong");
    title.textContent = `Finding ${finding.sequence || index + 1}`;
    head.appendChild(title);

    if (isLatest) {
      const badge = document.createElement("span");
      badge.className = "finding-badge";
      badge.textContent = "LATEST";
      head.appendChild(badge);
    }

    card.appendChild(head);

    const meta = document.createElement("div");
    meta.className = "finding-meta";
    const pieces = [];
    if (Number.isInteger(finding.effective_score)) pieces.push(`Investigation ${finding.effective_score}`);
    if (finding.result) pieces.push(finding.result);
    if (finding.new_information === false) pieces.push("No new finding");
    meta.textContent = pieces.join(" • ");
    card.appendChild(meta);

    const body = document.createElement("div");
    body.className = "finding-text";
    body.textContent = finding.text || "No additional reliable conclusion was established.";
    card.appendChild(body);

    return card;
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

    show("documentTextCard", !!state.visible_document_text);
    if (state.visible_document_text) el("documentText").textContent = state.visible_document_text;

    show("noticeCard", !!state.notice);
    if (state.notice) el("notice").textContent = state.notice;

    show("cipherCard", !!state.ciphertext);
    if (state.ciphertext) el("ciphertext").textContent = state.ciphertext;

    const clues = Array.isArray(state.clues) ? state.clues : [];
    const findings = [];
    const legacy = [];
    let translation = null;

    for (const item of clues) {
      if (item && typeof item === "object" && item.kind === "investigation") {
        findings.push(item);
      } else if (item && typeof item === "object" && item.kind === "translation_mask") {
        translation = item;
      } else {
        legacy.push(item);
      }
    }

    show("analysisCard", findings.length > 0);
    const list = el("analysisList");
    list.textContent = "";
    findings.forEach((finding, index) => {
      list.appendChild(renderFindingCard(finding, index, index === findings.length - 1));
    });

    const hasTranslation = !!translation && !!translation.recovered_plaintext;
    show("translationCard", hasTranslation);
    if (hasTranslation) {
      const block = Number.isInteger(translation.block_size) ? translation.block_size : "?";
      el("translationTier").textContent =
        `${translation.tier || "Partial"} • Cargo Block size ${block}`;
      el("translationCiphertext").textContent = translation.ciphertext || state.ciphertext || "";
      el("translationRecovered").textContent = translation.recovered_plaintext || "";
      const revealed = Number.isInteger(translation.revealed_count) ? translation.revealed_count : 0;
      const total = Number.isInteger(translation.total_count) ? translation.total_count : 0;
      el("translationProgress").textContent =
        total > 0 ? `${revealed} of ${total} plaintext characters recovered` : "";
    }

    show("clueCard", legacy.length > 0);
    const legacyList = el("clues");
    legacyList.textContent = "";
    for (const clue of legacy) {
      const li = document.createElement("li");
      li.textContent = String(clue);
      legacyList.appendChild(li);
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
    if (!url || !key) throw new Error("Online Player Desk has not been configured.");

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
