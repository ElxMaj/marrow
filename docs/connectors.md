# Connectors

Ingesting the room by hand works, but the room is bigger than the files you remember to drop. The product gets decided in Slack threads, standup recordings, support tickets, design comments and meeting notes, every day. Connectors turn that into a steady, automatic flow of evidence into the brain so you do not have to copy anything in.

A connector pulls new material from one external tool and hands it to Marrow as evidence. The brain distills it the same way it distills a transcript you dropped by hand. Nothing about the knowledge model changes: every fact still carries status and provenance, and the raw text a connector pulls is stored verbatim as immutable evidence first.

## The sacred rule

A connector only ever INSERTs evidence. It never mutates, never deletes, never edits a row that already exists. If the same item shows up twice, the sync skips it, it does not update it. This is the append-only evidence rule and it holds for connectors exactly as it holds for a hand-dropped file. That is what keeps every provenance link pointing at a span that never moved.

## The twelve connectors

Each connector implements one small interface: `Connector { name; fetchSince(since): Promise<IngestInput[]> }`. Given a watermark, it returns the new items as `{ text, source }`, and the sync engine does the rest.

| connector | what it pulls | source id |
|-----------|---------------|-----------|
| slack | messages from the channels you point it at (or all public channels) | `slack:channel:ts` |
| github | issues and their comments across the repos you list | `github:owner/repo#n` |
| linear | issues with title and description, optionally scoped to teams | `linear:IDENT` |
| notion | page text, either searched across the workspace or specific pages and databases | `notion:pageId` |
| figma | comments on the files you list, where a lot of design intent actually lives | `figma:fileKey:commentId` |
| zoom | cloud recording transcripts, with the meeting topic as a fallback | `zoom:meetingId` |
| intercom | the admin side of support conversations, the customer signal | `intercom:id` |
| email (new) | Gmail messages matching a query or labels, subject plus plain-text body | `email:msgId` |
| teams (new) | Microsoft Teams channel posts, html reduced to plain text, system messages skipped | `teams:teamId:channelId:msgId` |
| jira (new) | Jira Cloud issues: summary, description and comments, Atlassian doc format flattened to text | `jira:KEY` |
| granola (new) | Granola meeting notes, falling back to the raw transcript | `granola:noteId` |
| otter (new) | Otter speeches as speaker-attributed transcripts | `otter:speechId` |

Email, Teams, Jira, Granola and Otter are the new ones. The rest shipped earlier.

A note on honesty: Granola and Otter do not publish a stable public API spec yet, so those two connectors model documented-style endpoints (a paged list with an updated-since filter and a cursor). The field names are easy to swap when the official spec lands. This is called out in the code, not hidden.

## The sync engine

The sync engine is the durable layer that turns configured connectors into a flow you can trust to run on a schedule. For each enabled connector it does the same four things:

1. **Read the cursor.** Every connector has a watermark in the `connector_state` table. The first run starts at the epoch, every run after starts where the last successful one left off, so a connector only ever pulls what is new.
2. **Dedup by source.** Before inserting, it checks whether that exact source id is already in evidence. If it is, the item is skipped, never updated. Evidence stays append-only and a re-run never double-ingests.
3. **Ingest and enqueue.** New items are written as evidence and queued for distillation, the same path a hand-dropped file takes.
4. **Advance on success, record a run.** The cursor only moves forward when the run succeeds. Either way the engine writes one `connector_sync` run (see [observability.md](./observability.md)) with the count ingested, the count skipped, the latency and any error.

Because every run is idempotent it is safe to retry and safe to schedule. That is the Temporal-shaped property, a durable incremental pull with a cursor and a recorded outcome, on one Postgres. No external workflow engine, no broker. It fits the one-Postgres rule.

A sync that fails does not advance the cursor and does not half-commit: the items it did ingest before the error stay (evidence is append-only, they are real), the cursor stays where it was, and the next run picks up the same window and skips what already landed. You retry by running it again.

## Secrets are encrypted at rest

A connector needs a token or an API key. That secret is encrypted with AES-256-GCM before it ever touches the database, using a key derived from `MARROW_SECRET_KEY`. The database stores ciphertext in `connector_config.secret_cipher`, never plaintext. The non-secret fields (channel ids, base urls, queries) live alongside it in plain `settings`. A database dump on its own never leaks a token, and you control the key.

`MARROW_SECRET_KEY` must be set to a long random string before you store a connector secret. There is no new dependency for this, it uses Node's built-in crypto. See [security.md](./security.md).

## Configuring a connector

### Self-host (CLI)

```bash
# list what is configured
marrow connectors

# add one (the secret is encrypted before it is stored)
marrow connectors add slack --name slack --secret xoxb-... \
  --settings '{"channelIds":["C012AB"]}'

# enable, disable, remove
marrow connectors enable slack
marrow connectors disable slack
marrow connectors rm slack

# pull now: one connector, or every enabled one
marrow sync slack
marrow sync
```

Set `MARROW_SECRET_KEY` in your environment first. The `--settings` json carries the non-secret config for that connector kind (for example `repos` for github, `fileKeys` for figma, `teamId` for teams, `baseUrl` and `email` for jira).

The console gives the same surface a screen: see [console.md](./console.md).

## What a connector is not

A connector is not a code reader. It pulls from the product room (chat, tickets, calls, notes, design), never from the repo as a source of truth. A GitHub connector reads issues and their discussion, the room around the code, not the code as fact.
