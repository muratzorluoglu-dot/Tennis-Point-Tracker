/* Player insights: form, achievements ("badges") and team ranking helpers.
 * Pure functions - no DOM and no storage, so they are easy to test. app.js gathers the numbers
 * (from computeCareerStats / computeAggregateStats / the saved matches) and passes them in.
 */
const Insights = (function () {
  // results: chronological [{ won: boolean }] for FINISHED matches
  function bestWinStreak(results) {
    let best = 0, cur = 0;
    results.forEach((r) => { cur = r.won ? cur + 1 : 0; if (cur > best) best = cur; });
    return best;
  }

  function currentWinStreak(results) {
    let s = 0;
    for (let i = results.length - 1; i >= 0 && results[i].won; i--) s++;
    return s;
  }

  /*
   * c = {
   *   wins, results, aces, servicePts, firstServePct, bigPts, bigPct,
   *   tbWon, tbPlayed, tbWinPct, comebacks, winners, unforcedErrors, outcomeTagged
   * }
   * Each badge: earned flag + a short progress string for the locked ones.
   */
  const DEFS = [
    { id: "firstWin", icon: "🏆", progress: (c) => [Math.min(c.wins, 1), 1], earned: (c) => c.wins >= 1 },
    { id: "wins10", icon: "🎖️", progress: (c) => [Math.min(c.wins, 10), 10], earned: (c) => c.wins >= 10 },
    { id: "streak3", icon: "🔥", progress: (c) => [Math.min(bestWinStreak(c.results), 3), 3], earned: (c) => bestWinStreak(c.results) >= 3 },
    { id: "aces10", icon: "🎯", progress: (c) => [Math.min(c.aces, 10), 10], earned: (c) => c.aces >= 10 },
    {
      id: "serve65", icon: "🛡️",
      progress: (c) => (c.servicePts >= 50 ? [Math.round(c.firstServePct), 65, "%"] : [c.servicePts, 50, " pts"]),
      earned: (c) => c.servicePts >= 50 && c.firstServePct >= 65,
    },
    {
      id: "clutch60", icon: "💪",
      progress: (c) => (c.bigPts >= 10 ? [Math.round(c.bigPct), 60, "%"] : [c.bigPts, 10, " pts"]),
      earned: (c) => c.bigPts >= 10 && c.bigPct >= 60,
    },
    {
      id: "tiebreak", icon: "🧊",
      progress: (c) => [Math.min(c.tbWon, 2), 2],
      earned: (c) => c.tbWon >= 2 && c.tbWinPct >= 60,
    },
    { id: "comeback", icon: "🔄", progress: (c) => [Math.min(c.comebacks, 1), 1], earned: (c) => c.comebacks >= 1 },
    {
      id: "tidy", icon: "🧼",
      progress: (c) => (c.outcomeTagged >= 20 ? [Math.round((c.winners / Math.max(c.unforcedErrors, 1)) * 10) / 10, 1, "x"] : [c.outcomeTagged, 20, " pts"]),
      earned: (c) => c.outcomeTagged >= 20 && c.winners >= c.unforcedErrors,
    },
  ];

  // t: translate function. Returns earned badges first, then the locked ones (with progress).
  function computeBadges(c, t) {
    const list = DEFS.map((d) => {
      const [cur, target, unit = ""] = d.progress(c);
      return {
        id: d.id, icon: d.icon, earned: d.earned(c),
        name: t("badge_" + d.id), desc: t("badgeDesc_" + d.id),
        progress: `${cur}${unit}/${target}${unit}`,
      };
    });
    return [...list.filter((b) => b.earned), ...list.filter((b) => !b.earned)];
  }

  const SORTS = {
    winPct: (r) => r.winPct,
    matches: (r) => r.matches,
    pointsPct: (r) => r.pointsPct,
    aces: (r) => r.aces,
    bigPct: (r) => r.bigPct,
  };

  // rows: [{ name, matches, winPct, pointsPct, aces, bigPct, ... }] -> sorted copy (ties: more matches, then name)
  function sortTeam(rows, key) {
    const get = SORTS[key] || SORTS.winPct;
    return rows.slice().sort((a, b) => get(b) - get(a) || b.matches - a.matches || a.name.localeCompare(b.name));
  }

  return { bestWinStreak, currentWinStreak, computeBadges, sortTeam, SORT_KEYS: Object.keys(SORTS) };
})();

if (typeof module !== "undefined") module.exports = { Insights };
