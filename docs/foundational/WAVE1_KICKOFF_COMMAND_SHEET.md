# Wave 1 Kickoff Command Sheet

Historical status: frozen for Wave 1 closeout. Do not reuse for Wave 2+ dispatch. Use `docs/foundational/WAVE2_KICKOFF_COMMAND_SHEET.md` for active execution.

Companion to:
- `docs/foundational/V2_Sprint_Staffing_Plan.md`
- `docs/foundational/V2_Sprint_Staffing_Roles.md`

Use this for day-0 Wave 1 launch, canary validation, and integration cadence.

## Branch model (important)

- `agent/*` is a parked context branch only.
- `team-a/*`..`team-e/*` and `coord/*` are execution branches.
- Coding, push, and PR are execution-branch activities only.

## 0) One-time bootstrap (per worktree / agent)

```bash
pnpm install --frozen-lockfile
pnpm hooks:install

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" =~ ^agent/.+ ]]; then
  echo "Parked branch detected: $branch"
  echo "Switch to execution branch before task work (see section 0.5)."
else
  [[ "$branch" =~ ^(team-[a-e]/.+|coord/.+|integration/wave-[0-9]+|main)$ ]] \
    || { echo "Invalid branch: $branch"; exit 1; }
fi
```

## 0.5) Task-start branch transition (parked -> execution)

```bash
# Example for Team A; substitute team letter and ticket slug.
git fetch origin
git switch -c team-a/<ticket>-<slug> origin/integration/wave-1

# Re-check ownership scope locally before first push
node tools/scripts/check-ownership-scope.mjs
```

## 1) Coordinator: verify integration branch + protections

```bash
# Ensure integration branch exists on remote

git fetch origin
if ! git ls-remote --exit-code --heads origin integration/wave-1 >/dev/null; then
  git checkout main
  git pull --ff-only origin main
  git checkout -b integration/wave-1
  git push -u origin integration/wave-1
fi

# Inspect branch protection + required checks (GitHub)
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
gh api "repos/$REPO/branches/integration/wave-1/protection" \
  --jq '{enforce_admins: .enforce_admins.enabled, required: [.required_status_checks.checks[].context]}'
```

Expected required checks include:
- `Ownership Scope`
- `Quality Guard`
- `Test & Build`
- `E2E Tests`
- `Bundle Size`

## 2) Chief canary slice (recommended: Team A A-1)

```bash
# Start canary branch

git fetch origin
git checkout -b team-a/A-1-schemas origin/integration/wave-1

# Implement smallest contract-safe slice, then run local gates
pnpm typecheck
pnpm lint
pnpm test:quick
pnpm test:coverage

# Local ownership gate (same logic as CI)
node tools/scripts/check-ownership-scope.mjs

# Prepare PR body from template and fill checklist items before create
cp .github/pull_request_template.md /tmp/w1-pr-body.md
"${EDITOR:-vi}" /tmp/w1-pr-body.md

# Push and open PR to integration branch
git push -u origin team-a/A-1-schemas
PR_URL=$(gh pr create \
  --base integration/wave-1 \
  --head team-a/A-1-schemas \
  --title "A-1: add synthesis schema contracts" \
  --body-file /tmp/w1-pr-body.md)
PR_NUM=$(echo "$PR_URL" | sed -E 's#.*/pull/([0-9]+).*#\1#')

# Set auto-merge via merge queue
gh pr merge "$PR_NUM" --merge --auto
```

## 3) Chief merge gate for each PR

With merge queue enabled, PRs should already have auto-merge set at creation time. Chief validates before the PR enters the queue:

```bash
PR=<number>

# Verify auto-merge is set
gh pr view "$PR" --json autoMergeRequest \
  --jq '.autoMergeRequest // "NOT SET — run: gh pr merge $PR --merge --auto"'

# Check CI statuses
gh pr checks "$PR"

# Confirm target branch and head naming
gh pr view "$PR" --json baseRefName,headRefName,mergeStateStatus,isDraft \
  --jq '{base: .baseRefName, head: .headRefName, merge: .mergeStateStatus, draft: .isDraft}'
```

Must all be true:
- PR base is `integration/wave-1`
- Head uses `team-a/*`..`team-e/*` or approved `coord/*`
- Auto-merge is set
- All required checks are green (or will be -- merge queue waits for them)
- No ownership-scope violations
- Dependency ordering respected: do not enqueue a PR that depends on an unmerged upstream PR

Do not manually cancel CI jobs. Each job has `timeout-minutes` configured. If a job appears slow, wait for the timeout. Manual cancellation is permitted only with deterministic proof of a code-level failure.

## 4) QA-Integration 48h checkpoint loop

```bash
# Pull latest integration branch
git fetch origin
git checkout integration/wave-1
git pull --ff-only origin integration/wave-1

# Snapshot merged PRs for readiness matrix
gh pr list --base integration/wave-1 --state merged --limit 200 \
  --json number,title,headRefName,mergedAt > /tmp/w1-merged-prs.json

# Core checkpoint suite
pnpm typecheck
pnpm lint
pnpm lint:loc
pnpm test:quick
pnpm test:e2e
pnpm bundle:check

# Topology/privacy baseline (public vs sensitive path constraints)
pnpm test:quick -- packages/gun-client/src/topology.test.ts

# Feature-flag validation sweep (run once V2 stores/UI are landed in readiness matrix)
VITE_FEED_V2_ENABLED=false VITE_TOPIC_SYNTHESIS_V2_ENABLED=false pnpm test:e2e
VITE_FEED_V2_ENABLED=true VITE_TOPIC_SYNTHESIS_V2_ENABLED=true pnpm test:e2e

# Generate stability report (when automation script is available)
# node tools/scripts/generate-stability-report.mjs > "docs/reports/STABILITY_slice$(date +%Y%m%d-%H%M).md"
# Until then, use manual template from docs/reports/STABILITY_REPORT_SCHEMA.md
```

Record checkpoint report:

```bash
mkdir -p docs/reports
cat > "docs/reports/w1-qa-integ-checkpoint-$(date +%Y%m%d-%H%M).md" <<'REPORT'
- Checkpoint: [n]
- integration/wave-1 HEAD: [sha]
- Readiness matrix state: [landed PRs]
- Cross-team tests run: [list]
- Privacy/topology lint: [pass/fail]
- Feature flag validation: [pass/fail per state]
- Blocking issues: [none/list]
- Recommendation: [proceed/hold]
REPORT
```

## 5) Final Wave 1 integration pass -> main

```bash
# Verify integration branch healthy
git fetch origin
git checkout integration/wave-1
git pull --ff-only origin integration/wave-1

pnpm typecheck
pnpm lint
pnpm lint:loc
pnpm test:quick
pnpm test:e2e
pnpm bundle:check

# Final flag-state confirmation
VITE_FEED_V2_ENABLED=false VITE_TOPIC_SYNTHESIS_V2_ENABLED=false pnpm test:e2e
VITE_FEED_V2_ENABLED=true VITE_TOPIC_SYNTHESIS_V2_ENABLED=true pnpm test:e2e

# Confirm no open PRs still targeting integration branch
gh pr list --base integration/wave-1 --state open
```

If green, coordinator merges `integration/wave-1` to `main` via PR.

```bash
gh pr create \
  --base main \
  --head integration/wave-1 \
  --title "Wave 1 integration -> main" \
  --body "Wave 1 integration pass complete; all required checks green."
```

## 6) Fast triage commands

```bash
# Why did Ownership Scope fail?
gh run list --branch "$(git rev-parse --abbrev-ref HEAD)" --workflow CI --limit 5
gh run view <run-id> --log | rg "Ownership Scope|FAIL|out-of-scope"

# Local reproduction
node tools/scripts/check-ownership-scope.mjs

# Emergency local bypass (never for normal flow)
SKIP_OWNERSHIP_SCOPE=1 git push
```

Use bypass only with explicit coordinator approval and follow-up remediation.
