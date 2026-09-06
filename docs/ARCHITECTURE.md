# Architecture

## Data and execution flow

```text
Input / DOM editors / Gantt pointer events / imported files
                         |
                Serialized change queue
                         |
              Clone candidate workbook
                         |
            Validate project and graph -----> reject without commit
                         |
             ScheduleService request ID
                    /             \
          Module worker        Same kernel fallback
                 |                   |
       Calendar + CPM + resources    |
                    \             /
                  Calculated result
                         |
            Commit undoable model snapshot
                         |
       Render affected view; persist complete workbook
```

The source modules separate semantic scheduling data from screen geometry. Activity IDs and relationship endpoints are stable identities, independent of row order, filtering and zoom. Gantt geometry is derived from result coordinates. A bar drag issues a semantic constraint edit, not an untracked pixel translation.

## Rendering path

`RectRenderer` builds a WebGPU render pipeline with a 16-byte viewport uniform. Each rectangle instance is 48 bytes: a rectangle vector, RGBA vector and shape-parameter vector. The vertex shader emits two triangles using vertex indices. The fragment shader evaluates rounded-rectangle or diamond coverage. Visible grid/calendar bands, WBS summaries, baseline bars, activity bars and milestone diamonds use the same pipeline.

The instance buffer grows geometrically and is reused. A frame performs one instance upload and one instanced draw for its rectangle batch. DPR is capped at two. Canvas dimensions are changed only when the viewport changes. Native GPU resource loss and initialization failure switch to a Canvas 2D rectangle renderer.

A separate transparent Canvas 2D overlay handles labels, orthogonal dependency links, tooltips/selection affordances and the data-date marker. This is explicitly a hybrid renderer: text and links are not advertised as GPU batches. Scheduler calculations remain on the CPU rather than being inaccurately described as GPU scheduling.

Only the time window and visible row range are drawn. Row indices and per-activity incident-edge indexes prevent full edge scans while scrolling through a mostly offscreen project. The DOM activity table also renders only visible rows plus overscan. Selection works through stable IDs and the derived hit list. ResizeObserver and input/model changes schedule frames through requestAnimationFrame; there is no perpetual idle render loop.

Resource reports and baseline comparison grids are regular DOM views. Their tables are not all virtualized. Project/WBS rollups and full-workbook command snapshots remain possible bottlenecks at large sizes.

## Scheduling complexity

Graph ordering and descendant closure are O(V+E). Actual date arithmetic depends on the number of calendar days traversed; the kernel caches calendar-day interval definitions within each calculation. Lag inverse search is logarithmic in its bracket width, with calendar arithmetic inside evaluations. Calendar bounds prevent unbounded scans.

A small edit recomputes only its dirty forward closure, but validation, fingerprints, the backward pass, free float and resource profiles remain global. Whole-workbook cloning and structured-clone worker messages add costs outside the kernel benchmark. The accepted 100,000-activity validation limit is not a performance guarantee.

## Storage and files

Schema version 1 uses plain JSON-compatible arrays and integer civil-minute coordinates. Derived calendars, indexes, GPU objects, cached worker engines and DOM references are never serialized. Baselines persist calculated snapshots; scenarios persist independent project models. JSON backup is the lossless portable format. Activity/resource CSV and the HTML report are intentionally smaller interchange/reporting views.

The local Node server does not implement application APIs, authentication, persistence, telemetry or synchronization. It serves static files on loopback. The static app does not upload workbooks. The browser's storage, download and CSP policies still apply. A enterprise deployment would require separately designed identity, authorization, shared persistence, audit, conflict resolution and validation infrastructure.

## Build

`build.mjs` handles the narrow named-import/named-export ES-module subset used by this source tree. It preserves module scopes, bundles the worker separately, inlines CSS/SVG and boots a Blob module worker inside a single HTML file. It is not a general JavaScript transpiler or a replacement for a production bundler across arbitrary future dependencies. Both source-worker and bundled-worker calculations have executable tests.
