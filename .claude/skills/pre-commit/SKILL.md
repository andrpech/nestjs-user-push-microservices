---
name: pre-commit
description: Stage all files, run `make pc` pre-commit checks, and auto-fix failures using the project's fix targets (`fsw`, `lsf`). Use when the user wants to run pre-commit, prepare changes for commit, or says "pc", "pre-commit", "run checks".
---

# Pre-commit (project-adapted for nestjs-user-push-microservices)

## Project context

- Monorepo via npm workspaces: `apps/*` + `libs/*`.
- `make pc` runs `typecheck` (tsc --noEmit at root) → `lint` (oxlint) → `format-check` (prettier).
- Auto-fix targets live in the Makefile:
  - `make fsw` — format staged files (prettier --write)
  - `make lsf` — lint staged files (oxlint --fix)
- **No env-sync check yet.** `.env.example` will be checked against `src/config/configuration.ts` in a later phase. Don't expect `check-env.sh` failures.
- **Lib build is independent of pre-commit.** `make pc` only runs typecheck on source — it does NOT require libs to be pre-built. If you need to actually run the app, see the boot caveats below.
- Per workflow memory: **never run `git commit` or `git push` autonomously** — stage, validate, stop.

## Workflow

1. **Discover fix targets** by reading the Makefile (don't assume — confirm they exist):

   ```bash
   grep -E '^(fsw|lsf|fs|ls):' Makefile
   ```

   Available in this project: `fsw`, `lsf`, `fs`, `ls`. **No `lbf` or `fb`** — branch variants were dropped.

2. **Stage all files:**

   ```bash
   git add -A
   ```

3. **Switch to Node 22** before running checks (the project requires Node 22 per `.nvmrc`; if your shell defaults to a different version, prepend the nvm sourcing dance):

   ```bash
   export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh" && nvm use 22 >/dev/null 2>&1
   ```

4. **Run pre-commit checks:**

   ```bash
   make pc
   ```

5. **If `make pc` fails:**
   - **Format failures** → `make fsw` (writes prettier-formatted files), then re-stage and retry.
   - **Lint failures** → `make lsf` (oxlint --fix on staged), then re-stage and retry. If warnings remain that aren't auto-fixable, address manually — do NOT silence rules in `.oxlintrc.json` to make checks pass.
   - **Typecheck failures** → no auto-fix; report the error to the user and stop.
   - **TypeScript emit weirdness** (e.g. tsc says "no errors" but `dist/` is incomplete or stale): delete stale `.tsbuildinfo` files and retry — incremental compilation can mask issues across tsconfig changes:
     ```bash
     find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete
     ```

6. **Report result:**
   - If `make pc` passed (first or second attempt): confirm success and summarize what's staged.
   - If it still fails after fixes: show the error output and stop. Do not attempt further fixes.
   - **Never commit.** Stop after staging + validation. The user runs `git commit` themselves.

## Notes

- Never skip or bypass hooks (`--no-verify`).
- Never modify lint/format/typecheck config (`.oxlintrc.json`, `.prettierrc.json`, `tsconfig.json`) to make checks pass — fix the code instead. The exception is when the config itself has a real bug (e.g. an oxlint rule that doesn't exist in the installed version), but that requires user confirmation.
- The husky pre-commit hook (`.husky/pre-commit`) only runs `make pre-commit` on the `main` branch — on other branches it exits 0. So `make pc` from this skill is the actual gate during dev work.
- If you find yourself wanting to bypass the hook, you're probably about to commit something the linter rejected. Fix the code.
- The `git-guardrails-claude-code` hook in `.claude/hooks/block-dangerous-git.sh` blocks `git push`, `git reset --hard`, etc. — that's expected protection, not a bug. Don't try to work around it.
