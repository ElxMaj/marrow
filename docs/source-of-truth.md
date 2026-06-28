# The product source of truth

Marrow is not just a context feed for your agent. It is the place your product's truth lives: the product goals and user goals, the features and how they should behave, and the decisions behind them, each one carrying a status and a link to where it was decided. This doc explains what "source of truth" means here, why it is different from a wiki or a spec, how that truth gets created and kept fresh, and how your coding agent reads it before it builds.

## What "source of truth" means here

Most teams already have a source of truth on paper: a Notion page, a PRD, a Linear epic, a deck from the last planning offsite. The problem is not that it does not exist. The problem is that it is hand-written, it goes stale the moment the next standup changes something, nothing connects it to the code, and your coding agent has never read it.

Marrow's source of truth is different in four ways:

- **It is derived, not typed.** Most of it is distilled from the raw room (transcripts, standups, interviews, tickets, chat) rather than hand-authored, so it reflects what was actually said, not what someone remembered to write up.
- **Every fact has a status.** Open, decided, contested, or superseded. You can always tell what the team truly committed to from what is still a guess. A stale wiki cannot do this; every line looks equally true.
- **Every fact traces to its source.** A decided goal points at the exact evidence span it came from. There is no "trust me" truth.
- **It is served to the agent.** The same truth a human reads in the console is what the coding agent pulls over MCP, task-scoped, so it builds toward what the product is actually trying to do.

It is a source of truth that maintains itself against the room, knows what it does not know, and your agent can act on.

## Goals: product and user

The unit of the source of truth is the **Goal**, a fifth distilled node kind alongside Evidence, Entity, Decision and Question. A goal is a target the room committed to, and it comes in two types:

- **Product goals**: what the product must achieve. "Cut onboarding to a single day." "Self-host stays one Postgres." "No shared passwords anywhere in the product."
- **User goals**: what a user must be able to do. "A desk clerk can re-auth in under five seconds." "A PM can see what changed since last week without asking anyone."

A goal is distinct from a decision. A decision is a choice of *how* (we will use magic links). A goal is the *outcome* the choice serves (a user can sign in without a shared password). Keeping them separate lets the agent see both the target and the route to it.

Each goal carries the full discipline every distilled fact carries:

- A **status** (open, decided, contested, superseded),
- A **confidence** with a source (model or human),
- At least one **provenance** span pointing at the evidence it came from,
- And an optional link to the **feature it serves** (an Entity), so the source of truth is organized per product and per feature, not as one flat list.

There is no goal without provenance. That is the same sacred rule that governs every other fact in the brain.

## How the truth gets created

Goals enter the brain two ways, and the difference matters.

**The team authors them.** In the console's Goals section (or `marrow goal author` on the CLI), a product person writes a goal directly. Because a human deliberately stated it, the goal lands as **decided**, with human confidence. The act of writing it captures the text as immutable evidence, so even a hand-authored goal traces back to a real source: the team's own words, on the record. This is the "space where the product team adds the goals" in its simplest form.

**Distillation proposes them from the room.** When a transcript, standup, or connector item comes in, the distillation pass extracts goals it finds, the same way it extracts decisions and questions. These land as **open**, with model confidence, never decided. The model proposes; it does not get to declare product truth. A human promotes a proposed goal to decided by settling it in the question loop, the same promote-to-decided step that governs every other node. The model surfaces, the human commits.

Both paths converge on the same rule that keeps the brain honest: **the agent proposes, the human promotes.** Nothing becomes decided product truth without a person standing behind it.

## How the truth is kept fresh

A source of truth that is right on day one and stale by day thirty is worth nothing. Marrow keeps goals current as the product moves, in two ways, and neither of them lets code overwrite the truth.

**New room evidence updates it.** As the product evolves, the room keeps talking, and distillation keeps proposing. A new goal surfaces, or a new statement contradicts an existing goal and raises a conflict question, or a goal sits with no feature attached and raises a gap question asking which feature it serves. The loop keeps the goal set matching what the team is actually saying now.

**Drift watches the gap with the code.** This is the part that sounds dangerous and is not. `marrow drift` scans your git hunks against the **decided** goals, and when a change looks like it contradicts a goal, it captures the hunk as evidence and raises a question that relates to that goal. It records the catch so precision can be measured over time. What it never does is touch the goal. The goal's status, title, and confidence stay exactly as the room left them.

This is the line Marrow does not cross. **The room decides the goal, the code reflects it, Marrow watches the gap.** The repo is never read as a source of truth. Code cannot create a goal, edit a goal, or promote a goal. It can only ever produce a question for a human. That is what stops Marrow from sliding into a code-memory tool, where the code becomes the truth and the product intent quietly disappears. Goals are aspirational, so a code-versus-goal catch is surfaced with lower confidence than a code-versus-decision catch, and always as a question, never a block.

## How your agent reads it

The whole point of holding the source of truth is that the coding agent can build from it. It reaches the agent the same way every other fact does, task-scoped so it does not burn the context window:

- **Over MCP**, the agent calls `get_goals` and gets the relevant product and user goals back, each with its status and provenance, so it can tell a decided goal from a proposed one and trace either to source. Goals also show up in `search` results alongside decisions and questions.
- **On the CLI**, `marrow goals` lists them, filtered by type or status, for a developer or a script in the loop.
- **In the console**, the Goals section is the human view: product goals and user goals side by side, each with its status, the feature it serves, its confidence, and a trace to where it was decided. It is where the team authors, reviews, and reads the source of truth.

Because the agent gets the goal *and* its status, it knows the difference between "the team has decided this is the target" and "someone proposed this once and nobody has confirmed it." It builds toward the decided ones and asks about the open ones, instead of guessing.

## Seeding and maintaining it

A practical path to a source of truth your team and your agent will trust:

1. **Pour in the room.** Connect Slack, Linear, your meeting notes, or just paste a few transcripts. Distillation will propose an initial set of goals, decisions and questions from what is already there.
2. **Author the goals you know.** In the Goals section, write the handful of product and user goals you can state today. They land decided, with your team behind them, traced to your own words.
3. **Work the loop.** Settle the open and contested questions. Promoting a proposed goal to decided is one answer in the loop. This is the step that turns a pile of model guesses into committed truth.
4. **Point your agent at it.** Wire the MCP server into Claude Code or Cursor. The agent now reads your goals before it builds.
5. **Let drift keep you honest.** Run `marrow drift` in your workflow, or `marrow drift --ci` on pull requests. When code starts to pull away from a decided goal, you get a question, not a silent divergence.

The result is a product source of truth that is built from what was actually said, knows decided from open, traces every fact to its origin, stays current as the product moves, and is read by the agent that writes your code. It is the thing a wiki was always supposed to be and never could.

## What it is not

The source of truth is not a backlog, not a task tracker, and not a spec the agent treats as gospel without provenance. It does not set or decide product direction for you; it holds, structures, and keeps current the truth your team decides. And it is never derived from the repo. See [console.md](./console.md) for the Goals section in the UI.
