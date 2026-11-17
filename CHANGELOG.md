# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/). Versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-11-16

### Changed
- **New name: Lead Deck** (formerly Agent Board). Environment variables, the data folder and the request header keep the old names for compatibility.
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

[Unreleased]: https://github.com/JandersonSR/lead-deck/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/JandersonSR/lead-deck/releases/tag/v0.4.0
