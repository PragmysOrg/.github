# Automatic version bump

Adds 1 to the third number (`x.y.Z`) of a product's version files when a merge lands on
`main`. Tracked in PragmysOrg/pragmys-backend#162. **Dry run only for now.**

## Use it from a repo

```yaml
# .github/workflows/version-bump.yml
name: version-bump
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }   # shows the would-be version on release PRs
  workflow_dispatch:
permissions:
  contents: read
jobs:
  bump:
    uses: PragmysOrg/.github/.github/workflows/bump-version.yml@main
    with:
      files: package.json manifest.json   # or: VERSION
      dry_run: true
```

`files` are JSON files with a top-level `"version"` or a plain `VERSION` file. If they
disagree the job fails and nothing is changed.

## The "already ahead" guard

The bump never raises a version that something else already raised. Before bumping, the
script compares the version files in the checkout with the same files at the remote's
previous state (`--against <ref>`: the parent commit of a push, the base branch of a PR):

| working tree vs remote | result |
|---|---|
| equal | bump (+1 on the third number) |
| **ahead** (someone bumped by hand) | **no bump**, reported as "already ahead" |
| behind (stale checkout) | refused, nothing written |
| file new at the remote (first `VERSION` file) | no bump, reported as "new" |

Registry checks stay with each product's own release gate (Compass publishes only a version
npm does not have yet; the extension skips a version whose tag already exists).

## Dry run vs applying

`dry_run: true` (default) prints `file: old -> new` in the job summary and changes
nothing. It never commits, tags, pushes, publishes or submits to a store. Applying
(`dry_run: false`) also needs `contents: write` granted by the caller and is not enabled in
any repo. Before switching a repo on, settle how its release workflow orders against the
bump (Compass publishes to npm and the extension submits to the stores on every push to
`main`).

## Run it locally

```bash
node scripts/bump-version.mjs --dry-run --against origin/main package.json manifest.json
node --test scripts/bump-version.test.mjs
```
