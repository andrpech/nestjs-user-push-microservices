#!/usr/bin/env sh
set -e
FILES=$(git diff --name-only HEAD~1 --diff-filter=ACMR | grep -E '\.(js|jsx|ts|tsx|mjs|cjs)$' || true)
if [ -z "$FILES" ]; then
  echo "No changed .ts/.tsx/.js/.jsx/.mjs/.cjs files (HEAD~1) to lint-fix"
  exit 0
fi
echo "Lint-fix (HEAD~1):"
echo "$FILES"
echo "$FILES" | xargs oxlint --config .oxlintrc.json --fix
