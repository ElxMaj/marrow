#!/usr/bin/env bash
# Session-end hook: mine a finished coding session into the brain as dated
# evidence, so the room a session happened in becomes memory without you filing
# anything. This is a plain shell hook, not a daemon: wire it into your agent
# host to run when a session ends (a Claude Code Stop hook, a shell trap, or a
# manual run), and it appends once and exits.
#
# It only appends evidence. Distillation and the human question loop stay
# separate on purpose: run `marrow synthesize` and `marrow lint` on a schedule
# (see .github/workflows/maintenance.yml) to keep the brain current.
#
# Usage:
#   scripts/session-end-hook.sh path/to/transcript.md
#   some-agent --print-transcript | scripts/session-end-hook.sh
#   MARROW_BIN="pnpm marrow" scripts/session-end-hook.sh < transcript.md
set -euo pipefail

# the marrow CLI: the published `marrow` bin by default, or `pnpm marrow` in a
# checkout. Override with MARROW_BIN.
MARROW="${MARROW_BIN:-marrow}"

# a dated source label so the session is traceable and its age is visible.
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
source_label="session:${ts}"

# read from the given file, or stdin when none is passed.
input="${1:--}"

# append only (--no-distill): the nightly compile and the human loop turn this
# raw session into distilled truth later. This keeps the hook fast and needs no
# model key.
${MARROW} add "${input}" --source "${source_label}" --no-distill
