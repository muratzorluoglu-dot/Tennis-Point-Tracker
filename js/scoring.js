/* Tennis scoring engine.
 * Configurable format: games per set, Ad/No-Ad scoring, the game score at which
 * a tiebreak triggers, and an optional match tiebreak (10 points) for the final set.
 * Ready-made ITF alternative-format presets live in app.js.
 */

const POINT_LABELS = ["0", "15", "30", "40"];
const RALLY_BUCKET_IDS = ["1-4", "5-9", "10-15", "16-25", "26+"];

function makeGame(server, tbTarget = 7) {
  return {
    server,               // 1 | 2
    p1: 0, p2: 0,         // points won within the game (also used for tiebreaks)
    tiebreak: false,
    tbTarget,             // tiebreak target score (7 normal, 10 for a match tiebreak)
    winner: null,         // 1 | 2 | null
  };
}

function makeSet() {
  return {
    games: [],            // completed + active games
    p1Games: 0,
    p2Games: 0,
    winner: null,
    isMatchTiebreakSet: false, // true if this set is a single 10-point match tiebreak
    startTime: null,
    endTime: null,
  };
}

class TennisMatch {
  constructor({
    player1, player2, bestOf = 3, startingServer = 1,
    format = {},
  } = {}) {
    this.player1 = player1 || "Player 1";
    this.player2 = player2 || "Player 2";
    this.bestOf = bestOf;
    this.setsToWin = Math.ceil(bestOf / 2);
    this.format = {
      gamesPerSet: format.gamesPerSet ?? 6,
      noAd: !!format.noAd,
      tbAt: format.tbAt ?? 6,
      finalSetMatchTiebreak: !!format.finalSetMatchTiebreak,
      formatId: format.formatId || null,   // stable id the UI layer maps to a translated label
      formatLabel: format.formatLabel || "Standard (6 Games, Ad, TB at 6-6)", // legacy/English fallback
    };
    this.matchWinner = null;
    this.matchStartTime = new Date().toISOString();
    this.matchEndTime = null;

    this.sets = [makeSet()];
    this.sets[0].startTime = new Date().toISOString();
    this.sets[0].games.push(makeGame(startingServer));

    this.pointLog = [];   // flat point-by-point log
    this._history = [];   // snapshots for undo
  }

  get currentSet() { return this.sets[this.sets.length - 1]; }
  get currentGame() { return this.currentSet.games[this.currentSet.games.length - 1]; }
  get isTiebreak() { return this.currentGame.tiebreak; }

  currentServer() { return this.currentGame.server; }

  /**
   * Change who is serving the current game. Only allowed before the first
   * point of the match has been recorded (i.e. the coach picked wrong on
   * the setup screen and wants to fix it before play actually starts).
   */
  setServer(player) {
    if (this.pointLog.length > 0) return false;
    this.currentGame.server = player;
    return true;
  }

  // Player-relative display: "15-30" (p1-p2), or "Deuce" / "Advantage <name>".
  // `labels` lets the UI layer supply translated words; engine defaults to English.
  pointDisplay(labels = { deuce: "Deuce", advantage: "Advantage" }) {
    const g = this.currentGame;
    if (g.tiebreak) return `${g.p1}-${g.p2}`;
    if (this.format.noAd) {
      return `${POINT_LABELS[Math.min(g.p1, 3)]}-${POINT_LABELS[Math.min(g.p2, 3)]}`;
    }
    if (g.p1 >= 3 && g.p2 >= 3) {
      if (g.p1 === g.p2) return labels.deuce;
      return g.p1 > g.p2 ? `${labels.advantage} ${this.player1}` : `${labels.advantage} ${this.player2}`;
    }
    return `${POINT_LABELS[g.p1]}-${POINT_LABELS[g.p2]}`;
  }

  /**
   * What's riding on the very next point, from each player's perspective:
   * break/game point (wins the game), set point (also wins the set), or
   * match point (also wins the match). Returns [] when nothing is at stake
   * yet (e.g. plain deuce) or the match is already over.
   * Each entry: { player, key: 'breakPoint'|'gamePoint'|'setPoint'|'matchPoint' }
   */
  pointStakes() {
    if (this.matchWinner) return [];
    const g = this.currentGame;
    const server = this.currentServer();
    const returner = server === 1 ? 2 : 1;
    const set = this.currentSet;
    const results = [];

    [1, 2].forEach((player) => {
      if (!this._wouldWinGame(g, player)) return;

      let hypP1 = set.p1Games, hypP2 = set.p2Games;
      if (set.isMatchTiebreakSet) {
        hypP1 = player === 1 ? g.p1 + 1 : g.p1;
        hypP2 = player === 2 ? g.p2 + 1 : g.p2;
      } else if (player === 1) {
        hypP1++;
      } else {
        hypP2++;
      }
      const setWon = this._isSetOver({ p1Games: hypP1, p2Games: hypP2, isMatchTiebreakSet: set.isMatchTiebreakSet, games: set.games, winner: null });

      let key;
      if (setWon) {
        const setsWon = this.sets.filter((s) => s.winner === player).length + 1;
        key = setsWon === this.setsToWin ? "matchPoint" : "setPoint";
      } else {
        key = (!g.tiebreak && player === returner) ? "breakPoint" : "gamePoint";
      }
      results.push({ player, key });
    });

    return results;
  }

  setScoreLabel(set = this.currentSet) { return `${set.p1Games}-${set.p2Games}`; }

  matchScoreLabel() {
    return this.sets
      .filter(s => s.winner)
      .map(s => `${s.p1Games}-${s.p2Games}`)
      .join(", ");
  }

  _snapshot() {
    return JSON.parse(JSON.stringify({
      sets: this.sets, matchWinner: this.matchWinner, matchEndTime: this.matchEndTime,
      pointLog: this.pointLog,
    }));
  }

  _restore(snap) {
    this.sets = snap.sets;
    this.matchWinner = snap.matchWinner;
    this.matchEndTime = snap.matchEndTime;
    this.pointLog = snap.pointLog;
  }

  // Would the given player win this game if they took one more point?
  // (used for break point detection, and for game/set/match point labels)
  _wouldWinGame(game, player) {
    const p1 = game.p1 + (player === 1 ? 1 : 0);
    const p2 = game.p2 + (player === 2 ? 1 : 0);
    if (game.tiebreak) {
      const target = game.tbTarget || 7;
      return (p1 >= target || p2 >= target) && Math.abs(p1 - p2) >= 2;
    }
    return this._gameOverForPoints(p1, p2);
  }

  _gameOverForPoints(p1, p2) {
    if (this.format.noAd) return p1 >= 4 || p2 >= 4;
    return (p1 >= 4 || p2 >= 4) && Math.abs(p1 - p2) >= 2;
  }

  /**
   * Records a point.
   * meta: {
   *   serveResult: 'S1' | 'S2' | 'DF',
   *   ace: boolean,
   *   rallyBucket: string,   // e.g. '5-9'
   *   rallyValue: number,    // representative number used for averaging
   *   pointWinner: 1 | 2,    // who won the point (required unless ace/DF)
   *   outcome: 'winner' | 'forced_error' | 'unforced_error' | null,  // optional detail
   *   shots: string[],       // subset of 'volley' | 'smash' | 'drop' | 'slice', optional
   *   zone: 1-5 | null,      // optional
   * }
   */
  addPoint(meta) {
    if (this.matchWinner) throw new Error("Match is already finished");
    this._history.push(this._snapshot());

    const server = this.currentServer();
    const returner = server === 1 ? 2 : 1;
    let winner;

    if (meta.serveResult === "DF") {
      winner = returner;
    } else if (meta.ace) {
      winner = server;
    } else if (meta.pointWinner === 1 || meta.pointWinner === 2) {
      winner = meta.pointWinner;
    } else {
      throw new Error("Point winner was not specified");
    }

    const setBefore = this.currentSet;
    const gameBefore = this.currentGame;
    const setIndex = this.sets.length - 1;
    const gameIndex = setBefore.games.length - 1;

    // break point detection (regular service games only, not during tiebreaks)
    const isBreakPointChance = !gameBefore.tiebreak && this._wouldWinGame(gameBefore, returner);
    // what's at stake for this exact point (break/game/set/match point, for whichever
    // player it applies to) - captured before the point is applied, for pressure-point stats
    const stakes = this.pointStakes();

    // update in-game point count
    if (winner === 1) gameBefore.p1++; else gameBefore.p2++;

    const gameJustOver = this._isGameOver(gameBefore);
    // the point that ends a game can fall outside the POINT_LABELS range
    // (e.g. 40-15 -> 4-1), so only use pointDisplay() when the game continues.
    const scoreAfterPoint = gameJustOver ? "Game" : this.pointDisplay();

    let gameEnded = false, setEnded = false, matchEnded = false;
    let setScoreAfter = null;

    if (gameJustOver) {
      gameEnded = true;
      const gameWinner = gameBefore.p1 > gameBefore.p2 ? 1 : 2;
      gameBefore.winner = gameWinner;
      if (!gameBefore.tiebreak) {
        if (gameWinner === 1) setBefore.p1Games++; else setBefore.p2Games++;
      } else if (setBefore.isMatchTiebreakSet) {
        // match tiebreak: the set score directly reflects the tiebreak points (e.g. 10-7)
        setBefore.p1Games = gameBefore.p1;
        setBefore.p2Games = gameBefore.p2;
      } else {
        // regular end-of-set tiebreak (e.g. 6-6 -> 7-6)
        if (gameWinner === 1) setBefore.p1Games++; else setBefore.p2Games++;
      }
      setScoreAfter = this.setScoreLabel(setBefore);

      if (this._isSetOver(setBefore)) {
        setEnded = true;
        setBefore.winner = setBefore.p1Games > setBefore.p2Games ? 1 : 2;
        setBefore.endTime = new Date().toISOString();

        const setsWon1 = this.sets.filter(s => s.winner === 1).length;
        const setsWon2 = this.sets.filter(s => s.winner === 2).length;

        if (setsWon1 === this.setsToWin || setsWon2 === this.setsToWin) {
          matchEnded = true;
          this.matchWinner = setsWon1 === this.setsToWin ? 1 : 2;
          this.matchEndTime = new Date().toISOString();
        } else {
          const nextServer = returner; // serve rotation continues into the next set
          const ns = makeSet();
          ns.startTime = new Date().toISOString();
          const isDecidingSet = (this.sets.length + 1) === this.bestOf;
          if (this.format.finalSetMatchTiebreak && isDecidingSet) {
            ns.isMatchTiebreakSet = true;
            const g = makeGame(nextServer, 10);
            g.tiebreak = true;
            ns.games.push(g);
          } else {
            ns.games.push(makeGame(nextServer));
          }
          this.sets.push(ns);
        }
      } else {
        // new game, serve changes hands (except when it's a tiebreak, handled separately above)
        const willBeTiebreak = setBefore.p1Games === this.format.tbAt && setBefore.p2Games === this.format.tbAt;
        const ng = makeGame(returner);
        ng.tiebreak = willBeTiebreak;
        setBefore.games.push(ng);
      }
    }

    const isError = meta.outcome === "forced_error" || meta.outcome === "unforced_error";

    const entry = {
      idx: this.pointLog.length + 1,
      setNo: setIndex + 1,
      gameNo: gameIndex + 1,
      score: scoreAfterPoint,
      outcome: meta.outcome || null, // 'winner' | 'forced_error' | 'unforced_error' | null
      winnerPlayer: meta.outcome === "winner" ? winner : null,
      errorPlayer: isError ? (winner === 1 ? 2 : 1) : null,
      shots: meta.shots || [],
      zone: meta.zone ?? null,
      s1: meta.serveResult === "S1",
      s2: meta.serveResult === "S2",
      ace: !!meta.ace,
      doubleFault: meta.serveResult === "DF",
      rallyBucket: meta.rallyBucket ?? (meta.ace ? "1-4" : meta.serveResult === "DF" ? null : null),
      rallyValue: meta.rallyValue ?? (meta.ace ? 1 : meta.serveResult === "DF" ? 0 : null),
      server,
      returner,
      pointWinner: winner,
      pointLoser: winner === 1 ? 2 : 1,
      breakPoint: isBreakPointChance,
      breakPointSaved: isBreakPointChance && winner === server,
      breakPointConverted: isBreakPointChance && winner === returner,
      stakes, // [{player, key: 'breakPoint'|'gamePoint'|'setPoint'|'matchPoint'}] - what was on the line before this point
      gameScore: gameEnded ? setScoreAfter : "",
      gameEnded, setEnded, matchEnded,
      timestamp: new Date().toISOString(),
    };
    this.pointLog.push(entry);

    return entry;
  }

  _isGameOver(game) {
    if (game.tiebreak) {
      const target = game.tbTarget || 7;
      return (game.p1 >= target || game.p2 >= target) && Math.abs(game.p1 - game.p2) >= 2;
    }
    return this._gameOverForPoints(game.p1, game.p2);
  }

  _isSetOver(set) {
    if (set.isMatchTiebreakSet) return !!set.winner || (set.games[0] && set.games[0].winner);
    const { p1Games: a, p2Games: b, } = set;
    const { gamesPerSet, tbAt } = this.format;
    if ((a >= gamesPerSet || b >= gamesPerSet) && Math.abs(a - b) >= 2) return true;
    if (a === tbAt + 1 || b === tbAt + 1) return true; // after a tiebreak (e.g. 7-6, 5-4)
    return false;
  }

  canUndo() { return this._history.length > 0; }

  undo() {
    if (!this.canUndo()) return;
    const snap = this._history.pop();
    this._restore(snap);
  }

  isMatchOver() { return !!this.matchWinner; }
}

/**
 * Match stats (summary screen) — categories modeled after ITF / Tennis Europe
 * match stat sheets: serve, return, shot efficiency, rally analysis.
 * `sets` is needed to find game winners (service/return games won %).
 */
function computeStats(sets, pointLog, player, setNo /* null = whole match */) {
  const opponent = player === 1 ? 2 : 1;
  const rows = setNo ? pointLog.filter(p => p.setNo === setNo) : pointLog;
  const relevantSets = setNo ? sets.filter((s, i) => i + 1 === setNo) : sets;

  const s = {};

  // --- Overall point efficiency ---
  s.pointsPlayed = rows.length;
  s.pointsWon = rows.filter(p => p.pointWinner === player).length;
  s.pointsLost = rows.length - s.pointsWon;
  s.pointsWonPct = s.pointsPlayed ? (s.pointsWon / s.pointsPlayed) * 100 : 0;

  // --- Serve ---
  const servicePts = rows.filter(p => p.server === player);
  s.servicePointsPlayed = servicePts.length;
  s.firstServeInCount = servicePts.filter(p => p.s1).length;
  s.secondServeInCount = servicePts.filter(p => p.s2).length;
  s.doubleFaultCount = servicePts.filter(p => p.doubleFault).length;
  s.aceCount = servicePts.filter(p => p.ace).length;
  s.firstServeInPct = s.servicePointsPlayed ? (s.firstServeInCount / s.servicePointsPlayed) * 100 : 0;
  s.secondServeInPct = s.servicePointsPlayed ? (s.secondServeInCount / s.servicePointsPlayed) * 100 : 0;
  s.doubleFaultPct = s.servicePointsPlayed ? (s.doubleFaultCount / s.servicePointsPlayed) * 100 : 0;
  s.firstServeWonPct = s.firstServeInCount ? (servicePts.filter(p => p.s1 && p.pointWinner === player).length / s.firstServeInCount) * 100 : 0;
  s.secondServeWonPct = s.secondServeInCount ? (servicePts.filter(p => p.s2 && p.pointWinner === player).length / s.secondServeInCount) * 100 : 0;
  s.servicePointsWonPct = s.servicePointsPlayed ? (servicePts.filter(p => p.pointWinner === player).length / s.servicePointsPlayed) * 100 : 0;
  s.breakPointsFaced = servicePts.filter(p => p.breakPoint).length;
  s.breakPointsSaved = servicePts.filter(p => p.breakPointSaved).length;
  s.breakPointsSavedPct = s.breakPointsFaced ? (s.breakPointsSaved / s.breakPointsFaced) * 100 : 0;

  // --- Return ---
  const returnPts = rows.filter(p => p.returner === player);
  s.returnPointsPlayed = returnPts.length;
  const returnVs1st = returnPts.filter(p => p.s1);
  const returnVs2nd = returnPts.filter(p => p.s2);
  s.firstServeReturnWonPct = returnVs1st.length ? (returnVs1st.filter(p => p.pointWinner === player).length / returnVs1st.length) * 100 : 0;
  s.secondServeReturnWonPct = returnVs2nd.length ? (returnVs2nd.filter(p => p.pointWinner === player).length / returnVs2nd.length) * 100 : 0;
  s.returnPointsWonPct = s.returnPointsPlayed ? (returnPts.filter(p => p.pointWinner === player).length / s.returnPointsPlayed) * 100 : 0;
  s.breakPointsChances = returnPts.filter(p => p.breakPoint).length;
  s.breakPointsConverted = returnPts.filter(p => p.breakPointConverted).length;
  s.breakPointsConvertedPct = s.breakPointsChances ? (s.breakPointsConverted / s.breakPointsChances) * 100 : 0;

  // --- Games: service/return games won % ---
  const decidedGames = relevantSets.flatMap(set => set.games.filter(g => g.winner && !g.tiebreak));
  const serviceGames = decidedGames.filter(g => g.server === player);
  const returnGames = decidedGames.filter(g => g.server === opponent);
  s.serviceGamesPlayed = serviceGames.length;
  s.serviceGamesWon = serviceGames.filter(g => g.winner === player).length;
  s.serviceGamesWonPct = s.serviceGamesPlayed ? (s.serviceGamesWon / s.serviceGamesPlayed) * 100 : 0;
  s.returnGamesPlayed = returnGames.length;
  s.returnGamesWon = returnGames.filter(g => g.winner === player).length;
  s.returnGamesWonPct = s.returnGamesPlayed ? (s.returnGamesWon / s.returnGamesPlayed) * 100 : 0;

  // --- Shot / error efficiency ---
  s.winnersCount = rows.filter(p => p.outcome === "winner" && p.pointWinner === player).length;
  s.forcedErrorsCount = rows.filter(p => p.outcome === "forced_error" && p.errorPlayer === player).length;
  s.unforcedErrorsCount = rows.filter(p => p.outcome === "unforced_error" && p.errorPlayer === player).length;
  s.totalErrorsCount = s.forcedErrorsCount + s.unforcedErrorsCount;
  s.winnerToUERatio = s.unforcedErrorsCount ? (s.winnersCount / s.unforcedErrorsCount) : (s.winnersCount > 0 ? Infinity : 0);

  // Who hit the tagged shot(s) for this point: the winner/error player when an
  // outcome was tagged, otherwise fall back to the point winner - a coach can
  // tag a shot type (volley/smash/drop/slice) without also tagging an outcome,
  // and that shot shouldn't silently disappear from the shot stats.
  const shotOwner = (p) => {
    if (p.outcome === "winner") return p.winnerPlayer;
    if (p.outcome === "forced_error" || p.outcome === "unforced_error") return p.errorPlayer;
    return p.pointWinner;
  };

  // net points (volley/drop) decided by this player: how often they won when playing them
  const netActionRows = rows.filter(p =>
    shotOwner(p) === player &&
    (p.shots || []).some(shot => shot === "volley" || shot === "drop"));
  s.netPointsPlayed = netActionRows.length;
  s.netPointsWonPct = netActionRows.length ? (netActionRows.filter(p => p.pointWinner === player).length / netActionRows.length) * 100 : 0;

  s.shotsPlayed = { volley: 0, smash: 0, drop: 0, slice: 0 };
  rows.forEach(p => {
    const isThisPlayersAction = shotOwner(p) === player;
    if (isThisPlayersAction) (p.shots || []).forEach(shot => { if (s.shotsPlayed[shot] !== undefined) s.shotsPlayed[shot]++; });
  });

  // Winners/errors broken down by which shot type produced them (only shot
  // types actually used show up, so a match with no slices doesn't add a
  // pointless zero row).
  s.shotTypeStats = Object.keys(s.shotsPlayed).map(shotType => ({
    shotType,
    winners: rows.filter(p => p.outcome === "winner" && p.winnerPlayer === player && (p.shots || []).includes(shotType)).length,
    unforcedErrors: rows.filter(p => p.outcome === "unforced_error" && p.errorPlayer === player && (p.shots || []).includes(shotType)).length,
    forcedErrors: rows.filter(p => p.outcome === "forced_error" && p.errorPlayer === player && (p.shots || []).includes(shotType)).length,
  })).filter(z => z.winners + z.unforcedErrors + z.forcedErrors > 0);

  // --- Pressure points: break/game/set/match points, from either player's
  // perspective - the "big points" of the match, regardless of who they were
  // numerically at stake for (this is how coaches/broadcasts usually talk
  // about them, not split by server/returner role).
  const isPressurePoint = (p) => (p.stakes || []).length > 0;
  const pressureRows = rows.filter(isPressurePoint);
  s.pressurePointsPlayed = pressureRows.length;
  s.pressurePointsWon = pressureRows.filter(p => p.pointWinner === player).length;
  s.pressurePointsWonPct = pressureRows.length ? (s.pressurePointsWon / pressureRows.length) * 100 : 0;
  s.unforcedErrorsOnPressure = rows.filter(p => p.outcome === "unforced_error" && p.errorPlayer === player && isPressurePoint(p)).length;

  // --- Streaks: longest run of consecutive points won / lost, in play order ---
  let curWin = 0, curLoss = 0;
  s.longestWinStreak = 0; s.longestLossStreak = 0;
  rows.forEach(p => {
    if (p.pointWinner === player) { curWin++; curLoss = 0; } else { curLoss++; curWin = 0; }
    if (curWin > s.longestWinStreak) s.longestWinStreak = curWin;
    if (curLoss > s.longestLossStreak) s.longestLossStreak = curLoss;
  });

  // --- Game trend: points-won % within each game played, in chronological
  // order, so a coach can see where the player pulled away or faded.
  const gameGroups = [];
  let lastGameKey = null;
  rows.forEach(p => {
    const key = `${p.setNo}-${p.gameNo}`;
    if (key !== lastGameKey) { gameGroups.push([]); lastGameKey = key; }
    gameGroups[gameGroups.length - 1].push(p);
  });
  s.gameTrend = gameGroups.map(g => {
    const won = g.filter(p => p.pointWinner === player).length;
    return { played: g.length, won, wonPct: g.length ? (won / g.length) * 100 : 0 };
  });

  // --- By court zone: where winners and errors happened ---
  s.zoneStats = [1, 2, 3, 4, 5].map(zone => ({
    zone,
    winners: rows.filter(p => p.outcome === "winner" && p.winnerPlayer === player && p.zone === zone).length,
    unforcedErrors: rows.filter(p => p.outcome === "unforced_error" && p.errorPlayer === player && p.zone === zone).length,
    forcedErrors: rows.filter(p => p.outcome === "forced_error" && p.errorPlayer === player && p.zone === zone).length,
  }));

  // --- Rally analysis ---
  const withRally = rows.filter(p => typeof p.rallyValue === "number" && p.rallyValue > 0);
  s.avgRallyLength = withRally.length ? (withRally.reduce((a, p) => a + p.rallyValue, 0) / withRally.length) : 0;
  s.rallyBreakdown = RALLY_BUCKET_IDS.map(id => {
    const bucketRows = rows.filter(p => p.rallyBucket === id);
    const won = bucketRows.filter(p => p.pointWinner === player).length;
    return { id, played: bucketRows.length, won, wonPct: bucketRows.length ? (won / bucketRows.length) * 100 : 0 };
  });

  // --- Games/sets ---
  s.gamesWon = relevantSets.reduce((sum, set) => sum + (player === 1 ? set.p1Games : set.p2Games), 0);

  return s;
}

// Flips every 1/2 player reference in a match's sets/pointLog. Used to
// normalize a match so a given player is always "player 1" before pooling
// several matches together for cross-match aggregate stats.
function swapPlayersForStats(sets, pointLog) {
  const flip = (p) => (p === 1 ? 2 : p === 2 ? 1 : p);
  const swappedSets = sets.map((set) => ({
    ...set,
    p1Games: set.p2Games,
    p2Games: set.p1Games,
    winner: flip(set.winner),
    games: set.games.map((g) => ({ ...g, server: flip(g.server), p1: g.p2, p2: g.p1, winner: flip(g.winner) })),
  }));
  const swappedLog = pointLog.map((p) => ({
    ...p,
    winnerPlayer: flip(p.winnerPlayer),
    errorPlayer: flip(p.errorPlayer),
    server: flip(p.server),
    returner: flip(p.returner),
    pointWinner: flip(p.pointWinner),
    pointLoser: flip(p.pointLoser),
    stakes: (p.stakes || []).map((st) => ({ ...st, player: flip(st.player) })),
  }));
  return { sets: swappedSets, pointLog: swappedLog };
}

/*
 * Aggregates stats for one player across many matches.
 * matchEntries: [{ sets, pointLog, player }] - player (1|2) is which slot
 * this player occupied in that particular match.
 *
 * Rather than summing each match's already-computed percentages (which is
 * statistically wrong once match sizes differ - a 100%-of-5 and a 40%-of-50
 * do not average to 70%), every match is normalized so the target player is
 * always "player 1", pooled into one combined sets/pointLog, and run through
 * the normal computeStats() a single time - so every stat (including ones
 * added later) stays correct with no separate aggregation logic to maintain.
 *
 * The pooled result's gameTrend is meaningless (set/game numbers collide
 * across different matches) - callers should replace it with
 * computeMatchTrend() for a cross-match view instead.
 */
function computeAggregateStats(matchEntries) {
  let pooledSets = [];
  let pooledPointLog = [];
  let idx = 0;
  matchEntries.forEach(({ sets, pointLog, player }) => {
    const normalized = player === 1 ? { sets, pointLog } : swapPlayersForStats(sets, pointLog);
    pooledSets = pooledSets.concat(normalized.sets);
    pooledPointLog = pooledPointLog.concat(normalized.pointLog.map((p) => ({ ...p, idx: ++idx })));
  });
  return computeStats(pooledSets, pooledPointLog, 1, null);
}

// One entry per match (not per game) - the cross-match equivalent of a
// single match's gameTrend, showing whether the player is trending up or
// down across their recorded history.
function computeMatchTrend(matchEntries) {
  return matchEntries.map(({ sets, pointLog, player }) => {
    const s = computeStats(sets, pointLog, player, null);
    return { played: s.pointsPlayed, won: s.pointsWon, wonPct: s.pointsWonPct };
  });
}

if (typeof module !== "undefined") {
  module.exports = { TennisMatch, computeStats, swapPlayersForStats, computeAggregateStats, computeMatchTrend };
}
