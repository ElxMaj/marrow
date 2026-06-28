import { type Marrow } from "./marrow.js";
import { type Queue } from "./queue.js";

/**
 * Processes distill jobs: distill the evidence, then link and merge it into the
 * graph. a failure is reported back to the queue so it retries and, when
 * retries are exhausted, lands in a visible failed state. a job is never
 * silently dropped.
 */
export class Worker {
  constructor(
    private readonly queue: Queue,
    private readonly marrow: Marrow,
  ) {}

  /** Process one job if the queue has one. Returns true if a job was handled. */
  async runOnce(): Promise<boolean> {
    const job = await this.queue.fetchDistill();
    if (!job) return false;
    try {
      await this.marrow.distill(job.evidenceId);
      await this.marrow.linkAndMerge(job.evidenceId);
      await this.queue.complete(job.id);
    } catch (error) {
      await this.queue.fail(job.id, error);
    }
    return true;
  }

  /** Drain the queue, processing jobs until none remain available. */
  async runUntilEmpty(): Promise<number> {
    let processed = 0;
    while (await this.runOnce()) processed += 1;
    return processed;
  }
}
