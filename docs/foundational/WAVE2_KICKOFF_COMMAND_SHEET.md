# Wave 2 Kickoff Command Sheet

Companion to:
- `docs/foundational/V2_Sprint_Staffing_Plan.md`
- `docs/foundational/V2_Sprint_Staffing_Roles.md`
- `docs/foundational/WAVE2_DELTA_CONTRACT.md`
- `docs/foundational/CE_DUAL_REVIEW_CONTRACTS.md`

Use this for Wave 2 launch, per-slice dispatch, and integration cadence.

## Wave 2 Runtime Constants

- `ACTIVE_INTEGRATION_BRANCH=integration/wave-2`
- `ACTIVE_WAVE_LABEL=wave-2`
- `EXECUTION_BRANCH_PREFIXES=team-a/*,team-b/*,team-c/*,team-d/*,team-e/*,w2a/*,w2b/*,w2g/*,coord/*`
- `PARKED_BRANCH_PREFIX=agent/*`

All references below to "integration branch" mean `ACTIVE_INTEGRATION_BRANCH`.

## 0) One-time bootstrap (per worktree / agent)

```bash
pnpm install --frozen-lockfile
pnpm hooks:install

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" =~ ^agent/.+ ]]; then
  echo "Parked branch detected: $branch"
  echo "Switch to execution branch before task work."
else
  [[ "$branch" =~ ^(team-[a-e]/.+|w2[abg]/.+|coord/.+|integration/wave-[0-9]+|main)$ ]] \
    || { echo "Invalid branch: $branch"; exit 1; }
fi
```

## 1) Coordinator pre-dispatch checks

```bash
git fetch origin
git checkout "$ACTIVE_INTEGRATION_BRANCH"
git pull --ff-only origin "$ACTIVE_INTEGRATION_BRANCH"

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
gh api "repos/$REPO/branches/$ACTIVE_INTEGRATION_BRANCH/protection" \
  --jq '{enforce_admins: .enforce_admins.enabled, required: [.required_status_checks.checks[].context]}'
```

Expected required checks on integration branch:
- `Ownership Scope`
- `Quality Guard`
- `Test & Build`
- `E2E Tests`
- `Bundle Size`

## 2) CE dual-review gate (mandatory before Director dispatch)

1. Coordinator prepares packet (latest Director report + branch/PR/check state + explicit decision question).
2. Send packet to both `ce-codex` and `ce-opus`.
3. Each returns fixed-schema `CE Review Pass`.
4. Reconcile per `CE_DUAL_REVIEW_CONTRACTS.md` section 5:
   - both `AGREED` -> dispatch one prompt to Director
   - one `NEEDS_PARTNER_REVIEW` -> one additional round
   - unresolved after round 2 -> CEO escalation packet

Direct Coordinator-to-Director prompts without CE review are allowed only for break/fix emergencies with logged rationale.

## 3) Team execution branch start + PR creation

```bash
# Example for Team A; substitute team letter and ticket slug.
git fetch origin
git checkout -b team-a/<ticket>-<slug> "origin/$ACTIVE_INTEGRATION_BRANCH"

pnpm typecheck
pnpm lint
pnpm test:quick
pnpm test:coverage
node tools/scripts/check-ownership-scope.mjs

cp .github/pull_request_template.md /tmp/w2-pr-body.md
"${EDITOR:-vi}" /tmp/w2-pr-body.md

git push -u origin team-a/<ticket>-<slug>
PR_URL=$(gh pr create \
  --base "$ACTIVE_INTEGRATION_BRANCH" \
  --head team-a/<ticket>-<slug> \
  --title "<slice-title>" \
  --body-file /tmp/w2-pr-body.md)
PR_NUM=$(echo "$PR_URL" | sed -E 's#.*/pull/([0-9]+).*#\1#')
```

## 4) Chief gate + merge queue flow

```bash
PR=<number>
gh pr checks "$PR"
gh pr view "$PR" --json baseRefName,headRefName,mergeStateStatus,isDraft,autoMergeRequest \
  --jq '{base: .baseRefName, head: .headRefName, merge: .mergeStateStatus, draft: .isDraft, autoMerge: .autoMergeRequest}'
```

Chief confirms:
- PR base is `ACTIVE_INTEGRATION_BRANCH`
- head prefix is valid (`team-*` or approved `coord/*`)
- all required checks green (or queued under merge queue)
- ownership scope clean
- dependency ordering respected

Then set auto-merge if missing:

```bash
gh pr merge "$PR" --merge --auto
```

Do not manually cancel CI jobs. Use job `timeout-minutes`; only cancel with deterministic proof of a code-level failure.

## 5) Wave-end doc audit gate (required before next-wave dispatch)

Produce `docs/reports/WAVE2_DOC_AUDIT.md` with:
- findings by severity
- doc drift matrix
- fix list
- pass/fail status

No next-wave dispatch until `DOC_AUDIT_PASS` (except break/fix emergency with logged rationale).
