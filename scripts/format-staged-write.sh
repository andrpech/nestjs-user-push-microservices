#!/usr/bin/env sh
set -e
FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(js|jsx|ts|tsx|mjs|cjs)$' || true)
if [ -z "$FILES" ]; then
  echo "No staged .ts/.tsx/.js/.jsx/.mjs/.cjs files to format"
  exit 0
fi
echo "Formatting (staged):"
echo "$FILES"
echo "$FILES" | xargs prettier --cache --write
