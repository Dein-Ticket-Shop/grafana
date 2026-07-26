# Dein-Ticket-Shop Grafana fork

This is a fork of [grafana/grafana](https://github.com/grafana/grafana) maintained by
Dein-Ticket-Shop. We carry a small, deliberately minimal set of patches on top of an
upstream **release tag** (not `main`). This file documents *why* the fork exists,
*what* we've changed, and *how* to bring it up to date without the history exploding
again. `CLAUDE.md` pulls in both this file and upstream's own `AGENTS.md`.

## Remotes

- `origin` → `https://github.com/Dein-Ticket-Shop/grafana` (this fork)
- `upstream` → `https://github.com/grafana/grafana.git` (canonical Grafana)

## Branch model

- **`main`** tracks the latest stable upstream release **tag** (currently `v13.1.1`,
  released 2026-07-20) — not `upstream/main`. It never carries any of our commits;
  always force-pull it to whatever the new latest release tag is.
- **`feat/superkiosk-and-branding-<n>`** carries our patch set as a small, ordered
  stack of commits on top of `main`. The `<n>` increments each time the stack is
  rebuilt on a new base (current: `feat/superkiosk-and-branding-3`, built on
  `v13.1.1`).

### Why a release tag, not `main`

`upstream/main` is Grafana's unstable dev trunk — code nobody has actually shipped or
tested as a release. Release tags (`vX.Y.Z`) are **not on `main`'s line at all**;
Grafana cuts a `release-X.Y.Z` branch and backports fixes onto it independently. A
self-hosted production deployment should run what everyone else running Grafana
runs: an officially tagged release. Bonus: since the fork now starts fresh from a
release tag instead of an old point on `main`, upstream's own files (including its
`.github/workflows/*.yml`) are still present and untouched — no need to carry a
"restore deleted files" step (see "CI workflow policy" below).

### Why rebase (cherry-pick onto a fresh base), not merge

We tried merging `upstream/main` into our branch in the past. It didn't work well —
once the branch falls a few thousand commits behind (easy to do with Grafana's commit
volume), a merge conflict touches so much unrelated surface area that resolving it
is nearly as much work as just reapplying our own patches from scratch, except riskier
because it's a single giant conflict resolution instead of N small, well-understood
ones.

So the policy is: **treat our changes as a small patch stack, always cherry-picked
onto a freshly force-pulled `main`.** Never merge upstream into the working branch.

## The patch stack (as of 2026-07-26, rebuilt on v13.1.1)

In order, oldest first. When rebasing onto a new release tag, expect conflicts
roughly in this order of likelihood (locale/branding are tiny and rarely conflict;
kiosk touches scene/dashboard internals that move a lot upstream and is the most
conflict-prone — see notes below on what changed between our old base and v13.1.1).

1. **`feat(dev): add automation script`** — adds `build-tag-upload.sh` at repo root.
   Builds the OSS Docker image (`make build-docker-full`), tags it with the current
   Grafana version, and pushes it to our Scaleway container registry. Standalone new
   file, essentially never conflicts.

2. **`feat: branding`** — cosmetic-only:
   - `public/app/core/components/Branding/Branding.tsx`: `AppTitle` /
     `LoginTitle` → "Dein-Ticket.Shop Grafana".
   - `public/img/grafana_icon.svg`: replaced with our icon.
   - `BouncingLoader.tsx`: minor tweak to match.
   Low conflict risk unless upstream restructures the `Branding` class.

3. **`fix(locale): change to de`** — `public/app/app.ts`: hardcode `setLocale('de')`.
   Upstream had changed the call site from `setLocale(config.regionalFormat)` to
   `setLocale(contextSrv.user.language)` between our old base and v13.1.1 — trivial
   one-line re-resolution, no real conflict.

4. **`feat(kiosk): fullscreen kiosk panels`** — lets a single panel be shown
   fullscreen in kiosk mode (for wallboard/TV displays), with zoom-out and info
   buttons on `PanelChrome`. Touches:
   - `pkg/setting/setting.go`: **`cfg.AllowEmbedding` is hardcoded to `true`**,
     overriding the `[security] allow_embedding` ini setting entirely. This is a
     deliberate but security-relevant change (embedding is always allowed, no config
     escape hatch) — anyone rebasing or reviewing this patch should know it's
     intentional, not an accident, but should also periodically confirm it's still
     an acceptable tradeoff for the deployment.
   - `public/app/core/navigation/kiosk.ts`: `getKioskModeFromUrl()` helper.
     **Upstream deleted this exact file as unused** (`knip` cleanup, June 2026) —
     it now derives kiosk mode from a central `chrome.useState().kioskMode`
     (`AppChromeService`) instead of re-parsing the URL per-component. We restored
     our own version of the file rather than adopting that pattern, because:
     - `PanelChrome.tsx` lives in `packages/grafana-ui`, a lower-level package with
       no access to the app-level `AppChromeService`/`useGrafana()` context, so it
       needs its own URL-based check regardless.
     - `DashboardControls.tsx` *does* now have `chrome.useState().kioskMode`
       available and already uses it for narrower checks (hiding edit/share buttons,
       gating the new-layouts button bar) — our blanket
       `if (getKioskModeFromUrl()) return <></>;` early-return still sits above that,
       preserving the original "hide everything" intent. Worth a future look: could
       likely switch `DashboardControls`/`DashboardEditPaneSplitter`/
       `DashboardSceneRenderer`/`DashboardScenePage` to read `chrome.useState().kioskMode`
       instead of re-deriving from the URL, to lean on upstream's now-canonical
       source of truth and shrink our diff — not done yet, flagged as a follow-up.
   - New files `PanelInfoButton.tsx`, `PanelZoomOutButton.tsx` under `PanelChrome/`.
   - `DashboardEditPaneSplitter.tsx`, `DashboardScenePage.tsx`, `DashboardControls.tsx`,
     `DashboardSceneRenderer.tsx`, `keyboardShortcuts.ts` — wiring for the above.
   Highest conflict risk of the stack — dashboard-scene internals change often
   upstream. On the v13.1.1 rebase this needed three manual conflict resolutions
   (import-block merges in `DashboardEditPaneSplitter.tsx` and `DashboardControls.tsx`,
   plus re-adding the modify/delete-conflicted `kiosk.ts`) but no logic rewrites.

5. **`feat(ci): version Docker image tags from the Grafana release`** — adds
   `.github/workflows/build.yml` (Docker build/push to Scaleway on
   `workflow_dispatch`) and fixes `build-tag-upload.sh`. Both now derive `VERSION`
   from `package.json` (which tracks the release we're built on) instead of a
   hardcoded `dev`/`beta` string, and tag images accordingly (plus a floating
   `:latest` tag in the GitHub Actions build). This replaces the old
   `chore: replace ci` / `fix(ci): remove copy&paste error` commits, which used to
   *delete* the entire upstream `.github/workflows/` directory — see "CI workflow
   policy" below for why that approach was dropped.

6. **`test: add regression guards for fork-specific patches`** — see "Testing" below.

## CI workflow policy

Decision: **leave upstream's `.github/workflows/*.yml` files untouched**, and
disable the ones we don't want running via GitHub's own "disable workflow" feature
(repo Settings → Actions → Workflow → Disable, or `gh workflow disable <file>`)
rather than by editing/deleting the files. Because the fork is now rebuilt fresh from
a release tag each time instead of accumulating a `main`-line history, this requires
no "restore deleted files" step — the files were simply never deleted.

Why this and not an in-repo edit (e.g. stripping `on:` triggers or adding `if: false`):
- Disabling via the GitHub API/UI is a repo *setting*, not a file change — it lives
  outside the git tree entirely. That means the workflow files stay byte-for-byte
  identical to upstream, so future rebases have **zero** conflict surface on them.
  - The tradeoff is that the disabled-state isn't version-controlled and has to be
    re-applied (once) for any *new* workflow file upstream adds in a later release.
    Much smaller maintenance burden than resolving conflicts on ~90 files every sync.
- Our own `build.yml` stays as an additional workflow alongside the (disabled)
  upstream ones — it's a new file from upstream's point of view, so it never
  conflicts either.

Status: `build.yml` exists; **disabling the unwanted upstream workflows via
`gh workflow disable` is still pending** — that's a live-repo settings change (needs
a push first, and touches GitHub Actions state), not done as part of this pass. See
"Next steps".

## Sync procedure

Run this whenever picking the fork back up (aim for at least monthly, so the gap
never grows unmanageable again):

```bash
# 1. Find the latest stable release tag (skip -beta/-preview/-rc/+security-only tags
#    unless you specifically want a security patch release).
git fetch upstream --tags
git tag -l 'v*.*.*' | grep -vE '\-(beta|test|preview|rc)' | sort -V | tail -5

# 2. Force main to that tag exactly.
git branch -f main <tag>          # e.g. v13.2.0
git push origin main --force-with-lease

# 3. Create a fresh working branch off the updated main, incrementing <n>.
git checkout -b feat/superkiosk-and-branding-<n> main

# 4. Reapply the patch stack in the order listed above. Cherry-pick each commit
#    individually (not as a range) so conflicts are attributable to one patch at a
#    time:
git cherry-pick <automation-script>
git cherry-pick <branding>
git cherry-pick <locale>
git cherry-pick <kiosk>            # expect the most conflicts here - read what
                                    # changed in dashboard-scene/PanelChrome upstream
                                    # before resolving, don't blindly take "ours"
git cherry-pick <ci-versioning>
git cherry-pick <tests>
git cherry-pick <this-doc>         # FORK.md itself; CLAUDE.md is just an @-include,
                                    # resolve any add/add conflict on CLAUDE.md by
                                    # keeping "@AGENTS.md" + "@FORK.md" as two lines

# 5. Run the regression tests (see "Testing"), then push.
git push origin feat/superkiosk-and-branding-<n>
```

Enable `git rerere` (`git config rerere.enabled true`) even in a cherry-pick
workflow — it still helps when the same conflict shows up sync after sync.

**Note on `CLAUDE.md`**: upstream ships its own `CLAUDE.md` (just `@AGENTS.md`, a
pointer to their `AGENTS.md`). Don't overwrite it — keep it as a two-line file with
`@AGENTS.md` and `@FORK.md`, and put all fork-specific documentation in `FORK.md`
(this file) instead. That keeps our docs out of the only file upstream also owns.

## Testing

Each patch that has a meaningful behavioral surface has a guard test — run these
after every rebase (see "Sync procedure") to know immediately whether a patch was
lost or silently changed by conflict resolution, rather than discovering it in
production:

- **Branding** — `public/app/core/components/Branding/Branding.test.ts`: asserts
  `Branding.AppTitle` / `Branding.LoginTitle` are the Dein-Ticket-Shop strings.
- **Locale** — `public/app/app.test.ts`: asserts `app.ts` still calls
  `setLocale('de')`. `GrafanaApp.init()` pulls in the whole app bootstrap chain, so
  this is a source-content check rather than a behavioral one — good enough to catch
  the patch being dropped on rebase, not a substitute for manual verification that
  the UI actually renders in German.
- **Kiosk** — `public/app/core/navigation/kiosk.test.ts`: covers `getKioskMode` and
  the fork-added `getKioskModeFromUrl()`.
- **AllowEmbedding** — `pkg/setting/setting_test.go` (`TestAllowEmbeddingAlwaysEnabled`):
  builds a `Cfg` with `allow_embedding = false` in ini and asserts
  `cfg.AllowEmbedding` is still `true`, proving the hardcode survives.
- **Kiosk PanelChrome integration** — `packages/grafana-ui/.../PanelChrome.kiosk.test.tsx`:
  asserts the regular panel menu is hidden and the kiosk info/zoom-out buttons appear
  when `?kiosk=1` is in the URL. Deliberately a *new* file rather than an addition to
  upstream's own `PanelChrome.test.tsx`, so upstream edits to that file never conflict
  with ours.
- **Kiosk buttons** — `PanelZoomOutButton.test.tsx` / `PanelInfoButton.test.tsx`:
  cover the two new fork-added components directly (click handling, `onZoomOut` /
  `window.kioskZoomOut` fallback).
- **Kiosk zoom-out wiring** — `keyboardShortcuts.kiosk.test.ts` (new file, same
  reasoning as PanelChrome above): asserts `window.kioskZoomOut` is exposed by
  `setupKeyboardShortcuts` and drives the same `dashboardSceneGraph.getTimePicker(...).onZoom()`
  path as the built-in zoom-out shortcuts.
- **Not covered**: the dashboard-scene layout patches (`DashboardEditPaneSplitter`,
  `DashboardControls`, `DashboardSceneRenderer`, `DashboardScenePage` — padding/footer/
  single-panel-render changes for kiosk mode). These are deeply coupled to the scene
  graph and better suited to a Playwright/e2e check than a unit test — still a
  follow-up.
- **CI**: not unit-testable, but worth a checklist item post-sync: confirm
  `build.yml` still runs and any newly-added upstream workflows are set to disabled.

Run them with:
```bash
yarn jest public/app/core/components/Branding/Branding.test.ts public/app/core/navigation/kiosk.test.ts public/app/app.test.ts \
  packages/grafana-ui/src/components/PanelChrome/PanelZoomOutButton.test.tsx \
  packages/grafana-ui/src/components/PanelChrome/PanelInfoButton.test.tsx \
  packages/grafana-ui/src/components/PanelChrome/PanelChrome.kiosk.test.tsx \
  public/app/features/dashboard-scene/scene/keyboardShortcuts.kiosk.test.ts
go test ./pkg/setting/... -run TestAllowEmbeddingAlwaysEnabled -v
```

## Next steps (not yet done)

- [ ] Disable the unwanted upstream workflows via `gh workflow disable` once this
      branch is pushed (see "CI workflow policy").
- [ ] Consider switching the dashboard-scene kiosk checks (`DashboardControls`,
      `DashboardEditPaneSplitter`, `DashboardSceneRenderer`, `DashboardScenePage`) to
      read `chrome.useState().kioskMode` instead of `getKioskModeFromUrl()`, now that
      upstream has that as a first-class, centrally-computed value (see patch #4
      notes above). Would shrink our diff and conflict surface further.
- [ ] Add e2e/Playwright coverage for the dashboard-scene layout patches (padding,
      footer visibility, single-panel render) — the guard tests added so far cover
      PanelChrome, the kiosk buttons, and the zoom-out wiring, but not these.
