# Contributing to Mega Brain MCP

Thank you for showing an interest in contributing to **Mega Brain MCP**! All kinds of contributions are valuable to us—whether submitting bug reports, suggesting new capabilities, improving documentation, or opening pull requests.

In this guide, we cover how you can onboard quickly, set up your development environment, adhere to our architecture principles, and make high-quality contributions.

---

## Table of Contents

1. [Submitting an Issue](#submitting-an-issue)
   - [Naming Conventions for Issues](#naming-conventions-for-issues)
   - [Security Vulnerabilities](#security-vulnerabilities)
2. [Project Architecture & Domain Guidelines](#project-architecture--domain-guidelines)
3. [Environment Requirements & Local Setup](#environment-requirements--local-setup)
   - [Prerequisites](#prerequisites)
   - [Step-by-Step Setup](#step-by-step-setup)
4. [Development & Verification Workflow](#development--verification-workflow)
5. [Coding & Design Standards](#coding--design-standards)
6. [Language & Documentation Support](#language--documentation-support)
7. [Submitting a Pull Request](#submitting-a-pull-request)
8. [Community & Questions](#community--questions)

---

## Submitting an Issue

Before opening a new issue, please search existing [Issues](https://github.com/RaffaHr/mega-brain-mcp/issues) and [Discussions](https://github.com/RaffaHr/mega-brain-mcp/discussions) to check if a similar issue or discussion already exists.

When reporting bugs, please provide a minimal reproduction scenario. Having an isolated and reproducible example allows us to investigate and resolve issues quickly without back-and-forth.

Please include:
- Operating system and environment details (
ode -v, python --version).
- Mega Brain version (mega-brain --version or package.json).
- Relevant logs or diagnostic output from 
px @raffahr/mega-brain-mcp doctor (ensure sensitive credentials/tokens are redacted).
- Precise steps to reproduce.

You can open a new issue using our [GitHub Issue Templates](https://github.com/RaffaHr/mega-brain-mcp/issues/new/choose).

### Naming Conventions for Issues

Please format issue titles consistently:

- **Bugs**: 🐛 Bug: [short description]
- **Features**: 🚀 Feature: [short description]
- **Improvements**: 🛠️ Improvement: [short description]
- **Documentation**: 📘 Docs: [short description]
- **Questions**: ❓ Question: [short description]

**Examples:**
- 🐛 Bug: Process tree termination fails to release locked runtime on Windows
- 🚀 Feature: Add MiniMax embedding adapter support
- 📘 Docs: Clarify Python venv requirement in README

### Security Vulnerabilities

Please **do not** open public issues for sensitive security vulnerabilities. Follow our responsible disclosure guidelines via [GitHub Security Advisories](https://github.com/RaffaHr/mega-brain-mcp/security/advisories/new) or consult docs/security.md.

---

## Project Architecture & Domain Guidelines

Mega Brain MCP is an autonomous, local-first control plane for project knowledge that orchestrates backend engines (such as AgentMemory and Code Review Graph) through a single MCP interface (rain_recall, rain_learn, rain_change_context, rain_history, rain_validate, rain_status).

Before making structural or algorithmic changes:
- Read CONTEXT.md to ensure you use the official domain vocabulary (e.g. *Process Tree Termination*, *Network Egress*, *Managed Runtime*, *Runtime Secret Boundary*).
- Review architectural decision records under docs/adr/.
- Ensure strict compliance with docs/security.md (deny-by-default egress, secret boundary, fail-open Git hooks).

---

## Environment Requirements & Local Setup

### Prerequisites

- **Node.js**: 22.22.0+ (LTS recommended)
- **npm**: 10+
- **Python**: 3.10+ (with env module available)
- **Git**: 2.30+
- **Docker** *(Optional, required only for 
pm run test:isolated release gate)*

### Step-by-Step Setup

1. **Clone the repository:**
   `ash
   git clone https://github.com/RaffaHr/mega-brain-mcp.git
   cd mega-brain-mcp
   `

2. **Install dependencies:**
   `ash
   npm ci
   `

3. **Build the project:**
   `ash
   npm run build
   `

4. **Verify your local installation:**
   `ash
   npm test
   `

---

## Development & Verification Workflow

We maintain rigorous test and build suites to ensure cross-platform compatibility and rock-solid process supervision.

Run the appropriate checks before committing:

`powershell
# Type checking
npm run typecheck

# TypeScript compilation
npm run build

# Unit, integration, and contract tests
npm test

# Full specification test suite
npm run test:spec

# Autonomous lifecycle tests
npm run test:autonomous

# Benchmark suite
npm run benchmark

# Spec CI audit
npm run audit

# Dry-run package artifact
npm pack --dry-run
`

If you have Docker installed and want to run isolated lifecycle container checks:
`ash
npm run test:isolated
`

---

## Coding & Design Standards

To ensure consistency and safety across the codebase, please adhere to the following:

- **Strict Typing:** All TypeScript code must pass 	sc --noEmit with zero errors. Avoid ny where typed interfaces or schemas are possible.
- **Root-Cause Fixes:** Fix bugs at their root cause rather than patching symptoms.
- **Security Boundaries:** Never write secrets to disk in runtime manifests, state files, diagnostics, logs, or lockfiles.
- **Deterministic Process Management:** Always respect process tree lifecycles and cleanup guarantees.
- **Test Coverage:** All bug fixes and new features must be accompanied by unit or integration tests in 	ests/.

---

## Language & Documentation Support

Mega Brain MCP maintains parallel documentation in both English and Portuguese:
- English: README.md and docs/
- Portuguese (pt-BR): README-ptbr.md

When introducing new user-facing features, configuration keys, or CLI commands, please update both README.md and README-ptbr.md.

---

## Submitting a Pull Request

1. **Fork and branch:** Create a feature branch with a descriptive name:
   `ash
   git checkout -b feature/my-new-feature
   # or
   git checkout -b fix/issue-description
   `
2. **Make focused changes:** Keep your commits clean, atomic, and focused on the task.
3. **Verify locally:** Ensure 
pm run typecheck, 
pm run build, and 
pm test pass with no regressions.
4. **Push and create PR:** Push your branch to GitHub and open a Pull Request using the PR template.
5. **Review:** A maintainer will review your PR, suggest adjustments if needed, and merge once all checks succeed.

---

## Community & Questions

- **Discussions & Ideas:** Join conversations on [GitHub Discussions](https://github.com/RaffaHr/mega-brain-mcp/discussions).
- **Issue Tracker:** Report issues or track milestones on [GitHub Issues](https://github.com/RaffaHr/mega-brain-mcp/issues).

Thank you for helping make Mega Brain MCP better for everyone! 🚀🧠
