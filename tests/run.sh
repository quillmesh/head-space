#!/usr/bin/env bash
# Alle Tests: Typen, Unit-Tests (bun test), End-to-End-Tests (Playwright Test, Ordner e2e/).
# Aufruf: tests/run.sh                         → alles
#         tests/run.sh --nur-e2e               → nur End-to-End (auf GitHub laufen Typen/Unit separat)
#         tests/run.sh projekte sync           → Typen, Unit und nur e2e/projekte… und e2e/sync…
#                                                (für kleine Änderungen lokal; GitHub prüft immer alles)
# Weitere Optionen werden an Playwright weitergegeben, z. B. tests/run.sh -g "Papierkorb".
# Playwright: lokal installiert (node_modules/playwright) oder PLAYWRIGHT_MODULE zeigt auf das Modul.
# Die Website wird automatisch gebaut und auf Port 4173 bereitgestellt (playwright.config.mjs).
set -euo pipefail
cd "$(dirname "$0")/.."
NUR_E2E=0
if [ "${1:-}" = "--nur-e2e" ]; then NUR_E2E=1; shift; fi
if [ $NUR_E2E -eq 0 ]; then
  echo "== Typen"; (command -v tsc >/dev/null && tsc -p .) || bunx -p typescript@5.8.3 tsc -p .
  echo "== Unit-Tests"; bun test
fi

# Playwright aus PLAYWRIGHT_MODULE verfügbar machen, wenn es nicht im Projekt installiert ist
if [ ! -e node_modules/playwright ] && [ -n "${PLAYWRIGHT_MODULE:-}" ]; then
  mkdir -p node_modules && ln -s "$(dirname "$PLAYWRIGHT_MODULE")" node_modules/playwright
fi

echo "== End-to-End"
ARGS=()
for a in "$@"; do
  if [[ "$a" != -* ]] && [ -f "e2e/$a.spec.mjs" ]; then ARGS+=("e2e/$a.spec.mjs"); else ARGS+=("$a"); fi
done
node node_modules/playwright/cli.js test ${ARGS[@]+"${ARGS[@]}"}
echo "ALLE TESTS BESTANDEN"
