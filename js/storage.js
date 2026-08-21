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
