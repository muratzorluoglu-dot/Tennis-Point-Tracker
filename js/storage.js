/* localStorage veri katmanı */
const STORAGE_KEY = "tenisTracker.matches.v1";
const PLAYERS_KEY = "tenisTracker.players.v1";

const Storage = {
  loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("Maçlar okunamadı", e);
      return [];
    }
  },

  saveAll(matches) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(matches));
    Cloud.schedulePush();
  },

  upsert(matchRecord) {
    const all = this.loadAll();
    const i = all.findIndex(m => m.id === matchRecord.id);
    if (i >= 0) all[i] = matchRecord; else all.unshift(matchRecord);
    this.saveAll(all);
  },

  remove(id) {
    const all = this.loadAll().filter(m => m.id !== id);
    this.saveAll(all);
  },

  get(id) {
    return this.loadAll().find(m => m.id === id) || null;
  },
};

/* Player roster: coach's own tracked players + opponents, shared across matches. */
const Players = {
  loadAll() {
    try {
      const raw = localStorage.getItem(PLAYERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("Oyuncular okunamadı", e);
      return [];
    }
  },

  saveAll(players) {
    localStorage.setItem(PLAYERS_KEY, JSON.stringify(players));
    Cloud.schedulePush();
  },

  upsert(player) {
    const all = this.loadAll();
    const i = all.findIndex(p => p.id === player.id);
    if (i >= 0) all[i] = player; else all.unshift(player);
    this.saveAll(all);
    return player;
  },

  remove(id) {
    const all = this.loadAll().filter(p => p.id !== id);
    this.saveAll(all);
  },

  get(id) {
    return this.loadAll().find(p => p.id === id) || null;
  },

  // Finds an existing player by exact (case/whitespace-insensitive) name
  // match, or creates one - used both for quick-add during match setup and
  // for migrating older matches that only stored free-text names.
  findOrCreateByName(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const all = this.loadAll();
    const existing = all.find(p => p.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    const player = { id: (crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(36).slice(2)}`), name: trimmed, createdAt: new Date().toISOString() };
    this.upsert(player);
    return player;
  },
};

/* Mirrors matches + players into the Artifacts `db` store when the page runs
   inside a Claude artifact (where localStorage can be wiped). Everywhere else
   (GitHub Pages, installed PWA) claude.use is absent and this stays inert. */
const Cloud = {
  col: null,
  ready: false,
  remote: new Map(),
  timer: null,
  pushing: false,
  dirty: false,
  onRestored: null,

  docId(kind, id) {
    return (kind === "match" ? "m-" : "p-") + String(id).replace(/[^A-Za-z0-9_\-.~:@+]/g, "_");
  },

  async init() {
    try {
      if (!window.claude || !window.claude.use) return;
      const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
      if (!db || !user) return;
      const uid = await user.id();
      if (!uid) return;
      this.col = db.collection("data/users/" + uid);

      const snap = await this.col.get();
      const matches = Storage.loadAll();
      const players = Players.loadAll();
      const mIds = new Set(matches.map(m => m.id));
      const pIds = new Set(players.map(p => p.id));
      let changed = false;
      snap.docs.forEach(d => {
        const data = d.data();
        if (!data || !data.rec) return;
        this.remote.set(d.id, JSON.stringify(data.rec));
        if (data.kind === "match" && !mIds.has(data.rec.id)) { matches.push(data.rec); changed = true; }
        else if (data.kind === "player" && !pIds.has(data.rec.id)) { players.push(data.rec); changed = true; }
      });
      if (changed) {
        matches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(matches));
        localStorage.setItem(PLAYERS_KEY, JSON.stringify(players));
      }
      this.ready = true;
      this.schedulePush();
      if (changed && this.onRestored) this.onRestored();
    } catch (e) {
      console.error("Cloud restore failed", e);
    }
  },

  schedulePush() {
    if (!this.ready) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), 800);
  },

  async push() {
    if (this.pushing) { this.dirty = true; return; }
    this.pushing = true;
    try {
      const local = new Map();
      Storage.loadAll().forEach(m => local.set(this.docId("match", m.id), { kind: "match", rec: m }));
      Players.loadAll().forEach(p => local.set(this.docId("player", p.id), { kind: "player", rec: p }));
      for (const [id, body] of local) {
        const s = JSON.stringify(body.rec);
        if (this.remote.get(id) === s) continue;
        try { await this.col.doc(id).set(body); this.remote.set(id, s); }
        catch (e) { console.error("Cloud save failed", id, e); }
      }
      for (const id of [...this.remote.keys()]) {
        if (local.has(id)) continue;
        try { await this.col.doc(id).delete(); this.remote.delete(id); }
        catch (e) { console.error("Cloud delete failed", id, e); }
      }
    } finally {
      this.pushing = false;
      if (this.dirty) { this.dirty = false; this.schedulePush(); }
    }
  },
};
