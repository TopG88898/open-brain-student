# AGENTS.md

## Agent skills

### Issue tracker

GitHub issues on `TopG88898/open-brain-student`, via the `gh` CLI. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Multi-context: `CONTEXT-MAP.md` at the repo root points to each project's `CONTEXT.md`; system-wide decisions go in `docs/adr/`. See [docs/agents/domain.md](docs/agents/domain.md).

### Project files

Every project (a skill or feature with its own behavior) has a `CONTEXT.md` (what its terms mean) and a `parameters.md` (settings it reads at run time: thresholds, limits, schedules), kept together in the project's directory. List each project in `CONTEXT-MAP.md`. `parameters.md` is committed to a public repo, so it never holds names, phone numbers, emails or other identifying data.
