# Security at Marrow

Marrow holds the product room: transcripts, standups, decisions, and the code contradictions that surfaced from them. We design around the assumption that this data is sensitive.

## Architecture

- **One Postgres per deployment.** All data lives in Postgres with pgvector. No third-party vector database, no Redis, no Kafka.
- **Deployment boundary.** In the open-source repo, the operator owns the deployment, database, network boundary, and user access.
- **Encryption in transit.** Use TLS for any public endpoint and for Postgres connections that cross a network boundary.
- **Encryption at rest.** Self-hosters control their own disk encryption and backup policy.
- **Connector secrets encrypted at rest.** Connector tokens and API keys are encrypted with AES-256-GCM before they touch the database, using a key derived from `MARROW_SECRET_KEY` that the operator controls. The database stores ciphertext, never plaintext, and the non-secret config (channel ids, base urls, queries) lives separately. A database dump on its own never leaks a connector token. This uses Node's built-in crypto, no extra dependency. See [connectors.md](./connectors.md).

## Model providers

- **BYO keys.** You can configure your own Claude, OpenAI, or OpenAI-compatible key; Marrow never forces a shared key.
- **Zero retention.** We configure model providers with zero-retention policies where available. We do not train providers on customer data.
- **No prompt logging.** The application does not log prompts or completions.

## Retention and deletion

- Raw evidence is append-only and immutable. This is a sacred property of the knowledge model.
- The open-source deployment owner controls the database and backups. If you need to delete a deployment, delete the database and any backups under your retention policy.
- Hunk text in catch events is retained to power receipts and metrics. If your team needs a shorter retention window, enforce it at the database or backup layer until a product-level retention policy exists.

## Audit trail

Connector syncs, distillation, search, drift scans, and ingests are recorded in the run trace with status, latency, token usage when available, and errors. Connector configuration is stored in Postgres with encrypted secrets. See [observability.md](./observability.md).

## Compliance roadmap

The public repo is self-hosted software, not a hosted compliance boundary. Treat compliance as part of your deployment: database hosting, access control, backup retention, model-provider contract, and network configuration.

## Reporting

Please use GitHub private vulnerability reporting on the public repository. We aim to acknowledge quickly and prioritize critical fixes.
