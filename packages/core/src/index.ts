// @marrowhq/core is the engine. It is the only package that talks to Postgres.
// Every surface drives it through the Marrow facade; the Store is the lower
// level primitive the facade is built on.
export {
  Marrow,
  createMarrow,
  type IngestInput,
  type TraceSpan,
  type TraceResult,
  type ProposeInput,
  type NeighborLink,
  type NeighborsBrief,
  type GraphEdge,
  type BrainGraph,
  type VerifyResult,
  type VerifyReport,
  type LintIssue,
  type LintReport,
  type SynthItem,
  type SynthReport,
  isFactStale,
} from "./marrow.js";
export { skepticReasons, verdictFor, type VerifyReason, type VerifyVerdict } from "./skeptic.js";
export { findDuplicateTitles } from "./lint.js";
export { scrubEnabled, scrubSecrets, type ScrubFinding, type ScrubResult } from "./scrub.js";
export { synthHeadline, type SynthCounts } from "./synthesize.js";
export {
  Store,
  createStore,
  type EvidenceDraft,
  type EntityDraft,
  type DecisionDraft,
  type QuestionDraft,
  type GoalDraft,
  type EdgeDraft,
  type Neighbor,
  type IndexEntry,
  type EmbeddingInput,
  type CatchEvent,
  type CatchMetrics,
  type VerificationDraft,
  type VerificationRecord,
  type RunDraft,
  type RunFilter,
  type SyncOutcome,
  type ConnectorConfigDraft,
} from "./store.js";
export { traced, estimateCostUsd, type RunReport, type TraceSpec } from "./observability.js";
export {
  SyncEngine,
  buildConnector,
  CONNECTOR_KINDS,
  type ConnectorKind,
  type SyncEngineDeps,
} from "./sync.js";
export { encryptSecret, decryptSecret } from "./crypto.js";
export * from "./providers/index.js";
export { migrate, type MigrateResult } from "./migrate.js";
export { doctor, type DoctorCheck } from "./doctor.js";
export { type Distilled } from "./distill.js";
export { rankQuestions, questionImpact } from "./loop.js";
export {
  normalizeTranscript,
  detectTranscriptFormat,
  type TranscriptFormat,
  type NormalizedTranscript,
} from "./transcripts.js";
export {
  createDemoModel,
  createConceptEmbedding,
  createDemoEmbedding,
  runDemo,
  DEMO_INTERVIEW,
  type DemoResult,
} from "./demo.js";
export { scanRepo, type RepoCandidate } from "./onboard.js";
export { readRepoCode, readGitDiff, parseGitDiff, type DiffHunk, type DiffScope } from "./drift.js";
export {
  decisionsConflict,
  decisionsConcerningEntity,
  entityHasDecision,
  negatedTerms,
  affirmedTerms,
  normalizeTitle,
  salientTerms,
  ruleDriftSignal,
  decisionSignals,
  type DecisionSignals,
  type RuleDriftHit,
} from "./link.js";
export {
  buildSemanticDriftPrompt,
  parseSemanticDriftResult,
  semanticDriftCheck,
  type SemanticDriftCandidate,
} from "./semantic-drift.js";
export { loadSyntheticGolden, runEval, type EvalCase, type EvalReport } from "./eval.js";
export { runBenchmark, seedBenchmarkBrain, type SeedDoc } from "./benchmark.js";
export {
  EmailConnector,
  type EmailConfig,
  FigmaConnector,
  type FigmaConfig,
  GitHubIssuesConnector,
  type GitHubConfig,
  GranolaConnector,
  type GranolaConfig,
  IntercomConnector,
  type IntercomConfig,
  JiraConnector,
  type JiraConfig,
  LinearConnector,
  type LinearConfig,
  NotionConnector,
  type NotionConfig,
  OtterConnector,
  type OtterConfig,
  SlackConnector,
  type SlackConfig,
  TeamsConnector,
  type TeamsConfig,
  ZoomConnector,
  type ZoomConfig,
  type Connector,
  type ConnectorConfig,
} from "./connectors/index.js";
