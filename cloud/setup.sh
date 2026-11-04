#!/bin/bash
# Setup script for a Claude Code cloud environment: installs the day,
# handoff, prompt-coach, cache-clock, reflect, timesheet and back mods so they
# load from the first prompt, and updates any already installed, so a cached
# environment picks up new versions each time it runs. Paste into the
# environment's setup script field on claude.ai/code. Safe to run again.
set -e
claude plugin marketplace add CandidDan/claude-mods || true
claude plugin marketplace update candiddan
for mod in day handoff prompt-coach cache-clock reflect timesheet back mods; do
  claude plugin install "$mod@candiddan" --scope user
  claude plugin update "$mod@candiddan" --scope user
done
