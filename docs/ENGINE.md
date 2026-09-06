# Scheduling engine contract

This document defines Meridian Plan's implemented behavior. It is not an assertion that every choice matches Oracle Primavera P6. The matching source and executable tests are included.

## 1. Time domain and units

An absolute schedule coordinate is an integer count of **civil minutes**, carried by `Date.UTC(year, month, day, hour, minute) / 60000`. Components are interpreted as local wall-clock fields, not as a UTC instant. This representation intentionally avoids dependence on the computer's timezone and avoids accidental DST movement while adding working minutes. It does **not** compute real elapsed hours across timezone/DST transitions.

`parseDate()` accepts strict ISO civil input or a bounded integral coordinate. Numeric fields in project JSON must already contain coordinates: validation rejects an unconverted date string. Input fields are bounded to 1900–2200. Operational scan limits and the project forecast horizon are approximately 30 years. The timezone label is advisory metadata.

All duration/remaining/lag fields are integral minutes. `dayMinutes` is a UI conversion, default 480. Thus a duration of 15 displayed days is 7,200 work minutes even on a 24/7 calendar. Likewise, a lag entered as `1d` means 480 minutes in an 8-hour-display project; choosing the elapsed lag policy does not redefine `d` as 24 hours.

## 2. Working calendars and boundary conventions

A calendar contains seven recurring day definitions, Sunday first. Each definition contains sorted, non-overlapping `[start, end)` minute-of-day intervals, such as `[480,720]` and `[780,1020]`. Start is included; end is excluded for the placement of positive work. A completed work interval is allowed to finish exactly at its end. Overnight shifts must be split at midnight. An end may equal 1440.

Date exceptions replace the recurring definition for that date. An empty exception is a holiday; nonempty intervals define a working override. At least one recurring shift is required. The calendar cache contains derived day intervals only; it is not persisted as schedule data.

`add(t, positive)` snaps forward into work, consumes interval minutes and skips gaps. `add(t, negative)` traverses the reverse calendar. `add(t, 0)` preserves the exact time, which is essential for zero-lag event semantics. `between(a,b)` is the signed measure of work-interval intersections with the range. It does not count a lunch break, weekend or holiday as work.

`startUp` finds a legal working start at or after a bound. `startDown` finds a legal working start at or before a cap; a shift-end cap is represented by its preceding legal minute. Milestones use point-snapping routines that permit shift-end event points and have zero duration.

Finish-bound scheduling needs more than `add(bound,-duration)`: a nonworking gap can make that candidate finish before a finish-not-before requirement. `earliestStartForFinish` verifies the result and, when needed, advances by one working minute to reach the first feasible point on the integral lattice. `latestStartForFinish` returns the greatest legal start whose completion does not exceed a finish cap.

## 3. Precedence model

Every relationship has stable `id`, `from`, `to`, one of four types, and signed integral `lag`. Let `L(t)` be lag addition on the chosen calendar. For unstarted work, the event inequalities are:

```text
FS: S_successor >= L(F_predecessor)
SS: S_successor >= L(S_predecessor)
FF: F_successor >= L(F_predecessor)
SF: F_successor >= L(S_predecessor)
```

Lag calendar policy is one of predecessor activity calendar, successor activity calendar, project calendar, or elapsed minutes. Negative values are supported; they are not approximated using calendar days.

Validation rejects missing identities, self-links, duplicate `(from,to,type)` edges, and cycles. Different relationship types between the same pair are allowed. Kahn topological ordering is iterative and linear in vertices plus edges. A residual predecessor walk produces a concrete cycle message rather than merely reporting an unscheduled count.

## 4. Forward pass and actual progress

For unfinished work, the initial remaining-work start is the activity-calendar snap of `max(projectStart, dataDate)`. Every incoming dependency produces a candidate lower bound; finish-event bounds are converted to a feasible start using the activity's remaining duration. Start-on/after and finish-on/after constraints contribute additional lower bounds. The maximum controls the start. Completion is calendar addition of remaining minutes.

For unstarted activities, `es = remainingStart`. For in-progress activities, `es = actualStart`, while remaining work begins at `remainingStart`, which can be later. A predecessor's S event always uses its actual start when present. A successor S-event bound applies to its remaining work under this implementation's retained-logic convention. Actual starts/finishes cannot be future dates relative to the data date. A finished activity has 100 percent complete and zero remaining work.

Finished activities keep their actual start and finish and do not receive rescheduled dates. Out-of-sequence completed actuals can violate incoming event inequalities; these produce `ACTUAL_LOGIC_CONFLICT` diagnostics rather than silently changing actuals. Physical percent complete and remaining minutes are separate explicit inputs. Percent does not imply a duration reduction. The summary progress metric is original-duration-weighted physical progress, not earned value.

The forecast finish is the maximum activity finish, with project start as an empty-network lower bound. Each result contains a forward trace recording data-date/calendar, dependency and constraint bounds. Equal winning candidates can all be marked driving.

## 5. Backward pass and lag inversion

Backward initialization uses `finishBy` when provided; otherwise it uses the calculated forecast finish. Every unfinished activity is initially capped by that finish, then tightened by outgoing successor late events and upper constraint windows. All activities are traversed in reverse topological order.

A calendar lag function is monotone, but it is not a bijection: nonworking time produces plateaus, and calendar snapping creates jumps. Therefore its upper inverse is defined as:

```text
inverseLagUpper(T, lag, calendar) = max { t : addLag(t, lag, calendar) <= T }
```

The implementation uses a nearby calendar-subtraction estimate, exponentially brackets the feasible boundary and then performs an exact integer binary search. It does not assume that subtracting the lag is a complete inverse. In particular, negative-lag plateaus spanning a weekend are included in tests. For elapsed minutes and zero lag the inverse has a direct form.

A successor late S or F event becomes a predecessor event cap through this inverse. A predecessor finish cap is converted to a latest feasible start for its duration. A predecessor start cap is snapped to a legal start. Completed successors do not propagate movable remaining-work lateness; fixed actual-event conflicts are instead reported separately. An in-progress predecessor's actual S event is immutable, so outgoing SS/SF edges do not create a fictitious ability to move that actual start.

## 6. Constraints, float and diagnostics

| Code | Implemented effect |
| --- | --- |
| `none` | No activity-specific window. |
| `SNET` | Lower start bound. |
| `FNET` | Lower finish bound. |
| `SNLT` | Upper start bound in the backward pass. |
| `FNLT` | Upper finish bound in the backward pass. |
| `MSO` | Equality start window: both lower and upper bounds. |
| `MFO` | Equality finish window: both lower and upper bounds. |

Equality windows never override logic by force. An infeasible date stays logically scheduled and produces negative float and a window diagnostic. This is an intentional departure from mandatory-date behaviors in other products. A project required finish can similarly create negative float.

For unfinished activity `a` on its own calendar:

```text
startFloat = workBetween(a.remainingStart, a.ls)
finishFloat = workBetween(a.ef, a.lf)
totalFloat = min(startFloat, finishFloat)
critical = totalFloat <= 0
```

Completed activities have zero reported total/free float and are not critical. With mixed calendars, zero work slack can include nonworking wall time; minute counts should not be confused with elapsed-time distances.

Free float caps each movable activity event against its immediate successors' **early** events using the same exact lag inversion. It then measures permissible start displacement on the predecessor's working calendar. Terminal activities are capped by forecast finish. Completed-successor links are not movable bounds in this calculation. Constraints affect total float; the free-float definition remains successor/forecast-based. This is an explicit model choice, not a numerical-equivalence promise.

Diagnostics include negative float, infeasible start/finish windows, actual-logic conflicts, and informational open starts/finishes. The critical flag is float-based; it does not enumerate separate longest or near-critical paths. The inspector exposes the controlling backward clause alongside forward candidates.

## 7. Incremental recalculation and determinism

Each project engine caches its prior result and fingerprints. An unchanged global signature allows the forward pass to retain clean results and recompute changed activities plus their transitive descendants. Activity duration, remaining work, type, calendar, code, actuals or constraints invalidate that activity. Metadata-only edits can reuse all forward dates.

Calendar definitions, relationship topology/lags, project dates, display/lag policy or identity ordering invalidate the full forward pass. Validation and graph construction still run. The **entire backward pass and free-float evaluation run every time**, ensuring that horizon changes and upper bounds reach every predecessor. Resource profiles are also recalculated. Conservative global work can dominate small incremental edits.

Results are scalar records with structurally shared immutable forward explanation entries; backward traces are rebuilt without mutating previous returned results. Algorithmic output is deterministic for identical input. Runtime timing, generated IDs and snapshot creation timestamps are not deterministic. Tests compare incremental results with a fresh engine across deterministic randomized DAGs; this establishes internal equivalence, not agreement with a third-party scheduler.

## 8. Resources, baselines, scenarios and persistence

Assignment `units=1` means one full-time unit; the UI displays 100 percent. Remaining demand on a date is the intersection of the activity's remaining work with its activity-calendar shifts, multiplied by assignment units. Resource-calendar shifts multiplied by resource capacity determine available hours. Capacity may exceed one. Demand scheduled on a resource holiday is retained and reported as overload, rather than disappearing.

Budget hours use original duration and units. Remaining hours use scheduled remaining work. Actual hours are separately entered per assignment. Fixed hourly resource rates yield budget, actual and remaining costs. Daily overload is `max(0,demand-capacity)`; zero-capacity demand has infinite utilization. The weekly grid flags any overloaded day even if the weekly average appears acceptable. Resource costs do not affect scheduling, and no leveling is performed.

Baselines freeze activity IDs, original/remaining duration, progress and calculated dates. Current schedules can be compared to frozen baselines or freshly calculated scenario projects. Variance is measured in project-calendar work minutes; added and removed identities remain distinct. Scenarios contain independent project snapshots without recursively embedded scenario lists. Restoring one is a normal undoable transaction.

The worker accepts `{requestId, project, options}` and responds with `{requestId, schedule, resources}` or an error. It retains an engine per project. The UI correlates requests, serializes mutations and waits for validation plus a successful schedule before committing the model. Worker failure invokes the same kernel on the main thread.

Undo/redo uses at most 60 whole-workbook snapshots. IndexedDB persists a complete versioned workbook in one transaction; localStorage is the fallback. A failed storage write does not invalidate a valid in-memory edit, but the UI reports failure and instructs the user to export a backup. Storage is not encrypted, version history is not an audit trail, and local project navigation is not a multi-user enterprise database.
