# RepoGraph Intelligence

## Structural Intelligence for Software Systems

## Product Requirements Document (PRD)

**Version:** v1.0  
**Status:** Draft  
**Author:** Open Source AI-Native Systems Project

## 1. Executive Summary

RepoGraph Intelligence is an AI-native structural intelligence engine for software repositories.

The platform helps developers and AI systems understand how large codebases actually behave.

Unlike traditional AI coding tools that primarily focus on autocomplete, code generation, chat, or file-level understanding, RepoGraph Intelligence focuses on system-level reasoning, dependency intelligence, architecture understanding, impact analysis, and structural comprehension.

The platform converts repositories into live semantic graphs that can be analyzed, queried, visualized, and reasoned about.

Current repository status: the project includes a verified Node.js baseline for the CLI, MCP server, graph intelligence APIs, and tests; a Rust Phase 1 workspace for Tree-sitter parsing, typed graph construction, SQLite storage, metrics, and CLI foundations; and a React Flow graph explorer for visual inspection.

The long-term goal is to become the foundational context and structural intelligence layer for AI-native software development.

## 2. Problem Statement

Modern repositories are becoming too large and interconnected for humans or current AI systems to understand reliably.

Developers frequently struggle with hidden dependencies, unclear architecture, onboarding complexity, architecture drift, circular coupling, unpredictable side effects, and AI-generated changes that break system assumptions.

Existing tools solve autocomplete, local code editing, static search, or repository visualization. However, they do not deeply model structural relationships, execution flow, dependency propagation, or architecture behavior.

RepoGraph Intelligence exists to solve this problem.

## 3. Vision

Build the system intelligence layer for software repositories.

The platform should deeply understand repository structure, infer architecture patterns, identify risk, detect coupling, assist AI systems, and improve developer understanding of complex systems.

The repository should be treated as a graph, a dependency network, a runtime behavior model, and an evolving architecture system.

## 4. Core Product Insight

Current AI coding systems mostly understand files, chunks, prompts, and embeddings. They do not reliably understand system structure, architecture relationships, dependency propagation, or large-scale repository behavior.

RepoGraph Intelligence introduces structural intelligence: the ability to reason about how systems connect, what changes affect, what architecture patterns exist, and where risks emerge.

## 5. Product Goals

### Primary Goals

- Build deep repository understanding
- Model repository structure as graphs
- Infer architecture patterns automatically
- Detect hidden coupling
- Predict change impact
- Help AI systems reason about repositories
- Improve developer comprehension
- Reduce architecture drift

### Secondary Goals

- Improve onboarding
- Improve refactor confidence
- Improve pull request analysis
- Improve AI-assisted development reliability
- Create reusable repository intelligence APIs

## 6. Non-Goals

The platform is not another AI autocomplete tool, chatbot wrapper, AI IDE clone, static code map viewer, repository search engine, or autonomous coding agent framework.

## 7. Target Users

### Primary Users

- Senior developers
- Staff engineers
- OSS maintainers
- Platform engineers
- Technical architects
- AI-assisted developers

### Secondary Users

- Engineering managers
- Security reviewers
- DevOps engineers
- Developer productivity teams

## 8. High-Level Architecture

```text
                +--------------------+
                |  IDE Extensions    |
                +---------+----------+
                          |
                +---------v----------+
                | RepoGraph Core     |
                +---------+----------+
                          |
     +--------------------+--------------------+
     |                    |                    |
+----v-----+      +-------v------+      +------v-------+
| Parsers  |      | Graph Engine |      | AI Engine    |
+----+-----+      +-------+------+      +------+-------+
     |                    |                    |
+----v-----+      +-------v------+      +------v-------+
| AST      |      | Dependency   |      | Semantic     |
| Layer    |      | Analysis     |      | Reasoning    |
+----------+      +--------------+      +--------------+
```

## 9. Core System Components

### 9.1 Repository Parser Engine

Responsible for parsing repositories, generating ASTs, extracting symbols, identifying imports and exports, and building dependency relationships.

Initial language support:

- TypeScript
- JavaScript
- Python

Future language support:

- Go
- Rust
- Java
- C#
- C++

### 9.2 Structural Graph Engine

Responsible for generating file graphs, symbol graphs, module graphs, dependency graphs, and execution flow graphs.

Node types:

- files
- functions
- classes
- interfaces
- modules
- packages
- services

Edge types:

- imports
- exports
- references
- inheritance
- invocation
- dependency
- ownership

### 9.3 Semantic Intelligence Engine

Responsible for embeddings, semantic understanding, architecture inference, AI explanations, and structural reasoning.

### 9.4 Impact Analysis Engine

Responsible for blast radius prediction, dependency propagation, change impact analysis, and refactor risk estimation.

### 9.5 Visualization Layer

Responsible for graph rendering, architecture exploration, dependency inspection, and repository navigation.

## 10. Recommended Technology Stack

### Frontend

- React
- TypeScript
- TailwindCSS
- Zustand
- React Flow

### Desktop Layer

Preferred:

- Tauri

Alternative:

- Electron

### Backend/Core Engine

Preferred:

- Rust

Alternative:

- Go

Rust is preferred because of performance, concurrency, parsing efficiency, graph-heavy workloads, and memory safety.

### Storage Layer

Initial:

- SQLite

Analytics:

- DuckDB

Future optional:

- Neo4j

### Parsing Layer

- Tree-sitter

### AI Layer

Local models:

- Ollama

Cloud-compatible providers:

- OpenAI-compatible APIs
- Anthropic-compatible APIs

Embeddings:

- local embedding models
- reranking models

### Search Layer

Recommended:

- Tantivy

Alternative:

- Meilisearch

## 11. Product Development Phases

## Phase 1 - Repository Structural Engine

### Goal

Build the foundational repository analysis and graph generation engine.

### Features

#### 11.1 Repository Parser

The system must recursively parse repositories, detect files, identify symbols, identify imports and exports, detect references, and generate dependency relationships.

Supported languages:

- TypeScript
- JavaScript
- Python

Output:

- A normalized structural graph

#### 11.2 AST Analysis Engine

Extract functions, classes, methods, interfaces, modules, imports, exports, and dependency edges.

#### 11.3 Dependency Graph Engine

Generate file dependency graphs, symbol dependency graphs, and module relationship graphs.

#### 11.4 Graph Database Layer

Store nodes, edges, metadata, repository relationships, and graph indexes.

Initial implementation:

- SQLite plus graph abstraction layer

#### 11.5 Graph Visualization UI

Interactive graph UI with zoom, pan, filters, node inspection, and dependency exploration.

#### 11.6 Repository Metrics Engine

Calculate dependency density, circular dependencies, hotspot files, highly coupled modules, and orphan modules.

#### 11.7 CLI

```bash
repograph analyze ./repo
repograph graph
repograph stats
```

### Deliverables

The system should analyze repositories, generate dependency graphs, expose repository metrics, and visualize repository structure.

### Success Criteria

The platform must parse medium-sized repositories reliably, generate accurate dependency graphs, detect coupling patterns, and provide stable graph navigation.

## Phase 2 - Semantic Intelligence Layer

### Goal

Add semantic understanding and AI-native reasoning.

### Features

#### 12.1 Embedding Engine

Generate embeddings for files, functions, modules, documentation, and comments.

#### 12.2 Semantic Repository Search

Example queries:

- authentication flow
- database write paths
- payment pipeline
- user session management

#### 12.3 Architecture Inference Engine

Automatically infer services, domain boundaries, architecture layers, and architectural patterns.

#### 12.4 AI Explanations

Example queries:

- Explain how authentication works.
- Summarize the payment system.
- Describe API request flow.

#### 12.5 Context Compression Engine

Generate compressed repository context for AI IDEs, coding agents, and large-context workflows.

### Deliverables

The system should support semantic repository search, generate architecture summaries, provide AI explanations, and generate compressed repository context.

### Success Criteria

The system must outperform naive keyword search, generate useful architecture summaries, and support meaningful semantic querying.

## Phase 3 - Change Impact Intelligence

### Goal

Predict consequences of repository changes.

### Features

#### 13.1 Blast Radius Analysis

Example question:

- What breaks if I modify this interface?

#### 13.2 Dependency Risk Scoring

Score unstable modules, high-risk files, critical dependencies, and tightly coupled systems.

#### 13.3 Refactor Simulation

Predict downstream effects, dependency changes, architectural shifts, and coupling growth.

#### 13.4 Pull Request Intelligence

Analyze pull requests for affected systems, architecture impact, dependency changes, and risky modifications.

#### 13.5 Architecture Drift Detection

Detect growing coupling, circular growth, unstable dependency expansion, and anti-pattern emergence.

### Deliverables

The system should estimate architectural impact, identify dangerous changes, and explain dependency propagation.

### Success Criteria

The platform must identify risky architectural changes, reduce hidden dependency failures, and improve refactor confidence.

## Phase 4 - AI Agent and IDE Ecosystem

### Goal

Become infrastructure for AI-native development workflows.

### Features

#### 14.1 IDE Extensions

Supported IDEs:

- VSCode
- JetBrains IDEs

#### 14.2 MCP Server

Expose repository intelligence to AI IDEs, agents, copilots, and local assistants.

#### 14.3 AI Context APIs

Provide compressed structural context, architecture summaries, dependency snapshots, and repository intelligence APIs.

#### 14.4 Intelligent Guidance

Example warnings:

- This module is a critical dependency.
- This file affects 14 downstream systems.
- This dependency introduces architecture instability.

#### 14.5 Multi-Repository Intelligence

Support monorepos, distributed systems, and microservice ecosystems.

### Deliverables

RepoGraph Intelligence becomes an AI infrastructure layer, a repository intelligence platform, and a structural context provider.

## Phase 5 - Enterprise and Advanced Intelligence

### Goal

Scale the system into enterprise-grade architecture intelligence.

### Features

#### 15.1 Historical Repository Evolution

Analyze architecture evolution, dependency growth, technical debt accumulation, and coupling changes over time.

#### 15.2 Team Ownership Intelligence

Infer ownership patterns, contributor hotspots, dependency ownership, and architectural responsibility.

#### 15.3 Security and Risk Intelligence

Detect risky dependency paths, vulnerable architecture patterns, critical blast zones, and unsafe coupling.

#### 15.4 Architecture Recommendations

Suggest modularization, decoupling opportunities, service extraction, and dependency optimization.

## 12. Open Source Strategy

Core open-source components:

- parser engine
- graph engine
- CLI
- repository intelligence engine
- semantic analysis layer
- visualization layer

Community contribution areas:

- parser plugins
- language support
- architecture rules
- graph processors
- AI providers
- IDE integrations

## 13. Future Commercial Possibilities

Optional future monetization:

- hosted analytics
- cloud indexing
- enterprise collaboration
- security intelligence
- large-scale repository analytics
- historical architecture tracking

## 14. Initial MVP Priorities

Highest priority:

1. Repository parser
2. AST extraction
3. Dependency graph generation
4. Graph database layer
5. Visualization UI
6. CLI

Medium priority:

7. Semantic search
8. AI summaries
9. Architecture inference

Advanced priority:

10. Blast radius analysis
11. PR intelligence
12. Agent integrations

## 15. Technical Risks

Major risks:

- parsing accuracy
- graph scalability
- false dependency inference
- cross-language analysis complexity
- noisy architecture inference

## 16. Product Risks

Major risks:

- becoming just visualization
- excessive complexity
- poor signal-to-noise ratio
- unreliable AI explanations
- low day-to-day utility

## 17. Critical Product Principle

The graph itself is not the product.

The real product is intelligence built on top of structural understanding.

## 18. Long-Term Vision

RepoGraph Intelligence should evolve into the system intelligence layer for repositories, a foundational AI context provider, an architecture analysis platform, and infrastructure for AI-native software engineering.

## 19. Final One-Sentence Description

RepoGraph Intelligence is an AI-native structural intelligence engine that helps developers and AI systems understand how large software repositories actually behave.
