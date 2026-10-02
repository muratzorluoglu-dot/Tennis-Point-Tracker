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
    about: $("#view-about"),
    players: $("#view-players"),
    playerStats: $("#view-player-stats"),
    setup: $("#view-setup"),
    live: $("#view-live"),
    summary: $("#view-summary"),
  };

  const state = {
    matchId: null,
    matchMeta: null,       // {tournament, round, club, surface, city, coach, createdAt, player1Id, player2Id}
    trackedPlayers: [1, 2],
    match: null,           // TennisMatch instance
    trackingMode: "detailed", // "simple" | "detailed" - which live point-entry flow the current match uses
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
    populateTournamentTypeSelect();
    populateCountrySelect();
    syncPlayerNameUI();
    // re-render whichever screen is currently on view so dynamically-built HTML picks up the new language
    switch (currentViewName()) {
      case "home": renderHome(); break;
      case "live": renderLive(); break;
      case "summary": renderSummary(); break;
      case "players": populatePlayerFieldSelects(); renderPlayersList(); break;
      case "playerStats": renderPlayerStatsSelect(); break;
    }
  });

  // ---------- NAVIGATION ----------
  $$("[data-nav]").forEach((btn) => btn.addEventListener("click", () => {
    const dest = btn.dataset.nav;
    if (dest === "home") { showView("home"); renderHome(); }
  }));
  $("#btn-nav-about").addEventListener("click", () => showView("about"));
  $("#btn-nav-players").addEventListener("click", () => { showView("players"); renderPlayersList(); resetPlayerForm(); });
  $("#btn-nav-player-stats").addEventListener("click", () => { showView("playerStats"); renderPlayerStatsSelect(true); });

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
    state.matchMeta = {
      tournament: rec.tournament, tournamentType: rec.tournamentType, round: rec.round, club: rec.club, surface: rec.surface, city: rec.city, coach: rec.coach,
      createdAt: rec.createdAt, player1Id: rec.player1Id, player2Id: rec.player2Id,
    };
    state.trackedPlayers = rec.trackedPlayers && rec.trackedPlayers.length ? rec.trackedPlayers : [1, 2];
    state.trackingMode = rec.trackingMode || "detailed";
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
      tournamentType: state.matchMeta.tournamentType,
      round: state.matchMeta.round,
      club: state.matchMeta.club,
      surface: state.matchMeta.surface,
      city: state.matchMeta.city,
      coach: state.matchMeta.coach,
      player1: m.player1,
      player2: m.player2,
      player1Id: state.matchMeta.player1Id,
      player2Id: state.matchMeta.player2Id,
      trackedPlayers: state.trackedPlayers,
      trackingMode: state.trackingMode,
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

  const TOURNAMENT_TYPES = ["itf", "tennis_europe", "i_kort", "challenger", "atp", "wta", "other"];
  function populateTournamentTypeSelect() {
    const sel = $("#f-tournament-type");
    const prevValue = sel.value;
    sel.innerHTML = `<option value="">${t("optional")}</option>` +
      TOURNAMENT_TYPES.map(id => `<option value="${id}">${t("tType_" + id)}</option>`).join("");
    sel.value = prevValue;
  }
  populateTournamentTypeSelect();

  // [code, English name, Turkish name] - flag emoji is derived from the ISO
  // code at render time (no image assets needed).
  const COUNTRIES = [
    ["TR","Turkey","Türkiye"], ["US","United States","ABD"], ["GB","United Kingdom","İngiltere"],
    ["FR","France","Fransa"], ["DE","Germany","Almanya"], ["ES","Spain","İspanya"], ["IT","Italy","İtalya"],
    ["RU","Russia","Rusya"], ["RS","Serbia","Sırbistan"], ["CH","Switzerland","İsviçre"], ["AR","Argentina","Arjantin"],
    ["BR","Brazil","Brezilya"], ["AU","Australia","Avustralya"], ["CA","Canada","Kanada"], ["JP","Japan","Japonya"],
    ["CN","China","Çin"], ["KR","South Korea","Güney Kore"], ["IN","India","Hindistan"], ["NL","Netherlands","Hollanda"],
    ["BE","Belgium","Belçika"], ["SE","Sweden","İsveç"], ["NO","Norway","Norveç"], ["DK","Denmark","Danimarka"],
    ["FI","Finland","Finlandiya"], ["PL","Poland","Polonya"], ["CZ","Czechia","Çekya"], ["SK","Slovakia","Slovakya"],
    ["AT","Austria","Avusturya"], ["HU","Hungary","Macaristan"], ["RO","Romania","Romanya"], ["BG","Bulgaria","Bulgaristan"],
    ["GR","Greece","Yunanistan"], ["PT","Portugal","Portekiz"], ["UA","Ukraine","Ukrayna"], ["HR","Croatia","Hırvatistan"],
    ["SI","Slovenia","Slovenya"], ["EE","Estonia","Estonya"], ["LV","Latvia","Letonya"], ["LT","Lithuania","Litvanya"],
    ["IL","Israel","İsrail"], ["EG","Egypt","Mısır"], ["MA","Morocco","Fas"], ["TN","Tunisia","Tunus"],
    ["ZA","South Africa","Güney Afrika"], ["NG","Nigeria","Nijerya"], ["KE","Kenya","Kenya"], ["MX","Mexico","Meksika"],
    ["CL","Chile","Şili"], ["CO","Colombia","Kolombiya"], ["PE","Peru","Peru"], ["VE","Venezuela","Venezuela"],
    ["EC","Ecuador","Ekvador"], ["UY","Uruguay","Uruguay"], ["PY","Paraguay","Paraguay"], ["BO","Bolivia","Bolivya"],
    ["CR","Costa Rica","Kosta Rika"], ["PA","Panama","Panama"], ["DO","Dominican Republic","Dominik Cumhuriyeti"],
    ["JM","Jamaica","Jamaika"], ["CU","Cuba","Küba"], ["TH","Thailand","Tayland"], ["VN","Vietnam","Vietnam"],
    ["PH","Philippines","Filipinler"], ["ID","Indonesia","Endonezya"], ["MY","Malaysia","Malezya"], ["SG","Singapore","Singapur"],
    ["NZ","New Zealand","Yeni Zelanda"], ["IE","Ireland","İrlanda"], ["IS","Iceland","İzlanda"], ["LU","Luxembourg","Lüksemburg"],
    ["MC","Monaco","Monako"], ["CY","Cyprus","Kıbrıs"], ["GE","Georgia","Gürcistan"], ["AZ","Azerbaijan","Azerbaycan"],
    ["KZ","Kazakhstan","Kazakistan"], ["UZ","Uzbekistan","Özbekistan"], ["QA","Qatar","Katar"], ["AE","United Arab Emirates","Birleşik Arap Emirlikleri"],
    ["SA","Saudi Arabia","Suudi Arabistan"], ["KW","Kuwait","Kuveyt"], ["JO","Jordan","Ürdün"], ["LB","Lebanon","Lübnan"],
    ["PK","Pakistan","Pakistan"], ["BD","Bangladesh","Bangladeş"], ["LK","Sri Lanka","Sri Lanka"],
  ];
  function countryName(code) {
    const c = COUNTRIES.find(x => x[0] === code);
    if (!c) return code || "";
    return I18N.getLang() === "tr" ? c[2] : c[1];
  }
  function flagEmoji(code) {
    if (!code || code.length !== 2) return "";
    return String.fromCodePoint(...code.toUpperCase().split("").map(ch => 127397 + ch.charCodeAt(0)));
  }
  function populateCountrySelect() {
    const sel = $("#f-player-country");
    const prevValue = sel.value;
    const sorted = COUNTRIES.slice().sort((a, b) => countryName(a[0]).localeCompare(countryName(b[0]), I18N.getLang()));
    sel.innerHTML = `<option value="">${t("selectPlayerPlaceholder")}</option>` +
      sorted.map(c => `<option value="${c[0]}">${flagEmoji(c[0])} ${countryName(c[0])}</option>`).join("");
    sel.value = prevValue;
  }

  // Player <select>s are populated from the roster (Players store), plus a
  // trailing "+ Add New Player" option that reveals an inline quick-add row
  // so a coach meeting a new opponent courtside doesn't have to leave setup.
  function populatePlayerSelect(sel, selectedId) {
    const players = Players.loadAll();
    sel.innerHTML = `<option value="">${t("selectPlayerPlaceholder")}</option>` +
      players.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("") +
      `<option value="__new__">${t("addNewPlayerOption")}</option>`;
    if (selectedId) sel.value = selectedId;
  }
  function refreshPlayerSelects() {
    const v1 = $("#f-player1").value, v2 = $("#f-player2").value;
    populatePlayerSelect($("#f-player1"), v1 !== "__new__" ? v1 : "");
    populatePlayerSelect($("#f-player2"), v2 !== "__new__" ? v2 : "");
  }

  function selectedPlayerName(sel, fallback) {
    const id = sel.value;
    if (!id || id === "__new__") return fallback;
    const p = Players.get(id);
    return p ? p.name : fallback;
  }
  function syncPlayerNameUI() {
    const n1 = selectedPlayerName($("#f-player1"), t("player1"));
    const n2 = selectedPlayerName($("#f-player2"), t("player2"));
    $("#f-track-p1-label").textContent = n1;
    $("#f-track-p2-label").textContent = n2;
    const serverSel = $("#f-server");
    const prevValue = serverSel.value || "1";
    serverSel.innerHTML = `<option value="1">${escapeHtml(n1)}</option><option value="2">${escapeHtml(n2)}</option>`;
    serverSel.value = prevValue;
  }

  function wireQuickAdd(selectId, rowId, inputId, saveId) {
    const sel = $(selectId), row = $(rowId), input = $(inputId), saveBtn = $(saveId);
    sel.addEventListener("change", () => {
      if (sel.value === "__new__") {
        row.classList.remove("hidden");
        input.value = "";
        input.focus();
      } else {
        row.classList.add("hidden");
        syncPlayerNameUI();
      }
    });
    saveBtn.addEventListener("click", () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      const player = Players.findOrCreateByName(name);
      refreshPlayerSelects();
      sel.value = player.id;
      row.classList.add("hidden");
      syncPlayerNameUI();
    });
  }
  wireQuickAdd("#f-player1", "#f-player1-quickadd", "#f-player1-newname", "#f-player1-quickadd-save");
  wireQuickAdd("#f-player2", "#f-player2-quickadd", "#f-player2-newname", "#f-player2-quickadd-save");

  function openSetup(mode) {
    state.trackingMode = mode;
    $("#form-setup").reset();
    refreshPlayerSelects();
    $("#f-player1-quickadd").classList.add("hidden");
    $("#f-player2-quickadd").classList.add("hidden");
    syncPlayerNameUI();
    $("#setup-title").textContent = mode === "simple" ? t("navSimple") : t("navDetailed");
    showView("setup");
  }
  $("#btn-new-simple").addEventListener("click", () => openSetup("simple"));
  $("#btn-new-detailed").addEventListener("click", () => openSetup("detailed"));
  $("#btn-cancel-setup").addEventListener("click", () => showView("home"));

  $("#form-setup").addEventListener("submit", (e) => {
    e.preventDefault();
    const p1Id = $("#f-player1").value, p2Id = $("#f-player2").value;
    if (!p1Id || p1Id === "__new__" || !p2Id || p2Id === "__new__") {
      alert(t("pleaseSelectPlayers"));
      return;
    }
    const player1 = Players.get(p1Id)?.name || t("player1");
    const player2 = Players.get(p2Id)?.name || t("player2");
    const startingServer = parseInt($("#f-server").value, 10);
    const formatPreset = MATCH_FORMATS.find(f => f.id === $("#f-set-format").value) || MATCH_FORMATS[0];
    const finalSetMatchTiebreak = $("#f-final-mtb").checked;

    const trackedPlayers = [];
    if ($("#f-track-p1").checked) trackedPlayers.push(1);
    if ($("#f-track-p2").checked) trackedPlayers.push(2);

    state.matchId = uid();
    state.matchMeta = {
      tournament: $("#f-tournament").value.trim(),
      tournamentType: $("#f-tournament-type").value,
      round: $("#f-round").value.trim(),
      club: $("#f-club").value.trim(),
      surface: $("#f-surface").value,
      city: $("#f-city").value.trim(),
      coach: $("#f-coach").value.trim(),
      createdAt: new Date().toISOString(),
      player1Id: p1Id,
      player2Id: p2Id,
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
  // Android/Chrome supports navigator.vibrate; iOS Safari doesn't, but toggling
  // a hidden <input type="checkbox" switch> (Safari 17.4+) makes it tick.
  const hapticLabel = document.createElement("label");
  hapticLabel.setAttribute("aria-hidden", "true");
  hapticLabel.style.cssText = "position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;";
  const hapticSwitch = document.createElement("input");
  hapticSwitch.type = "checkbox";
  hapticSwitch.setAttribute("switch", "");
  hapticSwitch.tabIndex = -1;
  hapticLabel.appendChild(hapticSwitch);
  document.body.appendChild(hapticLabel);
  function haptic() {
    try {
      if (navigator.vibrate) navigator.vibrate(12);
      else hapticLabel.click();
    } catch (_) { /* haptics are best-effort */ }
  }

  $("#rally-tap-btn").addEventListener("click", () => {
    haptic();
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
    const simple = state.trackingMode === "simple";

    const showAce = draft.serve === "S1" || draft.serve === "S2";
    $("#step-ace").classList.toggle("hidden", !showAce);
    // The rally-tap reset lives next to the Ace button but only makes sense
    // alongside the rally counter itself, i.e. Detailed Tracking only.
    $("#rally-tap-reset").classList.toggle("hidden", !showAce || simple);

    // Detail + Winner open together with the rally counter in Detailed mode
    // (rally already defaults to 1 the moment a serve is picked); in Simple
    // mode they open directly off the serve/ace choice, just without the
    // rally counter (Simple Tracking skips rally length entirely).
    const showDetailAndWinner = showAce && !draft.ace;
    $("#step-detail").classList.toggle("hidden", !showDetailAndWinner);
    $("#step-winner").classList.toggle("hidden", !showDetailAndWinner);
    if (showDetailAndWinner) {
      const showRally = !simple;
      // Simple Tracking keeps its original plain outcome row; Detailed gets the
      // stacked Winner/Forced/Unforced buttons plus the rally-tap counter.
      $("#outcome-row-simple").classList.toggle("hidden", showRally);
      $("#outcome-row-detailed").classList.toggle("hidden", !showRally);
      $("#rally-tap-col").classList.toggle("hidden", !showRally);
      $("#rally-bucket-buttons").classList.toggle("hidden", !showRally);
      if (showRally) {
        renderRallyBucketButtons();
        $$("#rally-bucket-buttons [data-rally]").forEach(b => b.classList.toggle("active", draft.rallyBucket === b.dataset.rally));
        $("#rally-tap-count").textContent = draft.rallyTapCount || 0;
        $("#rally-tap-btn").classList.toggle("active", !!draft.rallyTapCount);
      }
      $$("#step-detail [data-outcome]").forEach(b => b.classList.toggle("active", draft.outcome === b.dataset.outcome));
      $("#shot-type-row").classList.toggle("hidden", simple);
      $("#zone-picker-inline").classList.toggle("hidden", simple);
      if (!simple) {
        $$("#step-detail [data-shot]").forEach(b => b.classList.toggle("active", draft.shots.includes(b.dataset.shot)));
        renderZonePicker($("#zone-picker-inline"), {
          selected: draft.zone,
          onSelect: (z) => { draft.zone = draft.zone === z ? null : z; renderDraft(); },
        });
      }
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

  function summaryCard(playerName, title, scoreLabel, s, simple = false, trendLabelKey = "gameTrend") {
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
        ${s.pressurePointsPlayed ? `
        <div class="stat-row pressure-highlight">
          <span>🔥 ${t("bigPointsWon")}</span>
          <span>${pct(s.pressurePointsWonPct)} (${s.pressurePointsWon}/${s.pressurePointsPlayed})</span>
        </div>` : ""}

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
          ${simple ? "" : `
          <div class="stat-row" style="margin-top:8px;"><span>${t("netPointsWon")}</span><span>${s.netPointsPlayed ? pct(s.netPointsWonPct) : "-"} (${s.netPointsPlayed} ${t("pts")})</span></div>
          <div class="stat-row stat-row-multiline">
            <span>${t("shotsPlayed")}</span>
            <span class="value-lines">
              <span>${t("volley")} ${s.shotsPlayed.volley} · ${t("smash")} ${s.shotsPlayed.smash}</span>
              <span>${t("drop")} ${s.shotsPlayed.drop} · ${t("slice")} ${s.shotsPlayed.slice}</span>
            </span>
          </div>`}
          <div class="stat-row"><span>${t("streaks")}</span><span>${s.longestWinStreak}W / ${s.longestLossStreak}L</span></div>
          <div class="stat-row"><span>${t("ueOnPressure")}</span><span>${s.unforcedErrorsCount ? `${s.unforcedErrorsOnPressure}/${s.unforcedErrorsCount}` : "-"}</span></div>
        </div>

        ${simple ? "" : `
        <div class="summary-section">
          <div class="summary-section-title">${t("rallyAnalysis")} <small>(${t("avgShots", { n: s.avgRallyLength.toFixed(1) })})</small></div>
          ${rallyBars(s.rallyBreakdown)}
        </div>

        <div class="summary-section">
          <div class="summary-section-title">${t(trendLabelKey)}</div>
          ${gameTrendBars(s.gameTrend)}
        </div>

        <div class="summary-section">
          <div class="summary-section-title">${t("byCourtZone")}</div>
          <div class="zone-stats-head">
            <span></span><span class="zh-win">W</span><span class="zh-ue">U.ERR</span><span class="zh-fe">F.ERR</span>
          </div>
          ${zoneStatsRows(s.zoneStats)}
        </div>

        ${s.shotTypeStats.length ? `
        <div class="summary-section">
          <div class="summary-section-title">${t("byShotType")}</div>
          <div class="zone-stats-head">
            <span></span><span class="zh-win">W</span><span class="zh-ue">U.ERR</span><span class="zh-fe">F.ERR</span>
          </div>
          ${shotTypeStatsRows(s.shotTypeStats)}
        </div>` : ""}`}
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

  function shotTypeStatsRows(shotTypeStats) {
    const shotL = shotLabel();
    return shotTypeStats.map(z => `
      <div class="zone-stat-row">
        <span class="zone-stat-label">${shotL[z.shotType]}</span>
        <span class="zone-stat-win">${z.winners}</span>
        <span class="zone-stat-ue">${z.unforcedErrors}</span>
        <span class="zone-stat-minor">${z.forcedErrors}</span>
      </div>`).join("");
  }

  // Compact bar-per-game strip: height/color show how dominant each game was,
  // so a coach can spot where the player pulled away or faded across the match.
  function gameTrendBars(games) {
    if (!games.length) return `<div class="empty-hint">-</div>`;
    return `<div class="game-trend">${games.map((g, i) => `
      <div class="game-trend-bar-wrap" title="${t("gameWord")} ${i + 1}: ${pct(g.wonPct)}% (${g.won}/${g.played})">
        <div class="game-trend-bar ${g.wonPct >= 50 ? "gt-win" : "gt-loss"}" style="height:${Math.max(8, g.wonPct)}%"></div>
      </div>`).join("")}</div>`;
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
        <div class="summary-grid">${g.cards.map(c => summaryCard(c.playerName, c.title, c.scoreLabel, c.s, state.trackingMode === "simple")).join("")}</div>
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
      [t("tournamentType"), meta.tournamentType ? t("tType_" + meta.tournamentType) : null],
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
        const slug = group.label.toLowerCase().replace(/\s+/g, "-");
        const items = TennisExport.renderStatsCanvasParts(matchHeaderInfo(), group.cards, state.trackingMode === "simple")
          .map((p) => ({ canvas: p.canvas, filename: `${slug}-${p.suffix}.png` }));
        await TennisExport.shareOrDownloadMultiple(items, `${group.label} Stats`);
      } finally {
        shareBtn.disabled = false;
      }
    }
  });

  function matchHeaderInfo() {
    const m = state.match;
    const meta = state.matchMeta || {};
    const start = m.matchStartTime ? new Date(m.matchStartTime) : new Date();
    const parts = [meta.tournament, meta.tournamentType ? t("tType_" + meta.tournamentType) : null, meta.round, meta.club, meta.surface ? t("surface_" + meta.surface) : null, meta.city, meta.coach ? `${t("coach")}: ${meta.coach}` : null].filter(Boolean);
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
      const items = [];
      lastSummaryGroups.forEach((g) => {
        const slug = g.label.toLowerCase().replace(/\s+/g, "-");
        TennisExport.renderStatsCanvasParts(header, g.cards, state.trackingMode === "simple").forEach((p) => {
          items.push({ canvas: p.canvas, filename: `${slug}-${p.suffix}.png` });
        });
      });
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

  // ---------- PLAYERS (roster: coach's own players + opponents) ----------
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const PLAYER_HANDS = ["right", "left"];
  const PLAYER_BACKHANDS = ["one", "two"];
  const PLAYER_GENDERS = ["male", "female"];

  function populatePlayerFieldSelects() {
    $("#f-player-hand").innerHTML = `<option value="">${t("optional")}</option>` +
      PLAYER_HANDS.map(h => `<option value="${h}">${t("playerHand" + capitalize(h))}</option>`).join("");
    $("#f-player-backhand").innerHTML = `<option value="">${t("optional")}</option>` +
      PLAYER_BACKHANDS.map(b => `<option value="${b}">${t("playerBackhand" + capitalize(b))}</option>`).join("");
    $("#f-player-gender").innerHTML = `<option value="">${t("optional")}</option>` +
      PLAYER_GENDERS.map(g => `<option value="${g}">${t("playerGender" + capitalize(g))}</option>`).join("");
    populateCountrySelect();
  }
  populatePlayerFieldSelects();

  // Age category is a rough, informational bucket only (not tied to any
  // federation's official cutoff rules) - just enough for an at-a-glance read.
  function ageCategoryFor(birthYear) {
    if (!birthYear) return null;
    const age = new Date().getFullYear() - birthYear;
    if (age <= 10) return "U10";
    if (age <= 12) return "U12";
    if (age <= 14) return "U14";
    if (age <= 16) return "U16";
    if (age <= 18) return "U18";
    return t("senior");
  }

  // Photos are downscaled client-side before being stored as a data URL, so
  // a roster of many players doesn't blow through localStorage's ~5-10MB cap.
  let pendingPhotoDataUrl = null; // null = no change; "" = explicitly removed
  function showPhotoPreview(dataUrl) {
    $("#photo-preview-img").src = dataUrl;
    $("#photo-preview-row").classList.remove("hidden");
  }
  $("#f-player-photo").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxSize = 300;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        pendingPhotoDataUrl = canvas.toDataURL("image/jpeg", 0.82);
        showPhotoPreview(pendingPhotoDataUrl);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
  $("#btn-photo-remove").addEventListener("click", () => {
    pendingPhotoDataUrl = "";
    $("#f-player-photo").value = "";
    $("#photo-preview-row").classList.add("hidden");
  });

  function resetPlayerForm() {
    $("#form-player").reset();
    $("#f-player-id").value = "";
    $("#btn-player-cancel-edit").classList.add("hidden");
    pendingPhotoDataUrl = null;
    $("#photo-preview-row").classList.add("hidden");
  }
  $("#btn-player-cancel-edit").addEventListener("click", resetPlayerForm);

  function startEditPlayer(id) {
    const p = Players.get(id);
    if (!p) return;
    $("#f-player-id").value = p.id;
    $("#f-player-name").value = p.name;
    $("#f-player-birthyear").value = p.birthYear || "";
    $("#f-player-country").value = p.country || "";
    $("#f-player-club").value = p.club || "";
    $("#f-player-hand").value = p.hand || "";
    $("#f-player-backhand").value = p.backhand || "";
    $("#f-player-gender").value = p.gender || "";
    $("#f-player-notes").value = p.notes || "";
    $("#f-player-itf-rank").value = p.itfRank || "";
    $("#f-player-itf-points").value = p.itfPoints || "";
    $("#f-player-te-rank").value = p.teRank || "";
    $("#f-player-te-points").value = p.tePoints || "";
    $("#f-player-utr").value = p.utrRating || "";
    $("#f-player-ikort-rank").value = p.ikortRank || "";
    $("#f-player-ikort-points").value = p.ikortPoints || "";
    pendingPhotoDataUrl = null;
    if (p.photo) showPhotoPreview(p.photo); else $("#photo-preview-row").classList.add("hidden");
    $("#btn-player-cancel-edit").classList.remove("hidden");
    // The form sits above the list, so scroll up to make it obvious the form
    // just filled in with this player's data (especially with a long roster).
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderPlayersList() {
    const list = $("#player-list");
    const players = Players.loadAll();
    if (!players.length) { list.innerHTML = `<div class="empty-hint">${t("noPlayersYet")}</div>`; return; }
    list.innerHTML = players.map(p => {
      const flag = flagEmoji(p.country);
      const cat = ageCategoryFor(p.birthYear);
      const metaParts = [p.club, cat, p.hand ? t("playerHand" + capitalize(p.hand)) : null].filter(Boolean);
      const entries = computePlayerMatchEntries(p.id);
      const statsLine = entries.length
        ? t("statsSnapshot", { n: entries.length, pct: Math.round(computeAggregateStats(entries).pointsWonPct) })
        : "";
      const avatar = p.photo
        ? `<img class="player-avatar" src="${p.photo}" alt="">`
        : `<div class="player-avatar player-avatar-flag">${flag || "👤"}</div>`;
      return `
        <div class="match-item player-item" data-id="${p.id}">
          ${avatar}
          <div class="player-item-info">
            <div><strong>${escapeHtml(p.name)}</strong>${flag && p.photo ? ` ${flag}` : ""}</div>
            ${metaParts.length ? `<div class="meta">${metaParts.map(escapeHtml).join(" · ")}</div>` : ""}
            ${statsLine ? `<div class="meta player-stats-snapshot">${statsLine}</div>` : ""}
          </div>
          <div class="player-item-actions">
            <button class="btn btn-ghost btn-sm" data-edit-player="${p.id}">${t("edit")}</button>
            <button class="btn btn-ghost btn-sm btn-delete" data-del-player="${p.id}">${t("delete")}</button>
          </div>
        </div>`;
    }).join("");
    list.querySelectorAll("[data-edit-player]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        startEditPlayer(btn.dataset.editPlayer);
      });
    });
    list.querySelectorAll(".match-item").forEach(el => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".player-item-actions")) return;
        startEditPlayer(el.dataset.id);
      });
    });
    list.querySelectorAll(".btn-delete").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm(t("deletePlayerConfirm"))) {
          Players.remove(btn.dataset.delPlayer);
          renderPlayersList();
        }
      });
    });
  }

  $("#form-player").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#f-player-name").value.trim();
    const birthYear = $("#f-player-birthyear").value ? parseInt($("#f-player-birthyear").value, 10) : null;
    const country = $("#f-player-country").value;
    if (!name || !birthYear || !country) { alert(t("playerRequiredFields")); return; }
    const existingId = $("#f-player-id").value;
    const existing = existingId ? Players.get(existingId) : null;
    const photo = pendingPhotoDataUrl !== null ? (pendingPhotoDataUrl || null) : (existing ? existing.photo : null);
    Players.upsert({
      id: existingId || uid(),
      name, birthYear, country, photo,
      club: $("#f-player-club").value.trim(),
      hand: $("#f-player-hand").value,
      backhand: $("#f-player-backhand").value,
      gender: $("#f-player-gender").value,
      notes: $("#f-player-notes").value.trim(),
      itfRank: $("#f-player-itf-rank").value.trim(),
      itfPoints: $("#f-player-itf-points").value.trim(),
      teRank: $("#f-player-te-rank").value.trim(),
      tePoints: $("#f-player-te-points").value.trim(),
      utrRating: $("#f-player-utr").value.trim(),
      ikortRank: $("#f-player-ikort-rank").value.trim(),
      ikortPoints: $("#f-player-ikort-points").value.trim(),
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
    });
    resetPlayerForm();
    renderPlayersList();
  });

  // Older matches only stored free-text names - link them to a roster player
  // (creating one if needed) so they count toward that player's aggregate stats.
  function migratePlayerIds() {
    const matches = Storage.loadAll();
    let changed = false;
    matches.forEach((rec) => {
      if (!rec.player1Id) { const p = Players.findOrCreateByName(rec.player1); if (p) { rec.player1Id = p.id; changed = true; } }
      if (!rec.player2Id) { const p = Players.findOrCreateByName(rec.player2); if (p) { rec.player2Id = p.id; changed = true; } }
    });
    if (changed) Storage.saveAll(matches);
  }

  // ---------- PLAYER STATISTICS (career/aggregate across all of a player's matches) ----------
  let lastPlayerStatsData = null;

  // filters: { dateFrom, dateTo, surfaces: Set<string>, types: Set<string> } | null
  // Across categories a match must satisfy all of them (AND); within a
  // category (e.g. two surfaces picked) matching any one is enough (OR).
  function matchPassesFilters(rec, filters) {
    if (!filters) return true;
    if (filters.dateFrom && new Date(rec.createdAt) < new Date(filters.dateFrom)) return false;
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59, 999);
      if (new Date(rec.createdAt) > to) return false;
    }
    if (filters.surfaces && filters.surfaces.size && !filters.surfaces.has(rec.surface)) return false;
    if (filters.types && filters.types.size && !filters.types.has(rec.tournamentType)) return false;
    return true;
  }

  function computePlayerMatchEntries(playerId, filters) {
    return Storage.loadAll()
      .filter(rec => (rec.player1Id === playerId || rec.player2Id === playerId) && matchPassesFilters(rec, filters))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(rec => ({ sets: rec.match.sets, pointLog: rec.match.pointLog, player: rec.player1Id === playerId ? 1 : 2 }));
  }

  // Match-level (not point-level) career stats: how many matches, on which
  // surfaces, decided in how many sets, tiebreak record, and time on court.
  // Lives here rather than in scoring.js because it needs match-record
  // metadata (surface, start/end time) that TennisMatch itself doesn't carry.
  function computeCareerStats(playerId, filters) {
    const recs = Storage.loadAll().filter(rec => (rec.player1Id === playerId || rec.player2Id === playerId) && matchPassesFilters(rec, filters));
    const finished = recs.filter(rec => rec.finished);
    const slotOf = (rec) => (rec.player1Id === playerId ? 1 : 2);

    const matchesPlayed = recs.length;
    const matchesFinished = finished.length;
    const matchesWon = finished.filter(rec => rec.match.matchWinner === slotOf(rec)).length;
    const matchesLost = matchesFinished - matchesWon;
    const matchWinPct = matchesFinished ? (matchesWon / matchesFinished) * 100 : 0;

    const bySurface = SURFACES.map(surface => {
      const surfMatches = finished.filter(rec => rec.surface === surface);
      const won = surfMatches.filter(rec => rec.match.matchWinner === slotOf(rec)).length;
      return { surface, played: surfMatches.length, won, winPct: surfMatches.length ? (won / surfMatches.length) * 100 : 0 };
    });
    const playedSurfaces = bySurface.filter(s => s.played > 0);
    const mostPlayedSurface = playedSurfaces.length ? playedSurfaces.reduce((a, b) => (b.played > a.played ? b : a)) : null;
    const surfacesWithSample = playedSurfaces.filter(s => s.played >= 2);
    const bestSurface = surfacesWithSample.length ? surfacesWithSample.reduce((a, b) => (b.winPct > a.winPct ? b : a)) : null;

    const totalCourtMinutes = recs.reduce((sum, rec) => {
      const start = rec.match.matchStartTime, end = rec.match.matchEndTime;
      if (!start || !end) return sum;
      return sum + Math.max(0, (new Date(end) - new Date(start)) / 60000);
    }, 0);

    // Grouped by how many sets it actually took to decide the match (2 = straight
    // sets, 3 = deciding set, etc.) rather than assuming a fixed best-of.
    const setsBreakdownMap = {};
    finished.forEach(rec => {
      const n = (rec.match.sets || []).filter(s => s.winner).length;
      if (!n) return;
      if (!setsBreakdownMap[n]) setsBreakdownMap[n] = { setsCount: n, played: 0, won: 0 };
      setsBreakdownMap[n].played++;
      if (rec.match.matchWinner === slotOf(rec)) setsBreakdownMap[n].won++;
    });
    const setsBreakdown = Object.values(setsBreakdownMap)
      .sort((a, b) => a.setsCount - b.setsCount)
      .map(x => ({ ...x, winPct: x.played ? (x.won / x.played) * 100 : 0 }));

    let tiebreaksPlayed = 0, tiebreaksWon = 0;
    recs.forEach(rec => {
      const slot = slotOf(rec);
      (rec.match.sets || []).forEach(set => {
        (set.games || []).forEach(game => {
          if (game.tiebreak && game.winner) {
            tiebreaksPlayed++;
            if (game.winner === slot) tiebreaksWon++;
          }
        });
      });
    });
    const tiebreakWinPct = tiebreaksPlayed ? (tiebreaksWon / tiebreaksPlayed) * 100 : 0;

    return {
      matchesPlayed, matchesFinished, matchesWon, matchesLost, matchWinPct,
      bySurface, mostPlayedSurface, bestSurface, totalCourtMinutes,
      setsBreakdown, tiebreaksPlayed, tiebreaksWon, tiebreakWinPct,
    };
  }

  function formatCourtMinutes(mins) {
    const total = Math.round(mins);
    const h = Math.floor(total / 60), m = total % 60;
    return h > 0 ? t("durationH", { h, m }) : t("durationM", { m });
  }

  function careerStatsPanel(cs, playerName) {
    const surfaceRows = cs.bySurface.filter(s => s.played > 0).map(s => `
      <div class="zone-stat-row">
        <span class="zone-stat-label">${t("surface_" + s.surface)}</span>
        <span class="zone-stat-win">${s.played}</span>
        <span class="zone-stat-ue">${pct(s.winPct)}</span>
        <span class="zone-stat-minor"></span>
      </div>`).join("");
    const setsRows = cs.setsBreakdown.map(s => `
      <div class="stat-row"><span>${t("setsCountLabel", { n: s.setsCount })}</span><span>${s.played} (${pct(s.winPct)})</span></div>`).join("");

    return `
      <div class="summary-card">
        <div class="summary-card-head">
          <div>
            <div class="summary-card-player">${escapeHtml(playerName)}</div>
            <h3>${t("careerOverview")}</h3>
          </div>
        </div>
        <div class="stat-grid-2">
          <div class="mini-stat"><span class="mini-stat-num">${cs.matchesPlayed}</span><span class="mini-stat-label">${t("matchesPlayedLbl")}</span></div>
          <div class="mini-stat"><span class="mini-stat-num">${cs.matchesWon}</span><span class="mini-stat-label">${t("matchesWonLbl")}</span></div>
          <div class="mini-stat"><span class="mini-stat-num">${cs.matchesLost}</span><span class="mini-stat-label">${t("matchesLostLbl")}</span></div>
          <div class="mini-stat"><span class="mini-stat-num">${pct(cs.matchWinPct)}</span><span class="mini-stat-label">${t("matchWinPctLbl")}</span></div>
        </div>
        <div class="stat-row" style="margin-top:8px;"><span>${t("timeOnCourt")}</span><span>${formatCourtMinutes(cs.totalCourtMinutes)}</span></div>
        <div class="stat-row"><span>${t("tiebreaksPlayedWon")}</span><span>${cs.tiebreaksWon}/${cs.tiebreaksPlayed} (${pct(cs.tiebreakWinPct)})</span></div>
        ${cs.mostPlayedSurface ? `<div class="stat-row"><span>${t("mostPlayedSurface")}</span><span>${t("surface_" + cs.mostPlayedSurface.surface)}</span></div>` : ""}
        ${cs.bestSurface ? `<div class="stat-row"><span>${t("bestSurface")}</span><span>${t("surface_" + cs.bestSurface.surface)} (${pct(cs.bestSurface.winPct)})</span></div>` : ""}
        ${surfaceRows ? `
        <div class="summary-section">
          <div class="summary-section-title">${t("bySurface")}</div>
          <div class="zone-stats-head"><span></span><span class="zh-win">${t("played")}</span><span class="zh-ue">${t("winPct")}</span><span></span></div>
          ${surfaceRows}
        </div>` : ""}
        ${setsRows ? `
        <div class="summary-section">
          <div class="summary-section-title">${t("bySetsCount")}</div>
          ${setsRows}
        </div>` : ""}
      </div>`;
  }

  // Filter state for the Player Stats screen: date range is a single window;
  // surfaces/types are sets (checking several within one category is OR,
  // e.g. Hard-or-Clay), and the categories combine with AND against each
  // other and the date range.
  let playerStatsFilters = { dateFrom: "", dateTo: "", surfaces: new Set(), types: new Set() };
  function resetPlayerStatsFilters() {
    playerStatsFilters = { dateFrom: "", dateTo: "", surfaces: new Set(), types: new Set() };
    $("#f-filter-date-from").value = "";
    $("#f-filter-date-to").value = "";
  }
  function renderFilterChips() {
    $("#filter-surface-chips").innerHTML = SURFACES.map(s => `
      <button type="button" class="filter-chip${playerStatsFilters.surfaces.has(s) ? " active" : ""}" data-surface="${s}">${t("surface_" + s)}</button>`).join("");
    $("#filter-type-chips").innerHTML = TOURNAMENT_TYPES.map(ty => `
      <button type="button" class="filter-chip${playerStatsFilters.types.has(ty) ? " active" : ""}" data-type="${ty}">${t("tType_" + ty)}</button>`).join("");
  }
  $("#pstats-filters").addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip");
    if (!chip) return;
    if (chip.dataset.surface) {
      const s = chip.dataset.surface;
      if (playerStatsFilters.surfaces.has(s)) playerStatsFilters.surfaces.delete(s); else playerStatsFilters.surfaces.add(s);
    } else if (chip.dataset.type) {
      const ty = chip.dataset.type;
      if (playerStatsFilters.types.has(ty)) playerStatsFilters.types.delete(ty); else playerStatsFilters.types.add(ty);
    }
    renderFilterChips();
    renderPlayerStatsContent($("#f-player-stats-select").value);
  });
  $("#f-filter-date-from").addEventListener("change", (e) => {
    playerStatsFilters.dateFrom = e.target.value;
    renderPlayerStatsContent($("#f-player-stats-select").value);
  });
  $("#f-filter-date-to").addEventListener("change", (e) => {
    playerStatsFilters.dateTo = e.target.value;
    renderPlayerStatsContent($("#f-player-stats-select").value);
  });
  $("#btn-filters-clear").addEventListener("click", () => {
    resetPlayerStatsFilters();
    renderFilterChips();
    renderPlayerStatsContent($("#f-player-stats-select").value);
  });

  // `reset` clears the selection (and filters) when the coach navigates into
  // this screen fresh, so they always actively pick who they want stats for
  // instead of silently seeing whoever was selected last time. Language-
  // switch re-renders pass reset=false to keep whatever's currently on screen.
  function renderPlayerStatsSelect(reset = false) {
    const sel = $("#f-player-stats-select");
    const prevValue = reset ? "" : sel.value;
    const players = Players.loadAll();
    sel.innerHTML = `<option value="">${t("selectPlayerPlaceholder")}</option>` +
      players.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    sel.value = prevValue;
    if (reset) resetPlayerStatsFilters();
    renderFilterChips();
    renderPlayerStatsContent(sel.value);
  }
  $("#f-player-stats-select").addEventListener("change", (e) => renderPlayerStatsContent(e.target.value));

  function renderPlayerStatsContent(playerId) {
    $("#player-stats-ai-wrap").classList.add("hidden");
    $("#player-stats-ai-wrap").innerHTML = "";
    const content = $("#player-stats-content");
    const actions = $("#player-stats-actions");
    const filterPanel = $("#pstats-filters");
    if (!playerId) {
      content.innerHTML = `<div class="empty-hint">${t("selectPlayerHint")}</div>`;
      actions.classList.add("hidden");
      filterPanel.classList.add("hidden");
      lastPlayerStatsData = null;
      return;
    }
    filterPanel.classList.remove("hidden");
    const player = Players.get(playerId);
    const totalEntries = computePlayerMatchEntries(playerId);
    if (!totalEntries.length) {
      content.innerHTML = `<div class="empty-hint">${t("noMatchesForPlayer")}</div>`;
      actions.classList.add("hidden");
      $("#filter-summary").textContent = "";
      lastPlayerStatsData = null;
      return;
    }
    const entries = computePlayerMatchEntries(playerId, playerStatsFilters);
    $("#filter-summary").textContent = t("showingMatches", { shown: entries.length, total: totalEntries.length });
    if (!entries.length) {
      content.innerHTML = `<div class="empty-hint">${t("noMatchesForFilters")}</div>`;
      actions.classList.add("hidden");
      lastPlayerStatsData = null;
      return;
    }
    const agg = computeAggregateStats(entries);
    agg.gameTrend = computeMatchTrend(entries); // per-match trend, not per-game (game numbers collide across matches)
    const title = t("matchesCount", { n: entries.length });
    const card = { playerName: player.name, title, scoreLabel: null, s: agg };
    const career = computeCareerStats(playerId, playerStatsFilters);
    content.innerHTML = careerStatsPanel(career, player.name) + summaryCard(card.playerName, card.title, card.scoreLabel, card.s, false, "matchTrend");
    actions.classList.remove("hidden");
    lastPlayerStatsData = { header: { title: player.name, subtitle: title }, cards: [card] };
  }

  $("#btn-pstats-pdf").addEventListener("click", () => TennisExport.printSection("printing-summary"));

  $("#btn-pstats-share").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (!lastPlayerStatsData) return;
    btn.disabled = true;
    try {
      const { header, cards } = lastPlayerStatsData;
      const items = TennisExport.renderStatsCanvasParts(header, cards, false, "matchTrend")
        .map(p => ({ canvas: p.canvas, filename: `player-stats-${p.suffix}.png` }));
      await TennisExport.shareOrDownloadMultiple(items, header.title);
    } finally {
      btn.disabled = false;
    }
  });

  $("#btn-pstats-ai-review").addEventListener("click", () => {
    const wrap = $("#player-stats-ai-wrap");
    if (!lastPlayerStatsData) return;
    const willShow = wrap.classList.contains("hidden");
    if (willShow) {
      const { cards } = lastPlayerStatsData;
      wrap.innerHTML = `<div class="card ai-review-wrap-inner">${cards.map(c => aiReviewCard(c.playerName, AICoach.generateReview(c.s, { playerName: c.playerName }))).join("")}</div>`;
      wrap.classList.remove("hidden");
      wrap.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      wrap.classList.add("hidden");
    }
  });

  // ---------- DATA BACKUP / TRANSFER ----------
  // There's no cloud sync (no backend at all - see storage.js), so moving
  // data between a coach's own devices is a manual export-file/import-file
  // round trip: download the JSON on one device, send it to yourself
  // however's convenient, then import it on the other device.
  $("#btn-export-data").addEventListener("click", () => {
    const payload = {
      appVersion: "tenis-tracker",
      exportedAt: new Date().toISOString(),
      matches: Storage.loadAll(),
      players: Players.loadAll(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tenis-tracker-yedek-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  $("#f-import-data").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const resultEl = $("#import-result");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data || (!Array.isArray(data.matches) && !Array.isArray(data.players))) throw new Error("invalid backup shape");
        // Upsert by id: safe to import repeatedly, and re-importing an
        // updated backup from the same device just refreshes those records.
        (data.players || []).forEach((p) => Players.upsert(p));
        (data.matches || []).forEach((m) => Storage.upsert(m));
        resultEl.textContent = t("importSuccess", { matches: (data.matches || []).length, players: (data.players || []).length });
        renderHome();
      } catch (err) {
        resultEl.textContent = t("importError");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // allow importing the same filename again later
  });

  // ---------- init ----------
  I18N.applyStatic();
  populateSetFormatSelect();
  populatePlayerFieldSelects();
  syncPlayerNameUI();
  migratePlayerIds();
  showView("home");
  renderHome();
})();
