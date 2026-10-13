/* Live score sharing.
 * The coach's device publishes compact "operations" (init / point / undo / server swap / end)
 * to a private-by-obscurity ntfy.sh topic; viewers subscribe to that topic and replay the same
 * operations through the normal scoring engine, so score, stats and the point log all come out
 * identical to the coach's screen. No data is stored on any server we run.
 */
const LiveShare = (function () {
  const RELAY = "https://ntfy.sh";
  const MAX_MSG_CHARS = 3200; // ntfy turns messages over 4096 bytes into attachments

  const SHOT_CODES = { volley: "v", smash: "s", drop: "d", slice: "l" };
  const SHOT_NAMES = { v: "volley", s: "smash", d: "drop", l: "slice" };
  const OUTCOME_CODES = { winner: "w", forced_error: "f", unforced_error: "u" };
  const OUTCOME_NAMES = { w: "winner", f: "forced_error", u: "unforced_error" };

  function newTopic() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return "tpt" + Array.from(bytes, (b) => (b % 36).toString(36)).join("");
  }

  function isValidTopic(s) {
    return typeof s === "string" && /^tpt[a-z0-9]{16}$/.test(s);
  }

  // One point -> "pointWinner,serve,ace,outcome,shots,zone,rallyBucketIdx,rallyValue"
  function encodePoint(meta) {
    const rb = meta.rallyBucket ? RALLY_BUCKET_IDS.indexOf(meta.rallyBucket) : -1;
    return [
      meta.pointWinner || "",
      meta.serveResult || "",
      meta.ace ? 1 : 0,
      OUTCOME_CODES[meta.outcome] || "",
      (meta.shots || []).map((s) => SHOT_CODES[s] || "").join(""),
      meta.zone ?? "",
      rb >= 0 ? rb : "",
      meta.rallyValue ?? "",
    ].join(",");
  }

  function decodePoint(str) {
    const [pw, sr, ace, oc, sh, zn, rb, rv] = str.split(",");
    return {
      pointWinner: pw ? +pw : null,
      serveResult: sr || null,
      ace: ace === "1",
      outcome: OUTCOME_NAMES[oc] || null,
      shots: (sh || "").split("").map((c) => SHOT_NAMES[c]).filter(Boolean),
      zone: zn ? +zn : null,
      rallyBucket: rb !== "" && rb !== undefined ? RALLY_BUCKET_IDS[+rb] : null,
      rallyValue: rv !== "" && rv !== undefined ? +rv : null,
    };
  }

  // Rebuild the original point input from a stored point-log entry (used to catch up viewers mid-match).
  function metaFromEntry(e) {
    return {
      serveResult: e.doubleFault ? "DF" : e.s2 ? "S2" : "S1",
      ace: !!e.ace,
      pointWinner: e.ace || e.doubleFault ? null : e.pointWinner,
      outcome: e.outcome,
      shots: e.shots || [],
      zone: e.zone,
      rallyBucket: e.rallyBucket,
      rallyValue: e.rallyValue,
    };
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- coach side ---------- */
  function createPublisher(topic, onStatus) {
    const epoch = Date.now();
    let n = 0;
    const queue = [];
    let sending = false, closed = false, aborted = false, sent = 0, lastError = null, backoff = 2000;

    function report() { if (onStatus) onStatus({ pending: queue.length, sent, error: lastError, closed }); }

    function enqueue(op) {
      if (closed || aborted) return;
      queue.push({ n, ops: [op] });
      n += 1;
      report();
      pump();
    }

    async function pump() {
      if (sending) return;
      sending = true;
      while (queue.length && !aborted) {
        let ops = queue[0].ops.slice();
        let taken = 1;
        while (taken < queue.length) {
          const next = ops.concat(queue[taken].ops);
          if (JSON.stringify(next).length > MAX_MSG_CHARS) break;
          ops = next;
          taken++;
        }
        const body = JSON.stringify({ e: epoch, n: queue[0].n, t: Date.now(), o: ops });
        try {
          const res = await fetch(`${RELAY}/${topic}`, { method: "POST", body });
          if (!res.ok) throw new Error("HTTP " + res.status);
          queue.splice(0, taken);
          sent++;
          lastError = null;
          backoff = 2000;
        } catch (err) {
          lastError = String((err && err.message) || err);
          report();
          await delay(backoff);
          backoff = Math.min(backoff * 2, 15000);
          continue;
        }
        report();
      }
      sending = false;
    }

    return {
      start(cfg, pointMetas) {
        enqueue("i" + JSON.stringify(cfg));
        pointMetas.forEach((m) => enqueue("p" + encodePoint(m)));
      },
      point(meta) { enqueue("p" + encodePoint(meta)); },
      undo() { enqueue("u"); },
      server(p) { enqueue("s" + p); },
      stop() { enqueue("x"); closed = true; report(); },
      abort() { aborted = true; },
    };
  }

  /* ---------- viewer side ---------- */
  // Applies operations in order, tolerating duplicates, out-of-order delivery and epoch restarts.
  function createReplayer() {
    let epoch = -1;
    let msgs = new Map();
    let next = 0;
    const rp = { match: null, cfg: null, ended: false, lastTs: 0, endTs: 0, version: 0 };

    function reset() {
      msgs = new Map();
      next = 0;
      rp.match = null; rp.cfg = null; rp.ended = false; rp.endTs = 0;
    }

    function apply(op, ts) {
      const k = op[0], rest = op.slice(1);
      if (k === "i") {
        const c = JSON.parse(rest);
        rp.cfg = c;
        rp.match = new TennisMatch({
          player1: c.p1, player2: c.p2, bestOf: c.bo, startingServer: c.ss,
          format: { gamesPerSet: c.f.g, noAd: !!c.f.a, tbAt: c.f.t, finalSetMatchTiebreak: !!c.f.m, formatId: c.f.id },
        });
        rp.match.matchStartTime = c.st;
      } else if (!rp.match) {
        return;
      } else if (k === "p") {
        if (!rp.match.isMatchOver()) {
          rp.match.addPoint(decodePoint(rest));
          if (rp.match.isMatchOver()) rp.endTs = ts;
        }
      } else if (k === "u") {
        rp.match.undo();
        if (!rp.match.isMatchOver()) rp.endTs = 0;
      } else if (k === "s") {
        rp.match.setServer(+rest);
      } else if (k === "x") {
        rp.ended = true;
      }
    }

    // returns true when the visible state changed
    rp.push = function (msg) {
      if (typeof msg.e !== "number" || typeof msg.n !== "number") return false;
      if (msg.e < epoch) return false;
      if (msg.e > epoch) { epoch = msg.e; reset(); }
      if (!msgs.has(msg.n)) msgs.set(msg.n, msg);
      let progressed = false;
      for (;;) {
        let found = null;
        for (const m of msgs.values()) {
          if (m.n <= next && m.n + m.o.length > next) { found = m; break; }
        }
        if (!found) break;
        for (let i = next - found.n; i < found.o.length; i++) {
          try { apply(found.o[i], found.t); } catch (_) { /* skip a malformed op */ }
          next++;
          progressed = true;
        }
        rp.lastTs = Math.max(rp.lastTs, found.t || 0);
      }
      if (rp.match && rp.match.isMatchOver() && rp.endTs) rp.match.matchEndTime = new Date(rp.endTs).toISOString();
      if (progressed) rp.version++;
      return progressed;
    };

    return rp;
  }

  function subscribe(topic, handlers) {
    let es = null, pollTimer = null, closed = false;
    const seen = new Set();

    function ingest(raw) {
      try {
        const o = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (o.event && o.event !== "message") return;
        if (o.id) { if (seen.has(o.id)) return; seen.add(o.id); }
        const msg = JSON.parse(o.message);
        if (msg && Array.isArray(msg.o)) handlers.onMessage(msg);
      } catch (_) { /* not one of ours */ }
    }

    async function pollOnce() {
      try {
        const res = await fetch(`${RELAY}/${topic}/json?poll=1&since=all`);
        if (!res.ok) throw new Error("HTTP " + res.status);
        (await res.text()).split("\n").filter(Boolean).forEach(ingest);
        handlers.onStatus({ connected: true });
      } catch (_) {
        handlers.onStatus({ connected: false });
      }
    }
    // ntfy's cache can lag a moment behind a publish, so a slow poll runs alongside the live
    // stream as a safety net (duplicates are dropped by message id); it speeds up if the stream drops.
    function setPollEvery(ms) {
      if (closed) return;
      clearInterval(pollTimer);
      pollTimer = setInterval(pollOnce, ms);
    }
    function startPoll() { pollOnce(); setPollEvery(5000); }

    if (typeof EventSource === "undefined") {
      startPoll();
    } else {
      es = new EventSource(`${RELAY}/${topic}/sse?since=all`);
      es.onopen = () => { setPollEvery(15000); handlers.onStatus({ connected: true }); };
      es.onmessage = (ev) => ingest(ev.data);
      es.onerror = () => { handlers.onStatus({ connected: false }); startPoll(); };
      setPollEvery(15000);
      setTimeout(pollOnce, 3000);
    }

    return { close() { closed = true; clearInterval(pollTimer); if (es) es.close(); } };
  }

  return { newTopic, isValidTopic, encodePoint, decodePoint, metaFromEntry, createPublisher, createReplayer, subscribe };
})();
