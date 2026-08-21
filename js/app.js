/* Main application controller */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const t = I18N.t;

  const DEFAULT_BEST_OF = 3;

  // Ready-made set formats based on the ITF alternative-format table.
  // Labels are translated on demand via t("fmt_" + id) - see formatLabelFor().
  const MATCH_FORMATS = [
    { id: "std-ad-6", gamesPerSet: 6, noAd: false, tbAt: 6 },
    { id: "short-ad-5", gamesPerSet: 5, noAd: false, tbAt: 5 },
    { id: "short-ad-4", gamesPerSet: 4, noAd: false, tbAt: 4 },
    { id: "std-noad-6", gamesPerSet: 6, noAd: true, tbAt: 6 },
    { id: "short-noad-5", gamesPerSet: 5, noAd: true, tbAt: 4 },
    { id: "short-noad-4", gamesPerSet: 4, noAd: true, tbAt: 3 },
    { id: "short-noad-3", gamesPerSet: 3, noAd: true, tbAt: 2 },
  ];

  const RALLY_BUCKETS = [
    { id: "1-4", label: "1-4", value: 2.5, max: 4 },
    { id: "5-9", label: "5-9", value: 7, max: 9 },
    { id: "10-15", label: "10-15", value: 12.5, max: 15 },
    { id: "16-25", label: "16-25", value: 20.5, max: 25 },
    { id: "26+", label: "26+", value: 30, max: Infinity },
  ];
  function bucketForTapCount(n) {
    return RALLY_BUCKETS.find((b) => n <= b.max) || RALLY_BUCKETS[RALLY_BUCKETS.length - 1];
  }

  function formatLabelFor(m) {
    return m.format.formatId ? t("fmt_" + m.format.formatId) : m.format.formatLabel;
  }

  const views = {
    home: $("#view-home"),
    setup: $("#view-setup"),
    live: $("#view-live"),
    summary: $("#view-summary"),
  };

  const state = {
    matchId: null,
    matchMeta: null,       // {tournament, round, club, city, coach, createdAt}
    trackedPlayers: [1, 2],
    match: null,           // TennisMatch instance
  };

  let draft = emptyDraft();
  function emptyDraft() {
    return { serve: null, ace: false, rallyBucket: null, rallyTapCount: null, pointWinner: null, outcome: null, shots: [], zone: null };
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function showView(name) {
    Object.values(views).forEach(v => v.classList.add("hidden"));
    views[name].classList.remove("hidden");
  }
  function currentViewName() {
    return Object.keys(views).find((k) => !views[k].classList.contains("hidden")) || "home";
  }

  function uid() {
    return (crypto.randomUUID ? crypto.randomUUID() : `m_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  }

  // ---------- LANGUAGE ----------
  $$(".lang-btn").forEach((btn) => btn.addEventListener("click", () => I18N.setLang(btn.dataset.lang)));
  I18N.onChange(() => {
    populateSetFormatSelect();
    populateSurfaceSelect();
    syncPlayerNameUI();
    // re-render whichever screen is currently on view so dynamically-built HTML picks up the new language
    switch (currentViewName()) {
      case "home": renderHome(); break;
      case "live": renderLive(); break;
      case "summary": renderSummary(); break;
    }
  });

  // ---------- HOME ----------
  function renderHome() {
    const list = $("#match-list");
    const matches = Storage.loadAll();
    if (!matches.length) {
      list.innerHTML = `<div class="empty-hint">${t("noMatchesYet")}</div>`;
      return;
    }
    list.innerHTML = matches.map(m => {
      const scoreStr = (m.match.sets || []).filter(s => s.winner)
        .map(s => `${s.p1Games}-${s.p2Games}`).join(", ") || t("inProgress");
      const status = m.finished ? t("finished") : t("inProgress");
      const date = new Date(m.createdAt).toLocaleDateString();
      return `
        <div class="match-item" data-id="${m.id}">
          <div>
            <div><strong>${escapeHtml(m.player1)}</strong> ${t("vs")} <strong>${escapeHtml(m.player2)}</strong></div>
            <div class="meta">${date} · ${scoreStr} · ${status}</div>
          </div>
          <button class="btn btn-ghost btn-delete" data-del="${m.id}">${t("delete")}</button>
        </div>`;
    }).join("");

    list.querySelectorAll(".match-item").forEach(el => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".btn-delete")) return;
        openMatch(el.dataset.id);
      });
    });
    list.querySelectorAll(".btn-delete").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm(t("deleteConfirm"))) {
          Storage.remove(btn.dataset.del);
          renderHome();
        }
      });
    });
  }

  function openMatch(id) {
    const rec = Storage.get(id);
    if (!rec) return;
    hydrateMatch(rec);
    if (rec.finished) {
      renderSummary();
      showView("summary");
    } else {
      showView("live");
      renderLive();
    }
  }

  function hydrateMatch(rec) {
    state.matchId = rec.id;
    state.matchMeta = { tournament: rec.tournament, round: rec.round, club: rec.club, surface: rec.surface, city: rec.city, coach: rec.coach, createdAt: rec.createdAt };
    state.trackedPlayers = rec.trackedPlayers && rec.trackedPlayers.length ? rec.trackedPlayers : [1, 2];
    const m = new TennisMatch({
      player1: rec.player1, player2: rec.player2,
      bestOf: rec.bestOf || DEFAULT_BEST_OF,
      format: rec.match.format || {},
    });
    m.sets = JSON.parse(JSON.stringify(rec.match.sets));
    m.pointLog = JSON.parse(JSON.stringify(rec.match.pointLog));
    m.matchWinner = rec.match.matchWinner;
    m.matchStartTime = rec.match.matchStartTime;
    m.matchEndTime = rec.match.matchEndTime;
    state.match = m;
  }

  function persist() {
    const m = state.match;
    Storage.upsert({
      id: state.matchId,
      createdAt: state.matchMeta.createdAt,
      updatedAt: new Date().toISOString(),
      tournament: state.matchMeta.tournament,
      round: state.matchMeta.round,
      club: state.matchMeta.club,
      surface: state.matchMeta.surface,
      city: state.matchMeta.city,
      coach: state.matchMeta.coach,
      player1: m.player1,
      player2: m.player2,
      trackedPlayers: state.trackedPlayers,
      bestOf: m.bestOf,
      finished: m.isMatchOver(),
      match: {
        sets: m.sets, pointLog: m.pointLog, format: m.format,
        matchWinner: m.matchWinner, matchStartTime: m.matchStartTime, matchEndTime: m.matchEndTime,
      },
    });
  }

  // ---------- SETUP ----------
  function populateSetFormatSelect() {
    const sel = $("#f-set-format");
    const prevValue = sel.value;
    sel.innerHTML = MATCH_FORMATS.map(f => `<option value="${f.id}">${t("fmt_" + f.id)}</option>`).join("");
    if (prevValue) sel.value = prevValue;
  }
  populateSetFormatSelect();

  const SURFACES = ["hard", "clay", "grass"];
  function populateSurfaceSelect() {
    const sel = $("#f-surface");
    const prevValue = sel.value;
    sel.innerHTML = `<option value="">${t("optional")}</option>` +
      SURFACES.map(id => `<option value="${id}">${t("surface_" + id)}</option>`).join("");
    sel.value = prevValue;
  }
  populateSurfaceSelect();

  function syncPlayerNameUI() {
    const n1 = $("#f-player1").value.trim() || t("player1");
    const n2 = $("#f-player2").value.trim() || t("player2");
    $("#f-track-p1-label").textContent = n1;
    $("#f-track-p2-label").textContent = n2;
    const serverSel = $("#f-server");
    const prevValue = serverSel.value || "1";
    serverSel.innerHTML = `<option value="1">${escapeHtml(n1)}</option><option value="2">${escapeHtml(n2)}</option>`;
    serverSel.value = prevValue;
  }
  $("#f-player1").addEventListener("input", syncPlayerNameUI);
  $("#f-player2").addEventListener("input", syncPlayerNameUI);

  $("#btn-new-match").addEventListener("click", () => {
    $("#form-setup").reset();
    syncPlayerNameUI();
    showView("setup");
  });
  $("#btn-cancel-setup").addEventListener("click", () => showView("home"));

  $("#form-setup").addEventListener("submit", (e) => {
    e.preventDefault();
    const player1 = $("#f-player1").value.trim() || t("player1");
    const player2 = $("#f-player2").value.trim() || t("player2");
    const startingServer = parseInt($("#f-server").value, 10);
    const formatPreset = MATCH_FORMATS.find(f => f.id === $("#f-set-format").value) || MATCH_FORMATS[0];
    const finalSetMatchTiebreak = $("#f-final-mtb").checked;

    const trackedPlayers = [];
    if ($("#f-track-p1").checked) trackedPlayers.push(1);
    if ($("#f-track-p2").checked) trackedPlayers.push(2);

    state.matchId = uid();
    state.matchMeta = {
      tournament: $("#f-tournament").value.trim(),
      round: $("#f-round").value.trim(),
      club: $("#f-club").value.trim(),
      surface: $("#f-surface").value,
      city: $("#f-city").value.trim(),
      coach: $("#f-coach").value.trim(),
      createdAt: new Date().toISOString(),
    };
    state.trackedPlayers = trackedPlayers.length ? trackedPlayers : [1, 2];
    state.match = new TennisMatch({
      player1, player2, bestOf: DEFAULT_BEST_OF, startingServer,
      format: {
        gamesPerSet: formatPreset.gamesPerSet, noAd: formatPreset.noAd, tbAt: formatPreset.tbAt,
        finalSetMatchTiebreak, formatId: formatPreset.id,
      },
    });
    persist();
    draft = emptyDraft();
    showView("live");
    renderLive();
  });

  // ---------- LIVE: swap server (only before the first point is played) ----------
  $("#btn-swap-server").addEventListener("click", () => {
    const m = state.match;
    const current = m.currentServer();
    if (m.setServer(current === 1 ? 2 : 1)) {
      persist();
      renderLive();
    }
  });

  // ---------- LIVE: scoreboard ----------
  function renderScoreboard() {
    const m = state.match;
    const server = m.isMatchOver() ? null : m.currentServer();
    const setCols = m.sets.map(s => `<td>${s.p1Games}</td>`).join("");
    const setCols2 = m.sets.map(s => `<td>${s.p2Games}</td>`).join("");
    const tiebreak = !m.isMatchOver() && m.isTiebreak;

    let stakesHtml = "";
    if (!m.isMatchOver()) {
      const stakes = m.pointStakes();
      if (stakes.length) {
        const names = [...new Set(stakes.map(s => t(s.key)))];
        stakesHtml = `<div class="stakes-label">${names.join(" / ")}</div>`;
      }
    }

    let html = `
      <div class="format-label">${escapeHtml(formatLabelFor(m))} · ${t("bestOf", { n: m.bestOf })}${m.format.finalSetMatchTiebreak ? " · " + t("finalSetMtb") : ""}</div>
      <table style="width:100%;border-collapse:collapse;color:white;">
        <tr>
          <td class="player-name ${server === 1 ? "serving" : ""}" style="text-align:left;">${escapeHtml(m.player1)}</td>
          ${setCols}
        </tr>
        <tr>
          <td class="player-name ${server === 2 ? "serving" : ""}" style="text-align:left;">${escapeHtml(m.player2)}</td>
          ${setCols2}
        </tr>
      </table>
      <div class="point-score">${m.isMatchOver() ? m.matchScoreLabel() : m.pointDisplay({ deuce: t("deuce"), advantage: t("advantage") })}</div>
      ${stakesHtml}
      <div class="sub-label">${m.isMatchOver() ? t("matchFinished") : `${t("setN", { n: m.sets.length })}${tiebreak ? " · " + t("tiebreak") : ""}`}</div>
    `;
    if (m.isMatchOver()) {
      const winnerName = m.matchWinner === 1 ? m.player1 : m.player2;
      html += `<div class="match-winner-banner">🏆 ${escapeHtml(t("wins", { name: winnerName, score: m.matchScoreLabel() }))}</div>`;
    }
    $("#scoreboard").innerHTML = html;

    $("#btn-swap-server").classList.toggle("hidden", m.pointLog.length > 0 || m.isMatchOver());
  }

  // ---------- LIVE: point entry draft (auto-saves as soon as the minimum is known) ----------
  $$("[data-serve]").forEach(btn => btn.addEventListener("click", () => {
    draft = emptyDraft();
    draft.serve = btn.dataset.serve;
    if (draft.serve === "DF") { commitPoint(); return; }
    // The serve itself is shot #1 of the rally, so the point can be finished
    // (winner tapped) right away even if the coach never touches the tap counter.
    draft.rallyTapCount = 1;
    draft.rallyBucket = bucketForTapCount(draft.rallyTapCount).id;
    renderDraft();
  }));

  $("[data-ace-toggle]").addEventListener("click", () => {
    draft.ace = true;
    commitPoint();
  });

  function renderRallyBucketButtons() {
    const wrap = $("#rally-bucket-buttons");
    wrap.innerHTML = RALLY_BUCKETS.map(b => `<button type="button" class="btn btn-choice btn-choice-sm" data-rally="${b.id}">${b.label}</button>`).join("");
    wrap.querySelectorAll("[data-rally]").forEach(btn => btn.addEventListener("click", () => {
      draft.rallyBucket = btn.dataset.rally;
      draft.rallyTapCount = null; // manual pick overrides the live tap counter
      renderDraft();
    }));
  }

  // Wide "tap once per shot" counter: an alternative to picking a bucket after
  // the fact. Whichever method was used last wins; the exact tap count is kept
  // as the point's rally value (more precise than the bucket's midpoint).
  $("#rally-tap-btn").addEventListener("click", () => {
    draft.rallyTapCount = (draft.rallyTapCount || 0) + 1;
    draft.rallyBucket = bucketForTapCount(draft.rallyTapCount).id;
    renderDraft();
  });
  $("#rally-tap-reset").addEventListener("click", () => {
    draft.rallyTapCount = null;
    draft.rallyBucket = null;
    renderDraft();
  });

  function renderPointWinnerButtons() {
    const wrap = $("#point-winner-buttons");
    const m = state.match;
    // When an error outcome is selected, tapping a player tags THEM as the one
    // who erred — the point goes to their opponent — instead of picking the winner.
    const isError = draft.outcome === "forced_error" || draft.outcome === "unforced_error";
    $("#winner-step-title").textContent = isError ? t("whoMadeError") : t("pointWinner");
    const colorClass = isError ? "btn-warn" : "btn-good";
    wrap.innerHTML = `
      <button type="button" class="btn btn-choice ${colorClass} btn-winner" data-pw="1">${escapeHtml(m.player1)}</button>
      <button type="button" class="btn btn-choice ${colorClass} btn-winner" data-pw="2">${escapeHtml(m.player2)}</button>
    `;
    wrap.querySelectorAll("[data-pw]").forEach(btn => btn.addEventListener("click", () => {
      const tapped = parseInt(btn.dataset.pw, 10);
      draft.pointWinner = isError ? (tapped === 1 ? 2 : 1) : tapped;
      commitPoint();
    }));
  }

  // Inline, optional detail (outcome/shots/zone) shown right after rally length is picked.
  // None of this is required to save the point — only tapping the point winner does that.
  $$("#step-detail [data-outcome]").forEach(btn => btn.addEventListener("click", () => {
    draft.outcome = draft.outcome === btn.dataset.outcome ? null : btn.dataset.outcome;
    renderDraft();
  }));
  $$("#step-detail [data-shot]").forEach(btn => btn.addEventListener("click", () => {
    const shot = btn.dataset.shot;
    draft.shots = draft.shots.includes(shot) ? draft.shots.filter(s => s !== shot) : [...draft.shots, shot];
    renderDraft();
  }));

  function renderDraft() {
    $$("[data-serve]").forEach(b => b.classList.toggle("active", draft.serve === b.dataset.serve));

    const showAce = draft.serve === "S1" || draft.serve === "S2";
    $("#step-ace").classList.toggle("hidden", !showAce);

    const showRally = showAce && !draft.ace;
    $("#step-rally").classList.toggle("hidden", !showRally);
    if (showRally) {
      renderRallyBucketButtons();
      $$("#rally-bucket-buttons [data-rally]").forEach(b => b.classList.toggle("active", draft.rallyBucket === b.dataset.rally));
      $("#rally-tap-count").textContent = draft.rallyTapCount || 0;
      $("#rally-tap-btn").classList.toggle("active", !!draft.rallyTapCount);
    }

    // Detail + Winner open together with the rally step (rally already defaults to
    // 1 the moment a serve is picked) so a quick point can be finished immediately.
    const showDetailAndWinner = showRally;
    $("#step-detail").classList.toggle("hidden", !showDetailAndWinner);
    $("#step-winner").classList.toggle("hidden", !showDetailAndWinner);
    if (showDetailAndWinner) {
      $$("#step-detail [data-outcome]").forEach(b => b.classList.toggle("active", draft.outcome === b.dataset.outcome));
      $$("#step-detail [data-shot]").forEach(b => b.classList.toggle("active", draft.shots.includes(b.dataset.shot)));
      renderZonePicker($("#zone-picker-inline"), {
        selected: draft.zone,
        onSelect: (z) => { draft.zone = draft.zone === z ? null : z; renderDraft(); },
      });
      renderPointWinnerButtons();
    }
  }

  function commitPoint() {
    const isTerminal = draft.serve === "DF" || draft.ace;
    const rallyMeta = draft.rallyBucket ? RALLY_BUCKETS.find(b => b.id === draft.rallyBucket) : null;
    const meta = {
      serveResult: draft.serve,
      ace: draft.ace,
      rallyBucket: draft.serve === "DF" ? null : (draft.ace ? "1-4" : rallyMeta?.id),
      rallyValue: draft.serve === "DF" ? 0 : (draft.ace ? 1 : (draft.rallyTapCount || rallyMeta?.value)),
      pointWinner: isTerminal ? null : draft.pointWinner,
      outcome: isTerminal ? null : draft.outcome,
      shots: isTerminal ? [] : draft.shots,
      zone: isTerminal ? null : draft.zone,
    };
    const entry = state.match.addPoint(meta);
    persist();
    draft = emptyDraft();
    renderLive();
    showLastPointStrip(entry);
  }

  function showLastPointStrip(entry) {
    const strip = $("#last-point-strip");
    strip.classList.remove("hidden");
    const m = state.match;
    $("#last-point-score").textContent = entry.gameScore ? `${t("gameWord")} — ${entry.gameScore}` : entry.score;
    $("#last-point-winner").textContent = t("wonThePoint", { name: entry.pointWinner === 1 ? m.player1 : m.player2 });
  }

  $("#btn-undo").addEventListener("click", () => {
    if (!state.match.canUndo()) return;
    state.match.undo();
    persist();
    draft = emptyDraft();
    $("#last-point-strip").classList.add("hidden");
    renderLive();
  });

  $("#btn-view-log").addEventListener("click", () => {
    $("#point-log-wrap").classList.toggle("hidden");
  });

  $("#btn-view-summary").addEventListener("click", () => {
    renderSummary();
    showView("summary");
  });

  $("#btn-exit-live").addEventListener("click", () => {
    showView("home");
    renderHome();
  });

  $("#btn-summary-back").addEventListener("click", () => {
    if (state.match && !state.match.isMatchOver()) {
      showView("live");
      renderLive();
    } else {
      showView("home");
      renderHome();
    }
  });

  const shotLabel = () => ({ volley: t("volley"), smash: t("smash"), drop: t("dropShot"), slice: t("slice") });
  const outcomeLabel = () => ({ winner: t("winner"), forced_error: t("forcedError"), unforced_error: t("unforcedError") });

  function pointLogHeaderRowHTML() {
    return `<th>#</th><th>${t("colSet")}</th><th>${t("colScore")}</th><th>${t("colWonBy")}</th><th>${t("colOutcome")}</th>
      <th>${t("colShots")}</th><th>${t("colZone")}</th><th>${t("col1st")}</th><th>${t("col2nd")}</th>
      <th>${t("colAce")}</th><th>${t("colDf")}</th><th>${t("colBp")}</th><th>${t("colRally")}</th><th>${t("colGame")}</th>`;
  }

  function pointLogRowsHTML(rows, m) {
    const shotL = shotLabel(), outL = outcomeLabel();
    return rows.map(p => {
      const winnerName = p.pointWinner === 1 ? m.player1 : m.player2;
      const result = p.ace ? t("ace") : p.doubleFault ? t("doubleFault") : (outL[p.outcome] || "");
      const shots = (p.shots || []).map(s => shotL[s]).join(", ");
      return `<tr>
        <td>${p.idx}</td><td>${p.setNo}</td><td>${p.score}</td>
        <td>${escapeHtml(winnerName)}</td><td>${result}</td>
        <td>${escapeHtml(shots)}</td><td>${p.zone ?? ""}</td>
        <td>${p.s1 ? "✓" : ""}</td><td>${p.s2 ? "✓" : ""}</td>
        <td>${p.ace ? "✓" : ""}</td><td>${p.doubleFault ? "✓" : ""}</td>
        <td>${p.breakPoint ? "BP" : ""}</td>
        <td>${p.rallyBucket || ""}</td><td>${p.gameScore || ""}</td>
      </tr>`;
    }).reverse().join("");
  }

  // Self-contained mini log table (own header + wrapper) - used for each summary group's own log.
  function pointLogTableHTML(rows, m) {
    return `<div class="table-scroll"><table class="mini-log-table">
      <thead><tr>${pointLogHeaderRowHTML()}</tr></thead>
      <tbody>${pointLogRowsHTML(rows, m)}</tbody>
    </table></div>`;
  }

  function renderPointLogTable() {
    $("#point-log-table thead tr").innerHTML = pointLogHeaderRowHTML();
    $("#point-log-table tbody").innerHTML = pointLogRowsHTML(state.match.pointLog, state.match);
  }

  function renderLive() {
    renderScoreboard();
    renderDraft();
    renderPointLogTable();
    $("#btn-undo").disabled = !state.match.canUndo();
    if (state.match.isMatchOver()) {
      $(".point-entry").classList.add("hidden");
      $("#last-point-strip").classList.add("hidden");
    } else {
      $(".point-entry").classList.remove("hidden");
    }
  }

  // ---------- SUMMARY ----------
  function pct(n) { return `${n.toFixed(0)}%`; }
  function ratio(n) { return n === Infinity ? "∞" : n.toFixed(1); }

  function ring(percent, colorVar) {
    const deg = Math.max(0, Math.min(100, percent)) * 3.6;
    return `<div class="stat-ring" style="--deg:${deg}deg; --ring-color:var(${colorVar})">
      <div class="stat-ring-inner">${pct(percent)}</div>
    </div>`;
  }

  function rallyBars(breakdown) {
    return breakdown.map(b => `
      <div class="rally-bar-row">
        <span class="rally-bar-label">${b.id}</span>
        <div class="rally-bar-track"><div class="rally-bar-fill" style="width:${b.played ? b.wonPct : 0}%"></div></div>
        <span class="rally-bar-value">${b.played ? pct(b.wonPct) : "-"} <small>(${b.won}/${b.played})</small></span>
      </div>`).join("");
  }

  function summaryCard(playerName, title, scoreLabel, s) {
    return `
      <div class="summary-card">
        <div class="summary-card-head">
          <div>
            <div class="summary-card-player">${escapeHtml(playerName)}</div>
            <h3>${title}</h3>
          </div>
          ${scoreLabel ? `<span class="summary-card-score">${scoreLabel}</span>` : ""}
        </div>

        <div class="summary-rings">
          ${ring(s.pointsWonPct, "--accent-1")}
          <div class="stat-ring-label">${t("totalPointsWon")}<br><strong>${s.pointsWon}/${s.pointsPlayed}</strong></div>
        </div>

        <div class="summary-section">
          <div class="summary-section-title">${t("serve")}</div>
          <div class="bar-stack">
            <div class="bar-seg bar-seg-1" style="width:${s.firstServeInPct}%"></div>
            <div class="bar-seg bar-seg-2" style="width:${s.secondServeInPct}%"></div>
            <div class="bar-seg bar-seg-df" style="width:${s.doubleFaultPct}%"></div>
          </div>
          <div class="bar-legend">
            <span><i class="dot dot-1"></i>${t("firstServe")} ${pct(s.firstServeInPct)} (${s.firstServeInCount})</span>
            <span><i class="dot dot-2"></i>${t("secondServe")} ${pct(s.secondServeInPct)} (${s.secondServeInCount})</span>
            <span><i class="dot dot-df"></i>${t("doubleFault")} ${pct(s.doubleFaultPct)} (${s.doubleFaultCount})</span>
          </div>
          <div class="stat-row"><span>${t("firstServePtsWon")}</span><span>${pct(s.firstServeWonPct)}</span></div>
          <div class="stat-row"><span>${t("secondServePtsWon")}</span><span>${pct(s.secondServeWonPct)}</span></div>
          <div class="stat-row"><span>${t("servicePtsWon")}</span><span>${pct(s.servicePointsWonPct)}</span></div>
          <div class="stat-row"><span>${t("serviceGamesWon")}</span><span>${pct(s.serviceGamesWonPct)} (${s.serviceGamesWon}/${s.serviceGamesPlayed})</span></div>
          <div class="stat-row"><span>${t("aces")}</span><span>${s.aceCount}</span></div>
          <div class="stat-row"><span>${t("doubleFaults")}</span><span>${s.doubleFaultCount}</span></div>
          <div class="stat-row"><span>${t("breakPointsSaved")}</span><span>${s.breakPointsFaced ? pct(s.breakPointsSavedPct) : "-"} (${s.breakPointsSaved}/${s.breakPointsFaced})</span></div>
        </div>

        <div class="summary-section">
          <div class="summary-section-title">${t("returnLbl")}</div>
          <div class="stat-row"><span>${t("firstServeReturnWon")}</span><span>${pct(s.firstServeReturnWonPct)}</span></div>
          <div class="stat-row"><span>${t("secondServeReturnWon")}</span><span>${pct(s.secondServeReturnWonPct)}</span></div>
          <div class="stat-row"><span>${t("returnPtsWon")}</span><span>${pct(s.returnPointsWonPct)}</span></div>
          <div class="stat-row"><span>${t("returnGamesWon")}</span><span>${pct(s.returnGamesWonPct)} (${s.returnGamesWon}/${s.returnGamesPlayed})</span></div>
          <div class="stat-row"><span>${t("breakPointsConverted")}</span><span>${s.breakPointsChances ? pct(s.breakPointsConvertedPct) : "-"} (${s.breakPointsConverted}/${s.breakPointsChances})</span></div>
        </div>

        <div class="summary-section">
          <div class="summary-section-title">${t("shotEfficiency")}</div>
          <div class="stat-grid-2">
            <div class="mini-stat"><span class="mini-stat-num">${s.winnersCount}</span><span class="mini-stat-label">${t("winners")}</span></div>
            <div class="mini-stat"><span class="mini-stat-num">${s.unforcedErrorsCount}</span><span class="mini-stat-label">${t("unforcedErrors")}</span></div>
            <div class="mini-stat"><span class="mini-stat-num">${s.forcedErrorsCount}</span><span class="mini-stat-label">${t("forcedErrors")}</span></div>
            <div class="mini-stat"><span class="mini-stat-num">${ratio(s.winnerToUERatio)}</span><span class="mini-stat-label">${t("winnerUeRatio")}</span></div>
          </div>
          <div class="stat-row" style="margin-top:8px;"><span>${t("netPointsWon")}</span><span>${s.netPointsPlayed ? pct(s.netPointsWonPct) : "-"} (${s.netPointsPlayed} ${t("pts")})</span></div>
          <div class="stat-row stat-row-multiline">
            <span>${t("shotsPlayed")}</span>
            <span class="value-lines">
              <span>${t("volley")} ${s.shotsPlayed.volley} · ${t("smash")} ${s.shotsPlayed.smash}</span>
              <span>${t("drop")} ${s.shotsPlayed.drop} · ${t("slice")} ${s.shotsPlayed.slice}</span>
            </span>
          </div>
        </div>

        <div class="summary-section">
          <div class="summary-section-title">${t("rallyAnalysis")} <small>(${t("avgShots", { n: s.avgRallyLength.toFixed(1) })})</small></div>
          ${rallyBars(s.rallyBreakdown)}
        </div>

        <div class="summary-section">
          <div class="summary-section-title">${t("byCourtZone")}</div>
          <div class="zone-stats-head">
            <span></span><span class="zh-win">W</span><span class="zh-ue">U.ERR</span><span class="zh-fe">F.ERR</span>
          </div>
          ${zoneStatsRows(s.zoneStats)}
        </div>
      </div>`;
  }

  function zoneStatsRows(zoneStats) {
    return zoneStats.map(z => `
      <div class="zone-stat-row">
        <span class="zone-stat-label"><i class="zone-dot" style="background:${ZONE_COLORS[z.zone - 1]}"></i>${t("zoneN", { n: z.zone })}</span>
        <span class="zone-stat-win">${z.winners}</span>
        <span class="zone-stat-ue">${z.unforcedErrors}</span>
        <span class="zone-stat-minor">${z.forcedErrors}</span>
      </div>`).join("");
  }

  // Groups the summary into Set 1, Set 2, ..., Match Total sections, each
  // holding one card per tracked player (plus that group's own points, for the
  // collapsible log), so any one of them can be shared or inspected alone.
  function buildSummaryGroups() {
    const m = state.match;
    const players = state.trackedPlayers.length ? state.trackedPlayers : [1, 2];
    const nameOf = (p) => p === 1 ? m.player1 : m.player2;
    const groups = [];
    m.sets.forEach((set, i) => {
      const label = set.winner ? `${set.p1Games}-${set.p2Games}` : t("inProgress");
      groups.push({
        label: t("setN", { n: i + 1 }),
        points: m.pointLog.filter(p => p.setNo === i + 1),
        cards: players.map(p => ({ playerName: nameOf(p), title: t("setN", { n: i + 1 }), scoreLabel: label, s: computeStats(m.sets, m.pointLog, p, i + 1) })),
      });
    });
    groups.push({
      label: t("matchTotal"),
      points: m.pointLog,
      cards: players.map(p => ({ playerName: nameOf(p), title: t("matchTotal"), scoreLabel: m.isMatchOver() ? m.matchScoreLabel() : null, s: computeStats(m.sets, m.pointLog, p, null) })),
    });
    return groups;
  }

  let lastSummaryGroups = [];

  // ---------- AI Review: on-device, rule-based coaching notes (no network call) ----------
  function aiReviewSectionList(title, items) {
    return `
      <div class="ai-review-section">
        <div class="ai-review-section-title">${title}</div>
        <ul class="ai-review-list">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
      </div>`;
  }

  function aiReviewCard(playerName, review) {
    const tr = (item) => t(item.key, item.vars);
    return `
      <div class="ai-review-card">
        <div class="ai-review-card-player">${escapeHtml(playerName)}</div>
        <p class="ai-review-summary">${escapeHtml(tr(review.summary))}</p>
        ${aiReviewSectionList(`💪 ${t("aiStrengths")}`, review.strengths.map(tr))}
        ${aiReviewSectionList(`🎯 ${t("aiWeaknesses")}`, review.weaknesses.map(tr))}
        ${aiReviewSectionList(`🏋️ ${t("aiTrainingFocus")}`, review.trainingFocus.map(tr))}
        ${aiReviewSectionList(`📋 ${t("aiNextMatchTips")}`, review.nextMatchTips.map(tr))}
        ${review.notes.length ? `<p class="ai-review-note">${escapeHtml(review.notes.map(tr).join(" "))}</p>` : ""}
      </div>`;
  }

  function renderAIReview() {
    const wrap = $("#ai-review-wrap");
    const matchGroup = lastSummaryGroups[lastSummaryGroups.length - 1];
    if (!matchGroup) { wrap.innerHTML = ""; return; }
    wrap.innerHTML = `
      <div class="card ai-review-wrap-inner">
        <div class="ai-review-head">
          <div>
            <h3>🤖 ${t("aiReview")}</h3>
            <div class="ai-review-subtitle">${t("aiReviewSubtitle")}</div>
          </div>
          <button type="button" id="btn-ai-review-share" class="btn btn-ghost btn-sm">📤 ${t("share")}</button>
        </div>
        ${matchGroup.cards.map((c) => aiReviewCard(c.playerName, AICoach.generateReview(c.s, { playerName: c.playerName }))).join("")}
      </div>`;
  }

  // Plain-text version of the AI review, formatted with WhatsApp-style
  // *bold*/emoji markup instead of HTML, so it can go through navigator.share
  // (or a clipboard copy) as one self-contained message.
  function aiReviewShareText(matchHeader, matchGroup) {
    const lines = [`🎾 *${matchHeader.title}*`];
    if (matchHeader.subtitle) lines.push(matchHeader.subtitle);
    lines.push("", `🤖 *${t("aiReview")}*`);
    matchGroup.cards.forEach((c, i) => {
      const review = AICoach.generateReview(c.s, { playerName: c.playerName });
      const tr = (item) => t(item.key, item.vars);
      if (i > 0) lines.push("", "▬▬▬▬▬▬▬▬▬▬");
      lines.push(
        "", `👤 *${c.playerName}*`, tr(review.summary),
        "", `💪 *${t("aiStrengths")}*`, ...review.strengths.map((it) => `• ${tr(it)}`),
        "", `🎯 *${t("aiWeaknesses")}*`, ...review.weaknesses.map((it) => `• ${tr(it)}`),
        "", `🏋️ *${t("aiTrainingFocus")}*`, ...review.trainingFocus.map((it) => `• ${tr(it)}`),
        "", `📋 *${t("aiNextMatchTips")}*`, ...review.nextMatchTips.map((it) => `• ${tr(it)}`),
      );
      if (review.notes.length) lines.push("", `_${review.notes.map(tr).join(" ")}_`);
    });
    return lines.join("\n");
  }

  $("#ai-review-wrap").addEventListener("click", async (e) => {
    const btn = e.target.closest("#btn-ai-review-share");
    if (!btn) return;
    const matchGroup = lastSummaryGroups[lastSummaryGroups.length - 1];
    if (!matchGroup) return;
    const text = aiReviewShareText(matchHeaderInfo(), matchGroup);
    if (navigator.share) {
      try { await navigator.share({ text, title: t("aiReview") }); return; }
      catch (err) { if (err && err.name === "AbortError") return; }
    }
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.innerHTML;
      btn.innerHTML = `✅ ${t("copied")}`;
      setTimeout(() => { btn.innerHTML = original; }, 1500);
    } catch (err) { /* clipboard unavailable - nothing more we can do here */ }
  });

  function renderSummary() {
    lastSummaryGroups = buildSummaryGroups();
    $("#ai-review-wrap").classList.add("hidden");
    $("#ai-review-wrap").innerHTML = "";
    const m = state.match;
    $("#summary-content").innerHTML = lastSummaryGroups.map((g, i) => `
      <div class="summary-group">
        <div class="summary-group-head">
          <h3>${g.label}</h3>
          <div class="group-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-toggle-log="${i}">📋 ${t("log")}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-share-group="${i}">📤 ${t("share")}</button>
          </div>
        </div>
        <div class="summary-grid">${g.cards.map(c => summaryCard(c.playerName, c.title, c.scoreLabel, c.s)).join("")}</div>
        <div class="group-log hidden card" id="group-log-${i}"></div>
      </div>`).join("");
    renderMatchInfoStrip();
  }

  function formatDuration(startIso, endIso) {
    if (!startIso) return null;
    const start = new Date(startIso);
    const end = endIso ? new Date(endIso) : new Date();
    const mins = Math.max(0, Math.round((end - start) / 60000));
    const h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? t("durationH", { h, m }) : t("durationM", { m });
  }

  // Only the optional fields the coach actually filled in on the setup screen show up here.
  function matchInfoFields() {
    const m = state.match;
    const meta = state.matchMeta || {};
    const start = m.matchStartTime ? new Date(m.matchStartTime) : null;
    const fields = [
      [t("date"), start ? start.toLocaleDateString() : null],
      [t("time"), start ? start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null],
      [t("duration"), formatDuration(m.matchStartTime, m.matchEndTime)],
      [t("tournament"), meta.tournament],
      [t("round"), meta.round],
      [t("club"), meta.club],
      [t("surface"), meta.surface ? t("surface_" + meta.surface) : null],
      [t("city"), meta.city],
      [t("coach"), meta.coach],
    ];
    return fields.filter(([, value]) => value);
  }

  function renderMatchInfoStrip() {
    const fields = matchInfoFields();
    const el = $("#match-info-strip");
    if (!fields.length) { el.classList.add("hidden"); el.innerHTML = ""; return; }
    el.classList.remove("hidden");
    el.innerHTML = fields.map(([label, value]) => `
      <span class="info-chip"><span class="info-chip-label">${label}</span><span class="info-chip-value">${escapeHtml(value)}</span></span>`).join("");
  }

  $("#summary-content").addEventListener("click", async (e) => {
    const logBtn = e.target.closest("[data-toggle-log]");
    if (logBtn) {
      const idx = parseInt(logBtn.dataset.toggleLog, 10);
      const group = lastSummaryGroups[idx];
      const el = $(`#group-log-${idx}`);
      if (!group || !el) return;
      const willShow = el.classList.contains("hidden");
      if (willShow && !el.dataset.rendered) {
        el.innerHTML = pointLogTableHTML(group.points, state.match);
        el.dataset.rendered = "1";
      }
      el.classList.toggle("hidden", !willShow);
      return;
    }

    const shareBtn = e.target.closest("[data-share-group]");
    if (shareBtn) {
      const group = lastSummaryGroups[parseInt(shareBtn.dataset.shareGroup, 10)];
      if (!group) return;
      shareBtn.disabled = true;
      try {
        const canvas = TennisExport.renderStatsCanvas(matchHeaderInfo(), group.cards);
        await TennisExport.shareOrDownloadCanvas(canvas, `${group.label.toLowerCase().replace(/\s+/g, "-")}-stats.png`, `${group.label} Stats`);
      } finally {
        shareBtn.disabled = false;
      }
    }
  });

  function matchHeaderInfo() {
    const m = state.match;
    const meta = state.matchMeta || {};
    const start = m.matchStartTime ? new Date(m.matchStartTime) : new Date();
    const parts = [meta.tournament, meta.round, meta.club, meta.surface ? t("surface_" + meta.surface) : null, meta.city, meta.coach ? `${t("coach")}: ${meta.coach}` : null].filter(Boolean);
    return {
      title: `${m.player1} ${t("vs")} ${m.player2}`,
      subtitle: [start.toLocaleDateString(), ...parts].join(" · "),
    };
  }

  $("#btn-summary-share").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const header = matchHeaderInfo();
      const items = lastSummaryGroups.map((g) => ({
        canvas: TennisExport.renderStatsCanvas(header, g.cards),
        filename: `${g.label.toLowerCase().replace(/\s+/g, "-")}-stats.png`,
      }));
      await TennisExport.shareOrDownloadMultiple(items, t("matchStats"));
    } finally {
      btn.disabled = false;
    }
  });
  $("#btn-summary-pdf").addEventListener("click", () => TennisExport.printSection("printing-summary"));

  $("#btn-ai-review").addEventListener("click", () => {
    const wrap = $("#ai-review-wrap");
    const willShow = wrap.classList.contains("hidden");
    if (willShow) {
      renderAIReview();
      wrap.classList.remove("hidden");
      wrap.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      wrap.classList.add("hidden");
    }
  });

  $("#btn-log-share").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const m = state.match;
      const canvas = TennisExport.renderLogCanvas(matchHeaderInfo(), m.pointLog, m.player1, m.player2);
      await TennisExport.shareOrDownloadCanvas(canvas, "point-log.png", "Point Log");
    } finally {
      btn.disabled = false;
    }
  });
  $("#btn-log-pdf").addEventListener("click", () => TennisExport.printSection("printing-log"));

  // ---------- init ----------
  I18N.applyStatic();
  populateSetFormatSelect();
  syncPlayerNameUI();
  showView("home");
  renderHome();
})();
