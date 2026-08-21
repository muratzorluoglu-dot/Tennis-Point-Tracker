/* Export helpers: render the point log / match stats to a PNG (hand-drawn on
 * <canvas>, no external libraries) for sharing, and drive the browser's native
 * print dialog (Save as PDF) for a PDF copy. */
(function () {
  const COLORS = {
    bg: "#0f2027", card: "#182a30", cardBorder: "#2a4048",
    text: "#f3f5f4", textMuted: "#9fb3ad", accent: "#ffd43b", accent2: "#22d3ee",
    good: "#51cf66", warn: "#ff8787", divider: "#2a4048",
  };

  function pct(n) { return `${n.toFixed(0)}%`; }
  function ratio(n) { return n === Infinity ? "∞" : n.toFixed(1); }

  async function canvasToFile(canvas, filename) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new File([blob], filename, { type: "image/png" }) : null;
  }

  function downloadFile(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function shareOrDownloadCanvas(canvas, filename, shareTitle) {
    const file = await canvasToFile(canvas, filename);
    if (!file) return;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: shareTitle });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // user cancelled the share sheet
      }
    }
    downloadFile(file);
  }

  // Shares several canvases as separate image files in one go (one share-sheet
  // action with multiple attachments) instead of merging them into one image.
  // Falls back to downloading each file individually when the platform can't
  // share multiple files at once.
  async function shareOrDownloadMultiple(items, shareTitle) {
    const files = (await Promise.all(items.map(({ canvas, filename }) => canvasToFile(canvas, filename)))).filter(Boolean);
    if (!files.length) return;

    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title: shareTitle });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    // Fallback: the platform can't share several files at once - download them instead.
    for (const file of files) {
      downloadFile(file);
      await new Promise((resolve) => setTimeout(resolve, 300)); // avoid the browser blocking rapid-fire downloads
    }
  }

  // Greedy word-wrap: splits text into lines that each fit within maxWidth,
  // using whatever font is currently set on ctx.
  function wrapText(ctx, text, maxWidth) {
    if (!text) return [];
    const words = text.split(" ");
    const lines = [];
    let line = "";
    words.forEach((word) => {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- Match stats -> image ----------
  // The full stat set is too tall for one comfortable share image, so it's
  // split into 3 logical parts: overview (points won + serve/return), shot
  // analysis (shot efficiency/rally/game trend), and placement (court zone +
  // shot type tables). Each part is a fully self-contained image (its own
  // header + player name), so any one of them reads fine shared on its own.
  const STATS_PARTS = [
    { id: "overview", labelKey: "statsPartOverview", n: 1 },
    { id: "shots", labelKey: "statsPartShots", n: 2 },
    { id: "placement", labelKey: "statsPartPlacement", n: 3 },
  ];

  function renderStatsCanvas(matchHeader, cards, part) {
    // Narrow enough that the label/value columns fill the card width (no
    // leftover dead space) while still leaving room for the longest labels.
    const W = 400;
    const M = 20; // outer margin
    const cardW = W - 2 * M;
    const pad = 18;
    const rowsW = cardW - 2 * pad; // usable width inside a card; values right-align to this
    const lineH = 24;
    const rowH = 22;

    function cardHeight(card) {
      let h = 20; // top padding
      h += lineH; // player name
      h += lineH + 6; // title row
      if (part === "overview") {
        h += 44; // points-won highlight (percentage line + fraction line)
        if (card.s.pressurePointsPlayed) h += 36; // big-points-won badge
        h += 22 + 10 * rowH + 10; // serve
        h += 22 + 5 * rowH + 10; // return
      } else if (part === "shots") {
        h += 22 + (card.s.shotsPlayed ? 9 : 5) * rowH + 10; // shot efficiency
        h += 22 + (1 + card.s.rallyBreakdown.length) * rowH + 10; // rally
        if (card.s.gameTrend && card.s.gameTrend.length) h += 22 + 40 + 14; // game-by-game trend bars
      } else if (part === "placement") {
        h += 22 + (1 + card.s.zoneStats.length) * rowH + 10; // by court zone
        if (card.s.shotTypeStats && card.s.shotTypeStats.length) h += 22 + (1 + card.s.shotTypeStats.length) * rowH + 10; // by shot type
      }
      h += 20; // bottom padding
      return h;
    }

    // Header title/subtitle can be long (player names, tournament/round/club/
    // city/coach) so wrap them instead of letting them run off the canvas.
    // Font metrics don't depend on canvas size, so measure with a throwaway
    // context before the real canvas (and its final height) is created.
    const measureCtx = document.createElement("canvas").getContext("2d");
    const titleFont = "700 18px -apple-system, Segoe UI, Roboto, Arial";
    const subtitleFont = "12px -apple-system, Segoe UI, Roboto, Arial";
    measureCtx.font = titleFont;
    const titleLines = wrapText(measureCtx, "🎾 " + matchHeader.title, W - 2 * M);
    measureCtx.font = subtitleFont;
    const subtitleLines = matchHeader.subtitle ? wrapText(measureCtx, matchHeader.subtitle, W - 2 * M) : [];
    const titleLineH = 22, subtitleLineH = 16;
    const partMeta = STATS_PARTS.find((p) => p.id === part);
    const partBadgeH = partMeta ? 26 : 0;
    const headerH = M + titleLines.length * titleLineH + 6 + subtitleLines.length * subtitleLineH + 16 + partBadgeH;

    let totalH = headerH;
    cards.forEach((c) => { totalH += cardHeight(c) + 16; });
    totalH += M;

    const canvas = document.createElement("canvas");
    const scale = 2; // sharper export
    canvas.width = W * scale;
    canvas.height = totalH * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, totalH);

    let y = M;
    ctx.fillStyle = COLORS.text;
    ctx.font = titleFont;
    titleLines.forEach((line) => { ctx.fillText(line, M, y + 15); y += titleLineH; });
    y += 6;
    ctx.fillStyle = COLORS.textMuted;
    ctx.font = subtitleFont;
    subtitleLines.forEach((line) => { ctx.fillText(line, M, y + 10); y += subtitleLineH; });
    y += 16;

    if (partMeta) {
      ctx.font = "700 11px -apple-system, Segoe UI, Roboto, Arial";
      const badgeText = `${partMeta.n}/${STATS_PARTS.length} · ${I18N.t(partMeta.labelKey)}`;
      const bw = ctx.measureText(badgeText).width + 20;
      roundRect(ctx, M, y - 15, bw, 22, 11);
      ctx.fillStyle = COLORS.card;
      ctx.fill();
      ctx.strokeStyle = COLORS.accent2;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = COLORS.accent2;
      ctx.fillText(badgeText, M + 10, y);
      y += partBadgeH;
    }

    function statRow(label, value, x, rowY, w) {
      ctx.font = "13px -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = COLORS.textMuted;
      ctx.fillText(label, x, rowY);
      ctx.font = "700 13px -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = COLORS.text;
      const vw = ctx.measureText(value).width;
      ctx.fillText(value, x + w - vw, rowY);
    }

    function sectionTitle(text, x, rowY) {
      ctx.font = "700 11px -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = COLORS.accent2;
      ctx.fillText(text.toLocaleUpperCase(I18N.getLang()), x, rowY);
    }

    function statSections(sections) {
      sections.forEach(([label, rows]) => {
        cy += 4;
        sectionTitle(label, M + pad, cy);
        cy += 18;
        ctx.strokeStyle = COLORS.divider;
        ctx.beginPath(); ctx.moveTo(M + pad, cy - 12); ctx.lineTo(M + cardW - pad, cy - 12); ctx.stroke();
        rows.forEach(([l, v]) => { statRow(l, v, M + pad, cy, rowsW); cy += rowH; });
        cy += 6;
      });
    }

    let cy = 0; // set per-card below; declared here so statSections() can close over it

    cards.forEach((card) => {
      const h = cardHeight(card);
      roundRect(ctx, M, y, cardW, h, 14);
      ctx.fillStyle = COLORS.card;
      ctx.fill();
      ctx.strokeStyle = COLORS.cardBorder;
      ctx.lineWidth = 1;
      ctx.stroke();

      cy = y + pad + 10;
      ctx.font = "700 11px -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = COLORS.accent2;
      ctx.fillText(card.playerName.toUpperCase(), M + pad, cy);
      cy += lineH;

      ctx.font = "700 16px -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = COLORS.text;
      ctx.fillText(card.title, M + pad, cy);
      if (card.scoreLabel) {
        ctx.font = "700 13px -apple-system, Segoe UI, Roboto, Arial";
        ctx.fillStyle = COLORS.accent;
        const sw = ctx.measureText(card.scoreLabel).width;
        ctx.fillText(card.scoreLabel, M + pad + rowsW - sw, cy);
      }
      cy += 30;

      const s = card.s;

      if (part === "overview") {
        ctx.font = "700 22px -apple-system, Segoe UI, Roboto, Arial";
        ctx.fillStyle = COLORS.accent;
        ctx.fillText(`${pct(s.pointsWonPct)} ${I18N.t("totalPointsWon")}`, M + pad, cy);
        cy += 20;
        ctx.font = "13px -apple-system, Segoe UI, Roboto, Arial";
        ctx.fillStyle = COLORS.textMuted;
        ctx.fillText(`(${s.pointsWon}/${s.pointsPlayed})`, M + pad, cy);
        cy += 20;

        if (s.pressurePointsPlayed) {
          roundRect(ctx, M + pad, cy - 14, rowsW, 26, 8);
          ctx.fillStyle = "rgba(255, 212, 59, 0.12)";
          ctx.fill();
          ctx.strokeStyle = "rgba(255, 212, 59, 0.35)";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.font = "700 12px -apple-system, Segoe UI, Roboto, Arial";
          ctx.fillStyle = COLORS.textMuted;
          ctx.fillText(`🔥 ${I18N.t("bigPointsWon")}`, M + pad + 10, cy);
          ctx.fillStyle = COLORS.accent;
          const bpwText = `${pct(s.pressurePointsWonPct)} (${s.pressurePointsWon}/${s.pressurePointsPlayed})`;
          const bpwW = ctx.measureText(bpwText).width;
          ctx.fillText(bpwText, M + pad + rowsW - 10 - bpwW, cy);
          cy += 36;
        }

        const serveRows = [
          [I18N.t("firstServe"), `${pct(s.firstServeInPct)} (${s.firstServeInCount})`],
          [I18N.t("secondServe"), `${pct(s.secondServeInPct)} (${s.secondServeInCount})`],
          [I18N.t("doubleFault"), `${pct(s.doubleFaultPct)} (${s.doubleFaultCount})`],
          [I18N.t("firstServePtsWon"), pct(s.firstServeWonPct)],
          [I18N.t("secondServePtsWon"), pct(s.secondServeWonPct)],
          [I18N.t("servicePtsWon"), pct(s.servicePointsWonPct)],
          [I18N.t("serviceGamesWon"), `${pct(s.serviceGamesWonPct)} (${s.serviceGamesWon}/${s.serviceGamesPlayed})`],
          [I18N.t("aces"), String(s.aceCount)],
          [I18N.t("doubleFaults"), String(s.doubleFaultCount)],
          [I18N.t("breakPointsSaved"), s.breakPointsFaced ? `${pct(s.breakPointsSavedPct)} (${s.breakPointsSaved}/${s.breakPointsFaced})` : "-"],
        ];
        const returnRows = [
          [I18N.t("firstServeReturnWon"), pct(s.firstServeReturnWonPct)],
          [I18N.t("secondServeReturnWon"), pct(s.secondServeReturnWonPct)],
          [I18N.t("returnPtsWon"), pct(s.returnPointsWonPct)],
          [I18N.t("returnGamesWon"), `${pct(s.returnGamesWonPct)} (${s.returnGamesWon}/${s.returnGamesPlayed})`],
          [I18N.t("breakPointsConverted"), s.breakPointsChances ? `${pct(s.breakPointsConvertedPct)} (${s.breakPointsConverted}/${s.breakPointsChances})` : "-"],
        ];
        statSections([[I18N.t("serve"), serveRows], [I18N.t("returnLbl"), returnRows]]);
      }

      if (part === "shots") {
        const shotRows = [
          [I18N.t("winners"), String(s.winnersCount)],
          [I18N.t("unforcedErrors"), String(s.unforcedErrorsCount)],
          [I18N.t("forcedErrors"), String(s.forcedErrorsCount)],
          [I18N.t("winnerUeRatio"), ratio(s.winnerToUERatio)],
          [I18N.t("netPointsWon"), s.netPointsPlayed ? `${pct(s.netPointsWonPct)} (${s.netPointsPlayed} ${I18N.t("pts")})` : "-"],
          [I18N.t("shotsPlayed"), `${I18N.t("volley")} ${s.shotsPlayed.volley} · ${I18N.t("smash")} ${s.shotsPlayed.smash}`],
          ["", `${I18N.t("drop")} ${s.shotsPlayed.drop} · ${I18N.t("slice")} ${s.shotsPlayed.slice}`],
          [I18N.t("streaks"), `${s.longestWinStreak}W / ${s.longestLossStreak}L`],
          [I18N.t("ueOnPressure"), s.unforcedErrorsCount ? `${s.unforcedErrorsOnPressure}/${s.unforcedErrorsCount}` : "-"],
        ];
        const rallyRows = s.rallyBreakdown.map((b) => [`${b.id} ${I18N.t("colShots")}`, b.played ? `${pct(b.wonPct)} (${b.won}/${b.played})` : "-"]);
        rallyRows.unshift([I18N.t("rallyAnalysis"), I18N.t("avgShots", { n: s.avgRallyLength.toFixed(1) })]);
        statSections([[I18N.t("shotEfficiency"), shotRows], [I18N.t("rallyAnalysis"), rallyRows]]);

        // GAME TREND - one bar per game, height = points-won % that game, so a
        // coach can spot at a glance where the player pulled away or faded.
        if (s.gameTrend && s.gameTrend.length) {
          cy += 4;
          sectionTitle(I18N.t("gameTrend"), M + pad, cy);
          cy += 18;
          ctx.strokeStyle = COLORS.divider;
          ctx.beginPath(); ctx.moveTo(M + pad, cy - 12); ctx.lineTo(M + cardW - pad, cy - 12); ctx.stroke();
          const barAreaH = 40, gap = 3;
          const barW = Math.max(2, (rowsW - gap * (s.gameTrend.length - 1)) / s.gameTrend.length);
          s.gameTrend.forEach((g, i) => {
            const bh = Math.max(3, (g.wonPct / 100) * barAreaH);
            const bx = M + pad + i * (barW + gap);
            const by = cy + (barAreaH - bh);
            ctx.fillStyle = g.wonPct >= 50 ? COLORS.good : COLORS.warn;
            roundRect(ctx, bx, by, barW, bh, Math.min(2, barW / 2));
            ctx.fill();
          });
          cy += barAreaH + 14;
        }
      }

      if (part === "placement") {
        // BY COURT ZONE - a compact table; winners & unforced errors are bold
        // and colored so they stand out, forced errors stay small and muted.
        cy += 4;
        sectionTitle(I18N.t("byCourtZone"), M + pad, cy);
        cy += 18;
        ctx.strokeStyle = COLORS.divider;
        ctx.beginPath(); ctx.moveTo(M + pad, cy - 12); ctx.lineTo(M + cardW - pad, cy - 12); ctx.stroke();
        const zCol3 = M + pad + rowsW - 16, zCol2 = zCol3 - 42, zCol1 = zCol2 - 42;
        ctx.font = "700 10px -apple-system, Segoe UI, Roboto, Arial";
        ctx.fillStyle = COLORS.textMuted;
        ctx.textAlign = "center";
        ctx.fillText("W", zCol1, cy);
        ctx.fillText("U.ERR", zCol2, cy);
        ctx.fillText("F.ERR", zCol3, cy);
        ctx.textAlign = "left";
        cy += rowH;
        card.s.zoneStats.forEach((z) => {
          ctx.beginPath(); ctx.arc(M + pad + 4, cy - 4, 4, 0, Math.PI * 2);
          ctx.fillStyle = ZONE_COLORS[z.zone - 1]; ctx.fill();
          ctx.font = "13px -apple-system, Segoe UI, Roboto, Arial";
          ctx.fillStyle = COLORS.textMuted;
          ctx.fillText(I18N.t("zoneN", { n: z.zone }), M + pad + 14, cy);

          ctx.textAlign = "center";
          ctx.font = "800 15px -apple-system, Segoe UI, Roboto, Arial";
          ctx.fillStyle = COLORS.good;
          ctx.fillText(String(z.winners), zCol1, cy);
          ctx.fillStyle = COLORS.warn;
          ctx.fillText(String(z.unforcedErrors), zCol2, cy);
          ctx.font = "12px -apple-system, Segoe UI, Roboto, Arial";
          ctx.fillStyle = COLORS.textMuted;
          ctx.fillText(String(z.forcedErrors), zCol3, cy);
          ctx.textAlign = "left";
          cy += rowH;
        });

        // BY SHOT TYPE - same compact layout as the zone table, only shown
        // for shot types the coach actually tagged during the match.
        if (s.shotTypeStats && s.shotTypeStats.length) {
          cy += 4;
          sectionTitle(I18N.t("byShotType"), M + pad, cy);
          cy += 18;
          ctx.strokeStyle = COLORS.divider;
          ctx.beginPath(); ctx.moveTo(M + pad, cy - 12); ctx.lineTo(M + cardW - pad, cy - 12); ctx.stroke();
          ctx.font = "700 10px -apple-system, Segoe UI, Roboto, Arial";
          ctx.fillStyle = COLORS.textMuted;
          ctx.textAlign = "center";
          ctx.fillText("W", zCol1, cy);
          ctx.fillText("U.ERR", zCol2, cy);
          ctx.fillText("F.ERR", zCol3, cy);
          ctx.textAlign = "left";
          cy += rowH;
          const shotTypeLabel = { volley: I18N.t("volley"), smash: I18N.t("smash"), drop: I18N.t("dropShot"), slice: I18N.t("slice") };
          s.shotTypeStats.forEach((z) => {
            ctx.font = "13px -apple-system, Segoe UI, Roboto, Arial";
            ctx.fillStyle = COLORS.textMuted;
            ctx.fillText(shotTypeLabel[z.shotType], M + pad, cy);

            ctx.textAlign = "center";
            ctx.font = "800 15px -apple-system, Segoe UI, Roboto, Arial";
            ctx.fillStyle = COLORS.good;
            ctx.fillText(String(z.winners), zCol1, cy);
            ctx.fillStyle = COLORS.warn;
            ctx.fillText(String(z.unforcedErrors), zCol2, cy);
            ctx.font = "12px -apple-system, Segoe UI, Roboto, Arial";
            ctx.fillStyle = COLORS.textMuted;
            ctx.fillText(String(z.forcedErrors), zCol3, cy);
            ctx.textAlign = "left";
            cy += rowH;
          });
        }
      }

      y += h + 16;
    });

    return canvas;
  }

  // Renders all 3 parts for the same header/cards, ready to hand straight to
  // shareOrDownloadMultiple.
  function renderStatsCanvasParts(matchHeader, cards) {
    return STATS_PARTS.map((p) => ({ suffix: p.id, canvas: renderStatsCanvas(matchHeader, cards, p.id) }));
  }

  // ---------- Point log -> image ----------
  function renderLogCanvas(matchHeader, pointLog, player1, player2) {
    const cols = [
      { key: "idx", label: "#", w: 40 },
      { key: "setNo", label: I18N.t("colSet"), w: 40 },
      { key: "score", label: I18N.t("colScore"), w: 70 },
      { key: "winner", label: I18N.t("colWonBy"), w: 90 },
      { key: "outcome", label: I18N.t("colOutcome"), w: 110 },
      { key: "shots", label: I18N.t("colShots"), w: 110 },
      { key: "zone", label: I18N.t("colZone"), w: 50 },
      { key: "s1", label: I18N.t("col1st"), w: 40 },
      { key: "s2", label: I18N.t("col2nd"), w: 40 },
      { key: "ace", label: I18N.t("colAce"), w: 40 },
      { key: "df", label: I18N.t("colDf"), w: 40 },
      { key: "bp", label: I18N.t("colBp"), w: 40 },
      { key: "rally", label: I18N.t("colRally"), w: 60 },
      { key: "game", label: I18N.t("colGame"), w: 60 },
    ];
    const W = cols.reduce((a, c) => a + c.w, 0) + 40;
    const rowH = 26;
    const headerH = 90;
    const totalH = headerH + rowH * (pointLog.length + 1) + 20;

    const shotLabel = { volley: I18N.t("volley"), smash: I18N.t("smash"), drop: I18N.t("dropShot"), slice: I18N.t("slice") };
    const outcomeLabel = { winner: I18N.t("winner"), forced_error: I18N.t("forcedErrShort"), unforced_error: I18N.t("unforcedErrShort") };

    const canvas = document.createElement("canvas");
    const scale = 2;
    canvas.width = W * scale;
    canvas.height = totalH * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, totalH);

    ctx.fillStyle = "#145c2c";
    ctx.font = "700 18px -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText("🎾 " + matchHeader.title, 20, 26);
    ctx.fillStyle = "#6b7280";
    ctx.font = "12px -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(matchHeader.subtitle, 20, 44);

    let x = 20, y = headerH;
    ctx.font = "700 11px -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = "#374151";
    ctx.fillRect(20, y, W - 40, rowH);
    ctx.strokeStyle = "#d8ddd8";
    x = 20;
    ctx.fillStyle = "#111827";
    cols.forEach((c) => {
      ctx.fillText(c.label, x + 6, y + 17);
      x += c.w;
    });
    y += rowH;

    ctx.font = "11px -apple-system, Segoe UI, Roboto, Arial";
    pointLog.forEach((p, i) => {
      if (i % 2 === 0) { ctx.fillStyle = "#f4f6f4"; ctx.fillRect(20, y, W - 40, rowH); }
      const winnerName = p.pointWinner === 1 ? player1 : player2;
      const result = p.ace ? I18N.t("ace") : p.doubleFault ? I18N.t("doubleFault") : (outcomeLabel[p.outcome] || "");
      const shots = (p.shots || []).map((s) => shotLabel[s]).join(", ");
      const values = {
        idx: p.idx, setNo: p.setNo, score: p.score, winner: winnerName, outcome: result,
        shots, zone: p.zone ?? "", s1: p.s1 ? "✓" : "", s2: p.s2 ? "✓" : "",
        ace: p.ace ? "✓" : "", df: p.doubleFault ? "✓" : "", bp: p.breakPoint ? "BP" : "",
        rally: p.rallyBucket || "", game: p.gameScore || "",
      };
      ctx.fillStyle = "#1a1a1a";
      x = 20;
      cols.forEach((c) => {
        const text = String(values[c.key] ?? "");
        const truncated = ctx.measureText(text).width > c.w - 8 ? text.slice(0, 10) + "…" : text;
        ctx.fillText(truncated, x + 6, y + 17);
        x += c.w;
      });
      y += rowH;
    });

    ctx.strokeStyle = "#d8ddd8";
    ctx.strokeRect(20, headerH, W - 40, rowH * (pointLog.length + 1));

    return canvas;
  }

  // ---------- Print (native "Save as PDF") ----------
  function printSection(mode) {
    document.body.classList.add(mode);
    window.print();
    setTimeout(() => document.body.classList.remove(mode), 300);
  }

  window.TennisExport = {
    shareOrDownloadCanvas, shareOrDownloadMultiple, renderStatsCanvas, renderStatsCanvasParts, renderLogCanvas, printSection,
  };
})();
