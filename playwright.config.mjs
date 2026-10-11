// End-to-End-Tests mit dem Standard-Runner „Playwright Test“ (im Paket playwright enthalten).
// Lokal:   tests/run.sh            (baut, startet den Server, führt alles aus)
//          npx playwright test e2e/projekte.spec.mjs   (einzelne Datei; Server startet automatisch)
// GitHub:  zusätzlich WebKit (Safari-Kern) für die mit @webkit markierten Tests (E2E_WEBKIT=1).
//
// Bei einem Fehler legt Playwright einen Trace ab (test-results/…/trace.zip): Schritt für Schritt
// mit DOM, Netzwerk und Screenshots. Ansehen mit  npx playwright show-trace <datei>
// oder auf https://trace.playwright.dev (Datei hineinziehen; bleibt im Browser).
import { defineConfig } from 'playwright/test';
import { cpus } from 'node:os';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  // So viele gleichzeitig wie Prozessorkerne (mindestens 2); GitHub-Runner haben 4. E2E_WORKERS überschreibt.
  workers: Number(process.env.E2E_WORKERS) || Math.max(2, cpus().length),
  // Auf GitHub ein zweiter Versuch; ein Test, der erst dann besteht, wird als „flaky“ gemeldet
  retries: CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: CI ? [['list'], ['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'scripts/build-site.sh >/dev/null && exec python3 -m http.server 4173 --directory site',
    url: 'http://localhost:4173/',
    reuseExistingServer: !CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    ...(process.env.E2E_WEBKIT === '1' ? [{ name: 'webkit', use: { browserName: 'webkit' }, grep: /@webkit/ }] : []),
  ],
});
