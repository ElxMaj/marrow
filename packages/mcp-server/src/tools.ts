import { type Marrow } from "@marrowhq/core";
import { z } from "zod";

// The agent's read/write surface. Every tool is thin over core, every result
// carries status and provenance alongside the fact, and every read is bounded:
// there is deliberately no get-everything tool. No tool can set a node decided.

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown) => Promise<unknown>;
}

const MAX_K = 20;

export function createTools(core: Marrow): ToolDef[] {
  return [
    {
      name: "search",
      description:
        "Search the brain for the entities, decisions and questions most relevant to a task. Returns a small, task-scoped set, each with status and provenance. Never returns the whole brain.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "what you are trying to build or understand" },
          k: { type: "number", description: `max results (1..${MAX_K})` },
        },
        required: ["query"],
      },
      handler: async (args) => {
        const { query, k } = z
          .object({ query: z.string(), k: z.number().int().min(1).max(MAX_K).default(8) })
          .parse(args);
        return { results: await core.search(query, k) };
      },
    },
    {
      name: "get_decisions",
      description:
        "List decided (or filtered) product decisions, each with status, confidence and provenance back to the room.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["open", "decided", "contested", "superseded"] },
        },
      },
      handler: async (args) => {
        const { status } = z
          .object({
            status: z.enum(["open", "decided", "contested", "superseded"]).optional(),
          })
          .parse(args);
        return { decisions: await core.getDecisions(status ? { status } : {}) };
      },
    },
    {
      name: "get_goals",
      description:
        "List the product and user goals the room committed to: what the product must do and what a user must be able to do. Each carries status, goalType, confidence and provenance back to the room, so decided goals are told apart from open ones and every goal traces to evidence. Optionally filter by status or goalType.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["open", "decided", "contested", "superseded"] },
          goalType: { type: "string", enum: ["product", "user"] },
        },
      },
      handler: async (args) => {
        const { status, goalType } = z
          .object({
            status: z.enum(["open", "decided", "contested", "superseded"]).optional(),
            goalType: z.enum(["product", "user"]).optional(),
          })
          .parse(args);
        return {
          goals: await core.getGoals({
            ...(status ? { status } : {}),
            ...(goalType ? { goalType } : {}),
          }),
        };
      },
    },
    {
      name: "get_open_questions",
      description:
        "List the open questions the room has not settled (ambiguities, conflicts, gaps). Each carries provenance.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ questions: await core.getOpenQuestions() }),
    },
    {
      name: "get_entity",
      description: "Get one entity by id or name, with its status and provenance.",
      inputSchema: {
        type: "object",
        properties: { idOrName: { type: "string" } },
        required: ["idOrName"],
      },
      handler: async (args) => {
        const { idOrName } = z.object({ idOrName: z.string() }).parse(args);
        return { entity: (await core.getEntity(idOrName)) ?? null };
      },
    },
    {
      name: "trace_to_source",
      description:
        "Trace a node back to the exact evidence span(s) it came from: the source label and the verbatim text. This is how a fact is checked against the room.",
      inputSchema: {
        type: "object",
        properties: { nodeId: { type: "string" } },
        required: ["nodeId"],
      },
      handler: async (args) => {
        const { nodeId } = z.object({ nodeId: z.string() }).parse(args);
        return core.traceToSource(nodeId);
      },
    },
    {
      name: "prepare_task",
      description:
        "Prepare the compact task brief an agent should read before building: relevant decided goals and decisions, open or contested questions, exact provenance spans, safe-to-build vs ask-human-first sections, and optional drift check receipts. Never returns the whole brain.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "the coding task the agent is about to do" },
          check: { type: "boolean", description: "also scan the current diff for drift" },
          repoPath: { type: "string", description: "repo path for check mode" },
          scope: {
            type: "string",
            description: "diff scope for check mode: unstaged, staged, or a git ref/range",
          },
          semantic: { type: "boolean", description: "run semantic drift filtering when available" },
        },
        required: ["task"],
      },
      handler: async (args) => {
        const { task, check, repoPath, scope, semantic } = z
          .object({
            task: z.string(),
            check: z.boolean().optional(),
            repoPath: z.string().optional(),
            scope: z.string().optional(),
            semantic: z.boolean().optional(),
          })
          .parse(args);
        return core.prepareTask(task, {
          check: check === true,
          ...(repoPath !== undefined ? { repoPath } : {}),
          ...(scope !== undefined ? { scope } : {}),
          ...(semantic !== undefined ? { semantic } : {}),
        });
      },
    },
    {
      name: "append_evidence",
      description:
        "Append raw room evidence (a transcript, note, message) verbatim. Append only: it is never edited or deleted. Distillation happens separately.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" }, source: { type: "string" } },
        required: ["text", "source"],
      },
      handler: async (args) => {
        const { text, source } = z.object({ text: z.string(), source: z.string() }).parse(args);
        return { evidenceId: await core.ingest({ text, source }) };
      },
    },
    {
      name: "propose_node",
      description:
        "Propose a node (entity, decision, goal or question) into the graph. It is created OPEN with a model confidence; only a human answer can later promote it to decided. Requires provenance to an evidence span. A goal carries goalType ('product' or 'user') and may name the entity it serves.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["entity", "decision", "goal", "question"] },
          name: { type: "string" },
          title: { type: "string" },
          rationale: { type: "string" },
          constraint: { type: "boolean" },
          goalType: { type: "string", enum: ["product", "user"] },
          entityId: { type: "string" },
          description: { type: "string" },
          prompt: { type: "string" },
          relatesTo: { type: "array", items: { type: "string" } },
          provenance: {
            type: "array",
            items: {
              type: "object",
              properties: {
                evidenceId: { type: "string" },
                start: { type: "number" },
                end: { type: "number" },
              },
              required: ["evidenceId", "start", "end"],
            },
          },
          confidence: { type: "number" },
        },
        required: ["kind", "provenance"],
      },
      handler: async (args) => {
        const provenance = z
          .array(
            z.object({
              evidenceId: z.string(),
              start: z.number().int().nonnegative(),
              end: z.number().int().nonnegative(),
            }),
          )
          .min(1);
        const base = { provenance, confidence: z.number().min(0).max(1).optional() };
        const schema = z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("entity"),
            name: z.string(),
            description: z.string().optional(),
            ...base,
          }),
          z.object({
            kind: z.literal("decision"),
            title: z.string(),
            rationale: z.string().optional(),
            constraint: z.boolean().optional(),
            ...base,
          }),
          z.object({
            kind: z.literal("goal"),
            title: z.string(),
            description: z.string().optional(),
            goalType: z.enum(["product", "user"]),
            entityId: z.string().optional(),
            ...base,
          }),
          z.object({
            kind: z.literal("question"),
            prompt: z.string(),
            relatesTo: z.array(z.string()).optional(),
            ...base,
          }),
        ]);
        return { node: await core.proposeNode(schema.parse(args)) };
      },
    },
    {
      name: "check_drift",
      description:
        "Before building, check the working repo against the room's DECIDED facts. Flags code that contradicts a decided product decision and raises it as an OPEN question for a human to resolve. It is read-only on the code and never overwrites or creates a decided fact: the room decides, the code reflects, this watches the gap. Returns the divergence questions, each linked to the decided fact it contradicts, with file/line provenance and confidence.",
      inputSchema: {
        type: "object",
        properties: {
          repoPath: {
            type: "string",
            description: "absolute path to the repo to scan (defaults to the working directory)",
          },
          scope: {
            type: "string",
            description:
              "which diff to scan: 'unstaged', 'staged', or any git ref/range; default is unstaged",
          },
          semantic: {
            type: "boolean",
            description:
              "run the semantic precision layer when a model is configured (default true)",
          },
        },
      },
      handler: async (args) => {
        const { repoPath, scope, semantic } = z
          .object({
            repoPath: z.string().optional(),
            scope: z.string().optional(),
            semantic: z.boolean().optional(),
          })
          .parse(args);
        const { created, events } = await core.driftScan(repoPath ?? process.cwd(), {
          scope,
          semantic,
          trigger: "mcp",
        });
        return {
          drift: created
            .filter((q): q is import("@marrowhq/shared").Question => q.kind === "question")
            .map((q) => ({
              questionId: q.id,
              kind: q.kind,
              status: q.status,
              prompt: q.prompt,
              confidence: q.confidence,
              relatesTo: q.relatesTo,
              provenance: q.provenance,
            })),
          events,
        };
      },
    },
    {
      name: "maintain_truth",
      description:
        "Return the product truth maintenance brief: decided product/user goals, open proposed goals, contested facts, unanswered gaps, pending drift catches, connector health, and next human actions.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => core.maintainTruth(),
    },
    {
      name: "accept_catch",
      description:
        "Record that you acted on a surfaced drift catch. Stores the resolution as evidence, promotes the question to decided, and writes a catch_acted_on event. Only questions that relate to a decided decision can be accepted.",
      inputSchema: {
        type: "object",
        properties: {
          questionId: { type: "string", description: "the id of the drift question you acted on" },
          resolution: {
            type: "string",
            description:
              "what you did about the drift (e.g. reverted the code, updated the decision, confirmed the exception)",
          },
        },
        required: ["questionId", "resolution"],
      },
      handler: async (args) => {
        const { questionId, resolution } = z
          .object({ questionId: z.string(), resolution: z.string() })
          .parse(args);
        return core.acceptCatch(questionId, resolution);
      },
    },
    {
      name: "dismiss_catch",
      description:
        "Mark a surfaced drift catch as noise. Records the reason as evidence, sets the question to dismissed, and writes a catch_dismissed event. Only questions that relate to a decided decision can be dismissed.",
      inputSchema: {
        type: "object",
        properties: {
          questionId: { type: "string", description: "the id of the drift question to dismiss" },
          reason: { type: "string", description: "why this catch is not a contradiction" },
        },
        required: ["questionId", "reason"],
      },
      handler: async (args) => {
        const { questionId, reason } = z
          .object({ questionId: z.string(), reason: z.string() })
          .parse(args);
        return core.dismissCatch(questionId, reason);
      },
    },
  ];
}
