# Changelog

This project follows [Semantic Versioning](https://semver.org/). Releases are tagged as `vMAJOR.MINOR.PATCH`; unreleased branch work stays under `Unreleased` until it is merged and published.

## [1.17.0] - 2026-08-10

### Added

- Reproducible Node.js tests for configuration, HTTP retry behavior, RAG candidate pruning, message splitting, and reminder persistence.
- Public-tree credential audit, syntax check, and deterministic benchmark scripts.
- Anonymous demo fixtures for conversations, persistent assistant state, and plugin composition.
- GitHub Actions CI and a security/privacy policy.

### Changed

- Extracted RAG term-index and outgoing message-splitting helpers into testable modules without changing their runtime interfaces.

- Centralized environment configuration and shared HTTP retry client.
- Documented deployment, security controls, and provider configuration.

- Default Koishi HTTP host changed to `127.0.0.1`.
- RAG retrieval adds term-index candidate pruning before cosine reranking.
