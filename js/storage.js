/* localStorage veri katmanı */
const STORAGE_KEY = "tenisTracker.matches.v1";

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
