# Reproducible validation

`npm test` generates the portable worker bundle and runs 52 Node tests: civil-time validation, calendar boundaries and exceptions, signed lag inversion, all four dependency types, constraints, float, retained actual progress, graph cycles, incremental/fresh equivalence, resource demand/costs, history, CSV, baseline integrity and both worker entry points.

The Pages workflow runs `tests/browser_smoke.py` on an ordinary localhost origin under `/MeridianPlan/`. This mode uses native module workers and browser storage. Its normal-origin checks include a complete reload to verify IndexedDB persistence. Renderer selection remains genuine; the report records WebGPU or Canvas 2D rather than claiming a hardware backend that was not available.

After publication, `tests/pages_smoke.py` validates the live HTTPS site in a separate, disposable browser context. It checks deployment commit metadata, asset paths, native-worker startup, incremental editing, undo/redo, cycle rejection, IndexedDB save/reload and uncaught exceptions.

The workflow artifacts `meridian-test-evidence` and `meridian-live-verification` contain the executed results and screenshots. Use the workflow run associated with the desired commit as the source of truth; a committed workflow is not itself proof that the run passed. Generated test reports and screenshots are not committed back into the source branch.

`tests/benchmark.mjs` measures isolated warm scheduler calls. Its output includes machine/runtime metadata and raw samples. It excludes worker cloning, resource analysis, persistence, DOM and rendering, so its measurements must not be described as end-to-end scheduling latency or GPU frame rate.

An optional opaque-origin browser mode loads the portable HTML into `about:blank`, explicitly substitutes an in-memory test repository, and exercises the available fallbacks. Results from that mode are not evidence of native storage or worker operation. CI and live deployment verification use ordinary origins without this substitution.
