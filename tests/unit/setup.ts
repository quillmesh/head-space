// Minimale Browser-Umgebung für die Unit-Tests (Bun hat kein DOM).
// IndexedDB fehlt absichtlich: db.ts nutzt dann seinen Arbeitsspeicher-Fallback.
const g = globalThis as any;
g.window = g;
const store = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
};
g.document = {
  activeElement: null,
  visibilityState: 'visible',
  addEventListener: () => {},
};
g.matchMedia = () => ({ matches: false });
if (!g.navigator) g.navigator = {};

// Schnelle Unit-Tests: wenige PBKDF2-Runden und keine Wartezeit bei Wiederholungen.
// Der produktive Wert (600'000) wird in crypto.test.ts einmal echt geprüft.
const C = await import('../../src/crypto');
C.setIterationsForTests(1000);
const Sync = await import('../../src/sync');
Sync.timing.retryMs = 0;
