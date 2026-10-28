#!/bin/bash
# Setup script for a Claude Code cloud environment: installs the day,
# handoff, prompt-coach, cache-clock and reflect mods so they load from the
# first prompt. Paste into the environment's setup script field on
# claude.ai/code. Safe to run again.
set -e
claude plugin marketplace add CandidDan/claude-mods || claude plugin marketplace update candiddan
claude plugin install day@candiddan --scope user
claude plugin install handoff@candiddan --scope user
claude plugin install prompt-coach@candiddan --scope user
claude plugin install cache-clock@candiddan --scope user
claude plugin install reflect@candiddan --scope user
