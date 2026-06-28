import PgBoss from "pg-boss";

// background jobs run on pg-boss in the SAME Postgres. distillation is slow and
// uses the model, so it cannot block ingestion. no external broker, ever.

export const DISTILL_QUEUE = "marrow-distill";

export interface DistillJob {
  evidenceId: string;
}

export interface JobState {
  state: string;
  failed: boolean;
}

export interface EnqueueOptions {
  retryLimit?: number;
}

export class Queue {
  private readonly boss: PgBoss;

  constructor(databaseUrl: string) {
    this.boss = new PgBoss(databaseUrl);
  }

  async start(): Promise<void> {
    await this.boss.start();
    await this.boss.createQueue(DISTILL_QUEUE);
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: false });
  }

  /** Enqueue a distill job. retries with backoff by default so a transient
   *  failure is retried, never silently dropped. */
  async enqueueDistill(evidenceId: string, options: EnqueueOptions = {}): Promise<string> {
    const id = await this.boss.send(DISTILL_QUEUE, { evidenceId } satisfies DistillJob, {
      retryLimit: options.retryLimit ?? 3,
      retryBackoff: true,
    });
    if (!id) throw new Error("queue: failed to enqueue distill job");
    return id;
  }

  /** Fetch the next available distill job, or undefined if the queue is empty. */
  async fetchDistill(): Promise<{ id: string; evidenceId: string } | undefined> {
    const jobs = await this.boss.fetch<DistillJob>(DISTILL_QUEUE);
    const job = jobs[0];
    if (!job) return undefined;
    return { id: job.id, evidenceId: job.data.evidenceId };
  }

  async complete(id: string): Promise<void> {
    await this.boss.complete(DISTILL_QUEUE, id);
  }

  async fail(id: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.boss.fail(DISTILL_QUEUE, id, { message });
  }

  /** Inspect a job's state. a failed job is visible here, it never vanishes. */
  async getState(id: string): Promise<JobState> {
    const job = await this.boss.getJobById(DISTILL_QUEUE, id, { includeArchive: true });
    const state = job?.state ?? "not_found";
    return { state, failed: state === "failed" };
  }
}
