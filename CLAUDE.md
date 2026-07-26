# Dein-Ticket-Shop Grafana fork

This is a fork of [grafana/grafana](https://github.com/grafana/grafana) maintained by
Dein-Ticket-Shop. We carry a small, deliberately minimal set of patches on top of
upstream. This file documents *why* the fork exists, *what* we've changed, and *how*
to bring it up to date with upstream without the history exploding again.

## Remotes

- `origin` → `https://github.com/Dein-Ticket-Shop/grafana` (this fork)
- `upstream` → `https://github.com/grafana/grafana.git` (canonical Grafana)

## Branch model

- **`main`** is a pure, untouched mirror of `upstream/main`. It never carries any of
  our commits. Do not commit to it directly — always force-pull it from upstream.
- **`feat/superkiosk-and-branding-2`** (the working branch name will change over time,
  see "Naming the working branch" below) carries our patch set as a small, ordered
  stack of commits on top of `main`.

### Why rebase, not merge

We tried merging `upstream/main` into our branch in the past. It didn't work well —
once the branch falls a few thousand commits behind (easy to do with Grafana's commit
volume), a merge conflict touches so much unrelated surface area that resolving it
is nearly as much work as just reapplying our own patches from scratch, except riskier
because it's a single giant conflict resolution instead of N small, well-understood
ones.

So the policy is: **treat our changes as a small patch stack, always rebased onto a
freshly force-pulled `main`.** Never merge upstream into the working branch.

## The patch stack (as of 2026-07-26)

In order, oldest first. When rebasing, expect conflicts roughly in this order of
likelihood (locale/branding are tiny and rarely conflict; kiosk touches scene/dashboard
internals that move a lot upstream and is the most conflict-prone).

1. **`feat(dev): add automation script`** — adds `build-tag-upload.sh` at repo root.
   Builds the OSS Docker image (`make build-docker-full`), tags it as
   `rg.fr-par.scw.cloud/dein-ticket-shop/grafana-oss:beta`, and pushes it to our
   Scaleway container registry. Standalone new file, essentially never conflicts.

2. **`feat: branding`** — cosmetic-only:
   - `public/app/core/components/Branding/Branding.tsx`: `AppTitle` /
     `LoginTitle` → "Dein-Ticket.Shop Grafana".
   - `public/img/grafana_icon.svg`: replaced with our icon.
   - `BouncingLoader.tsx`: minor tweak to match.
   Low conflict risk unless upstream restructures the `Branding` class.

3. **`feat(kiosk): fullscreen kiosk panels`** — lets a single panel be shown
   fullscreen in kiosk mode (for wallboard/TV displays), with zoom-out and info
   buttons on `PanelChrome`. Touches:
   - `pkg/setting/setting.go`: **`cfg.AllowEmbedding` is hardcoded to `true`**,
     overriding the `[security] allow_embedding` ini setting entirely. This is a
     deliberate but security-relevant change (embedding is always allowed, no config
     escape hatch) — anyone rebasing or reviewing this patch should know it's
     intentional, not an accident, but should also periodically confirm it's still
     an acceptable tradeoff for the deployment.
   - `public/app/core/navigation/kiosk.ts`: new `getKioskModeFromUrl()` helper.
   - New files `PanelInfoButton.tsx`, `PanelZoomOutButton.tsx` under `PanelChrome/`.
   - `DashboardEditPaneSplitter.tsx`, `DashboardScenePage.tsx`, `DashboardControls.tsx`,
     `DashboardSceneRenderer.tsx`, `keyboardShortcuts.ts` — wiring for the above.
   Highest conflict risk of the stack — dashboard-scene internals change often
   upstream.

4. **`chore: replace ci`** / **`fix(ci): remove copy&paste error`** — replaced the
   entire upstream `.github/workflows/` (~80 files: release pipelines, e2e, backport
   bots, etc., none of which apply to us since we don't publish releases or run
   Grafana Labs' internal automation) with a single `build.yml` that builds and
   pushes our Docker image to Scaleway on `workflow_dispatch`.
   **Superseded — see "CI workflow policy" below.** Deleting the files was the wrong
   call: it means *any* upstream edit to *any* workflow file conflicts on every sync,
   because the file doesn't exist on our side at all. The fix is to keep the files
   and disable them instead of deleting them, so upstream's edits merge/rebase
   cleanly (we're not touching that content) and there's nothing to conflict with.

5. **`fix(locale): change to de`** — `public/app/app.ts`: hardcode `setLocale('de')`
   instead of `setLocale(config.regionalFormat)`. Tiny, essentially never conflicts.

## CI workflow policy

Decision: **restore upstream's `.github/workflows/*.yml` files unmodified**, and
disable the ones we don't want running via GitHub's own "disable workflow" feature
(repo Settings → Actions → Workflow → Disable, or `gh workflow disable <file>`)
rather than by editing/deleting the files.

Why this and not an in-repo edit (e.g. stripping `on:` triggers or adding `if: false`):
- Disabling via the GitHub API/UI is a repo *setting*, not a file change — it lives
  outside the git tree entirely. That means restored workflow files are byte-for-byte
  identical to upstream, so future rebases have **zero** conflict surface on them:
  git sees no diff, there's nothing to reapply per sync.
  - The tradeoff is that the disabled-state isn't version-controlled and has to be
    re-applied (once) for any *new* workflow file upstream adds. That's a much smaller
    maintenance burden than resolving conflicts on ~80 files every sync.
- Our own `build.yml` stays as an additional workflow alongside the restored (but
  disabled) upstream ones — it's a new file from upstream's point of view, so it
  never conflicts either.

Status: restoring the deleted files is a pending follow-up (not yet done as of this
writing — ask before restoring + disabling, since disabling requires `gh` calls
against the live repo). See "Next steps" below.

## Sync procedure

Run this whenever picking the fork back up (aim for at least monthly, so the gap
never grows unmanageable again):

```bash
# 1. Get latest upstream and force main to match it exactly.
git fetch upstream
git checkout main
git reset --hard upstream/main
git push origin main --force-with-lease

# 2. Create a fresh working branch off the updated main, named for the date
#    or milestone, e.g. feat/superkiosk-and-branding-3.
git checkout -b feat/superkiosk-and-branding-<n> main

# 3. Reapply the patch stack. Cherry-pick (or rebase --onto) the commits from the
#    previous working branch, in the order listed above.
git cherry-pick <automation-script> <branding> <kiosk> <ci-restore-disable> <locale>
# resolve conflicts commit-by-commit; kiosk is the one most likely to need real
# rework rather than a mechanical conflict resolution — read what changed in
# dashboard-scene upstream before blindly taking "ours".

# 4. Run the regression tests covering our changes (see "Testing" below), then
#    push and open a PR / fast-forward as appropriate.
git push origin feat/superkiosk-and-branding-<n>
```

Enable `git rerere` (`git config rerere.enabled true`) even in a rebase workflow —
it still helps when the same cherry-pick conflict shows up sync after sync (e.g. if
we ever do touch a frequently-changing upstream file).

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

- [ ] Restore deleted `.github/workflows/*.yml` files unmodified; disable the
      unwanted ones via `gh workflow disable` once pushed (see "CI workflow policy").
- [ ] Add e2e/Playwright coverage for the dashboard-scene layout patches (padding,
      footer visibility, single-panel render) — the guard tests added so far cover
      PanelChrome, the kiosk buttons, and the zoom-out wiring, but not these.
- [ ] Run the sync procedure to catch the branch up (currently several thousand
      commits behind `upstream/main`).
