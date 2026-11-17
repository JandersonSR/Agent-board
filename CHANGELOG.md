# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/). Versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **Infra in real time:** DigitalOcean, Heroku, Azure and Grafana read with read-only tokens. Resource status with CPU and memory history, firing alerts (sustained thresholds plus provider alerts), the deploy that may have caused each alert, and a timeline of status changes, alerts and deploys.
- **Incident from an alert:** critical production alerts open a SEV2 incident (at most 5 per hour, can be turned off) and are marked mitigated when the alert clears; any alert becomes an incident in one click.
- **DORA with real deploys:** production deploys from the providers drive deploy frequency, and time to restore counts until mitigation.
- Infra items in the Attention block and an Infra check in Settings.

### Fixed
- **DigitalOcean with a custom-scope token:** a part the token cannot read (e.g. droplets with an `app:read`-only token) no longer fails the whole provider. The rest is read and the provider shows *partial* with the missing scope; it only fails when nothing is readable.

## [0.4.0] - 2026-11-16

### Changed
- **New name: TLDeck** (formerly Agent Board). Environment variables, the data folder and the request header keep the old names for compatibility.
- README rewritten around the problem, a one-minute demo and a "Why not X?" comparison.
- Node.js 22.13 or newer is required (Node 20 reached end of life).

### Added
- **Local SQLite storage by default**; MongoDB becomes optional (`MONGO_URI`).
- **Demo mode** (`npm run demo`): the whole board with fictitious data in English or Portuguese, no integration needed.
- **Background sessions** from Claude Code's agent view (`claude agents`): state, logs, attach command and stop.
- **Staff view:** DORA metrics, incidents with blameless postmortems, team decisions, knowledge concentration (bus factor), product stages with critical path, and a fixed evaluation set measuring what the AI review misses.
- Integration tests on a real database (SQLite always, MongoDB in CI), SQLite × MongoDB parity tests and Playwright end-to-end tests.
- LICENSE, CONTRIBUTING, SECURITY, ROADMAP, issue and pull request templates.

## [0.3.0] - 2026-11-16

### Added
- AI review quality (keep/discard findings, precision per prompt version), team flow metrics, end-to-end tasks from issue to draft PR, CI and an opt-in reusable AI pre-review workflow.
- Interface and README in English and Portuguese.
- Filters by person, team and repository.

## [0.2.0]

### Added
- TypeScript monorepo (Fastify + React): team daily, blockers, queue, pending reviews, PR and deploy tracking, background PR reviews by Claude.

## [0.1.0]

### Added
- Local board for Claude Code and Cursor sessions through hooks (single-file JavaScript server).

[Unreleased]: https://github.com/JandersonSR/tldeck/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/JandersonSR/tldeck/releases/tag/v0.4.0
