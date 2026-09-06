# Meridian Plan

[![Test and deploy](https://github.com/wieslawsoltes/MeridianPlan/actions/workflows/pages.yml/badge.svg)](https://github.com/wieslawsoltes/MeridianPlan/actions/workflows/pages.yml)

**[Open Meridian Plan](https://wieslawsoltes.github.io/MeridianPlan/)** · [Portable HTML](https://wieslawsoltes.github.io/MeridianPlan/meridian-plan.html) · [Scheduling semantics](docs/ENGINE.md) · [Architecture](docs/ARCHITECTURE.md)

An independent, P6-inspired project-controls application with an actual calendar-aware scheduling engine, editable activity tables, a virtualized WebGPU Gantt, resource analysis, baselines and scenarios. Plain HTML, CSS and JavaScript. No runtime packages, external fonts, CDN libraries or account requirements.

![Meridian Plan activity workspace](https://wieslawsoltes.github.io/MeridianPlan/docs/activity-preview.png)

## Run locally

Node.js 20 or newer is required for the development server and tests. No package installation is necessary to run the app.

```sh
git clone https://github.com/wieslawsoltes/MeridianPlan.git
cd MeridianPlan
npm start
```

Open http://localhost:4173. The server binds to loopback only. A compatible secure browser context and available adapter activate WebGPU; otherwise the real Canvas 2D renderer is used. The status bar reports the actual backend.

## Features

- Enterprise-style project navigation; hierarchical WBS; stable activity identities; scope/search/critical filters; inline table editing and a resizable table/Gantt split.
- Calendar-aware forward/backward scheduling; FS, SS, FF and SF dependencies; positive/negative lags; milestones; date constraints; total/free float; critical highlighting; concrete cycle diagnostics and explainable calculation traces.
- Weekly shifts, split days, holidays and date overrides; retained-logic actual progress; separate original/remaining duration and physical progress.
- Interactive Gantt move/resize/link editing; baseline overlays; virtualized table rows/timeline; incident-edge culling; hybrid GPU geometry and Canvas text/links.
- Resource pools, assignments, explicit actual hours, daily capacity/demand, overload detection, weekly utilization and hourly-rate costs. No silent resource leveling.
- Immutable baselines, independent scenario snapshots, calculated comparisons, transactional undo/redo and versioned IndexedDB persistence with a localStorage fallback.
- JSON workbook/project import/export; CSV append/merge/replace; resource-demand CSV; self-contained printable HTML reports.

The demo contains three independent projects. Northline Transit Hub has 31 activities and 39 relationships. Its schedule is calculated from the model, not a hardcoded Gantt image.

## Editing

Double-click activity names, codes or durations to edit them. Drag a Gantt bar to apply a start-on-or-after constraint; drag its right edge to change remaining duration; Shift-drag between bars to create an FS dependency. Actual completed dates cannot be dragged. Use the inspector for relationships, assignments, progress and calculation explanations.

F9 forces a complete schedule pass. Ctrl/Command-S saves locally. Ctrl/Command-Z and Shift-Z undo/redo. Ctrl/Command-K searches. Insert adds an activity. JSON export is the lossless backup format.

## Build and tests

```sh
npm test                 # builds the worker bundle, then runs 52 Node tests
npm run build            # dist/meridian-plan.html and dist/worker.bundle.js
npm run build:pages      # complete static deployment in _site/
node tests/benchmark.mjs # isolated scheduler benchmarks, not GPU frame-rate claims
```

Browser tooling is development-only:

```sh
python -m pip install playwright==1.55.0
python -m playwright install --with-deps chromium
# With npm start running in another terminal:
MERIDIAN_URL=http://localhost:4173/ python tests/browser_smoke.py
MERIDIAN_URL=http://localhost:4173/ python tests/capture_previews.py
```

`CHROMIUM_PATH` optionally selects an existing Chromium executable. Normal-origin browser tests use native workers and storage; the separately supported opaque-origin portable test mode explicitly substitutes an in-memory repository and exercises available fallbacks. Actual rendering backend and storage mode are recorded in the test report. Software-browser results are not claims of physical-GPU performance.

## GitHub Pages deployment

`.github/workflows/pages.yml` runs on pushes to `main`, pull requests, and manual dispatch. It runs the scheduling/worker tests, builds the static site, and exercises the real browser workflow under `/MeridianPlan/` before uploading the Pages artifact. Only `main` deploys. The deployment job verifies the live HTTPS application, worker assets, incremental editing, cycle rejection, undo/redo and IndexedDB persistence across reloads.

`deployment.json` records the published commit. Test logs and screenshots are retained as workflow artifacts; current browser screenshots and the test report are included in the published documentation folder. Build output is not committed back into the source branch. Runtime assets use relative paths, so both the repository subpath and a domain root work.

## Engine boundaries

Dates are integer project-local **civil minutes**, not elapsed-time DST conversions. The timezone is reference metadata. Displayed days use the explicit project minutes-per-day conversion; activity calendars control working-time arithmetic. Incremental edits recompute the dirty forward closure, but validation, backward scheduling, float and resource profiles remain global.

This is an independent implementation, not Oracle software or complete P6 numerical/file-format compatibility. There is no XER/XML interchange, cross-project dependency scheduling, automatic resource leveling, enterprise server, shared database, authentication or collaborative conflict resolution. Equality constraints preserve dependency logic and report infeasibility instead of forcing contradictory dates. See [ENGINE.md](docs/ENGINE.md) for the complete implemented contract.

Workbooks remain in browser storage until explicitly exported. GitHub Pages serves the static application; it does not store or synchronize project data. Keep JSON backups of important work.

## Source layout

```text
src/core/calendar.js     Civil-time and calendar arithmetic
src/core/model.js        Schema, graph validation, identities and history
src/core/scheduler.js    CPM, float, traces, baselines and comparisons
src/core/resources.js    Time-phased resource/cost analysis
src/core/storage.js      Browser persistence and CSV codec
src/core/sample.js       Computed demonstration projects
src/worker.js            Worker scheduling protocol
src/ui/gantt.js          WebGPU/Canvas renderer and pointer editing
src/ui/icons.js          Inline vector icons
src/app.js               Workspace, transactional editors and reports
tests/                   Kernel, worker, browser, deployment and benchmark tests
scripts/build-pages.mjs  Static publication staging
```

## License

[MIT](LICENSE). Oracle and Primavera are trademarks of their respective owners. Meridian Plan is not affiliated with or endorsed by Oracle.
