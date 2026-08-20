/* AI Review: an on-device, rule-based coaching analysis built from this
 * match's own stats (no network call, no API key, works fully offline).
 * The heuristics and thresholds are modeled on widely-used tennis coaching
 * benchmarks (serve consistency, winner/UE ratio, break-point conversion,
 * rally-length patterns, court-zone shot placement) rather than quoting any
 * single named coach. Every insight only fires once the underlying sample
 * size is large enough to be meaningful, so small/short matches get a
 * shorter, more conservative review instead of noisy conclusions.
 */
(function () {
  function pct(n) { return Math.round(n); }
  function ratio(n) { return n === Infinity ? "∞" : n.toFixed(1); }

  function push(list, key, vars) { list.push({ key, vars }); }

  function generateReview(s, ctx) {
    const strengths = [];
    const weaknesses = [];
    const trainingFocus = [];
    const nextMatchTips = [];

    const ueRate = s.pointsPlayed ? (s.unforcedErrorsCount / s.pointsPlayed) * 100 : 0;
    const enoughPoints = s.pointsPlayed >= 4;

    // --- Overall ---
    let summary;
    if (!enoughPoints) {
      summary = { key: "aiSummaryTooShort", vars: { name: ctx.playerName } };
    } else if (s.pointsWonPct >= 58) {
      summary = { key: "aiSummaryDominant", vars: { name: ctx.playerName, pct: pct(s.pointsWonPct) } };
    } else if (s.pointsWonPct <= 42) {
      summary = { key: "aiSummaryStruggled", vars: { name: ctx.playerName, pct: pct(s.pointsWonPct) } };
    } else {
      summary = { key: "aiSummaryClose", vars: { name: ctx.playerName, pct: pct(s.pointsWonPct) } };
    }

    // --- Shot efficiency (weighted first: most decisive pattern) ---
    if (s.pointsPlayed >= 10) {
      if (s.winnerToUERatio >= 2 && s.winnersCount >= 3) {
        push(strengths, "aiWinnerRatioHigh", { ratio: ratio(s.winnerToUERatio) });
      } else if (s.winnerToUERatio < 1 && s.unforcedErrorsCount >= 3) {
        push(weaknesses, "aiWinnerRatioLow", { ratio: ratio(s.winnerToUERatio) });
        push(trainingFocus, "aiWinnerRatioLowFocus", {});
      }

      if (ueRate >= 20) {
        push(weaknesses, "aiUeRateHigh", { pct: pct(ueRate) });
        push(trainingFocus, "aiUeRateHighFocus", {});
      } else if (ueRate <= 8 && s.pointsPlayed >= 15) {
        push(strengths, "aiUeRateLow", { pct: pct(ueRate) });
      }
    }

    // --- Serve ---
    if (s.servicePointsPlayed >= 4) {
      if (s.firstServeInPct >= 65) {
        push(strengths, "aiServeFirstInHigh", { pct: pct(s.firstServeInPct) });
      } else if (s.firstServeInPct < 50) {
        push(weaknesses, "aiServeFirstInLow", { pct: pct(s.firstServeInPct) });
        push(trainingFocus, "aiServeFirstInLowFocus", {});
      }

      if (s.firstServeInCount >= 3 && s.firstServeWonPct >= 75) {
        push(strengths, "aiServeFirstWonHigh", { pct: pct(s.firstServeWonPct) });
      }

      if (s.secondServeInCount >= 3 && s.secondServeWonPct < 45) {
        push(weaknesses, "aiServeSecondWonLow", { pct: pct(s.secondServeWonPct) });
        push(trainingFocus, "aiServeSecondWonLowFocus", {});
        push(nextMatchTips, "aiServeSecondWonLowTip", {});
      }

      if (s.doubleFaultPct >= 8) {
        push(weaknesses, "aiDoubleFaultHigh", { pct: pct(s.doubleFaultPct) });
        push(trainingFocus, "aiDoubleFaultHighFocus", {});
      }

      if (s.breakPointsFaced >= 2) {
        if (s.breakPointsSavedPct < 40) {
          push(weaknesses, "aiBpSavedLow", { pct: pct(s.breakPointsSavedPct) });
          push(nextMatchTips, "aiBpSavedLowTip", {});
        } else if (s.breakPointsSavedPct >= 65) {
          push(strengths, "aiBpSavedHigh", { pct: pct(s.breakPointsSavedPct) });
        }
      }
    }

    // --- Return ---
    if (s.returnPointsPlayed >= 4) {
      if (s.returnPointsWonPct >= 40) {
        push(strengths, "aiReturnWonHigh", { pct: pct(s.returnPointsWonPct) });
      } else if (s.returnPointsWonPct < 30) {
        push(weaknesses, "aiReturnWonLow", { pct: pct(s.returnPointsWonPct) });
        push(trainingFocus, "aiReturnWonLowFocus", {});
      }

      if (s.breakPointsChances >= 2) {
        if (s.breakPointsConvertedPct < 30) {
          push(weaknesses, "aiBpConvertedLow", { pct: pct(s.breakPointsConvertedPct) });
          push(nextMatchTips, "aiBpConvertedLowTip", {});
        } else if (s.breakPointsConvertedPct >= 60) {
          push(strengths, "aiBpConvertedHigh", { pct: pct(s.breakPointsConvertedPct) });
        }
      }
    }

    // --- Net game ---
    if (s.netPointsPlayed >= 3) {
      if (s.netPointsWonPct >= 65) {
        push(strengths, "aiNetHigh", { pct: pct(s.netPointsWonPct) });
      } else if (s.netPointsWonPct < 50) {
        push(weaknesses, "aiNetLow", { pct: pct(s.netPointsWonPct) });
        push(trainingFocus, "aiNetLowFocus", {});
      }
    }

    // --- Rally length patterns ---
    const playedBuckets = s.rallyBreakdown.filter((b) => b.played >= 3);
    if (playedBuckets.length) {
      const worst = playedBuckets.reduce((a, b) => (b.wonPct < a.wonPct ? b : a));
      const best = playedBuckets.reduce((a, b) => (b.wonPct > a.wonPct ? b : a));
      if (worst.wonPct < 40) {
        push(weaknesses, "aiRallyWeakBucket", { bucket: worst.id, pct: pct(worst.wonPct) });
        push(trainingFocus, "aiRallyWeakBucketFocus", { bucket: worst.id });
      }
      if (best.wonPct >= 60 && best.id !== worst.id) {
        push(strengths, "aiRallyStrongBucket", { bucket: best.id, pct: pct(best.wonPct) });
      }
    }

    // --- Court zone patterns ---
    const zonesWithData = s.zoneStats.filter((z) => z.winners + z.unforcedErrors + z.forcedErrors >= 3);
    if (zonesWithData.length) {
      const worstZone = zonesWithData.reduce((a, z) =>
        (z.unforcedErrors - z.winners) > (a.unforcedErrors - a.winners) ? z : a);
      if (worstZone.unforcedErrors > worstZone.winners) {
        push(weaknesses, "aiZoneWeak", { zone: worstZone.zone });
        push(trainingFocus, "aiZoneWeakFocus", { zone: worstZone.zone });
      }
      const bestZone = zonesWithData.reduce((a, z) =>
        (z.winners - z.unforcedErrors) > (a.winners - a.unforcedErrors) ? z : a);
      if (bestZone.winners > bestZone.unforcedErrors && bestZone.winners >= 2 && bestZone.zone !== worstZone.zone) {
        push(strengths, "aiZoneStrong", { zone: bestZone.zone });
      }
    }

    // Fallbacks so every section always has something to show.
    if (!strengths.length) push(strengths, "aiNoStrengthsFallback", {});
    if (!weaknesses.length) push(weaknesses, "aiNoWeaknessesFallback", {});
    if (!trainingFocus.length) push(trainingFocus, "aiNoTrainingFallback", {});
    if (!nextMatchTips.length) push(nextMatchTips, "aiNoTipsFallback", {});

    const notes = [];
    if (s.pointsPlayed > 0 && s.pointsPlayed < 20) notes.push({ key: "aiSmallSample", vars: {} });

    return {
      summary,
      strengths: strengths.slice(0, 5),
      weaknesses: weaknesses.slice(0, 5),
      trainingFocus: trainingFocus.slice(0, 5),
      nextMatchTips: nextMatchTips.slice(0, 5),
      notes,
    };
  }

  window.AICoach = { generateReview };
})();
