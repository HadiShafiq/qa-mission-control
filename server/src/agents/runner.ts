import type { AgentTask, PrismaClient } from '@prisma/client';
import { audit } from '../lib/audit.js';
import { AiError } from '../lib/ai.js';

/**
 * Minimal in-process background runner for agent tasks (Phase 2).
 *
 * Tasks are persisted in AgentTask before they are queued, so their state is
 * always visible in the UI. One task runs at a time. On server start, tasks
 * left QUEUED or RUNNING by a previous process are marked FAILED with a clear
 * reason rather than silently resumed. A Redis-backed queue with dependencies
 * and parallel workers replaces this in Phase 9.
 */

export type TaskContext = {
  task: AgentTask;
  signal: AbortSignal;
  progress: (percent: number, message: string) => Promise<void>;
};

export type TaskOutcome = { output: unknown; model?: string; usage?: unknown };
export type TaskHandler = (ctx: TaskContext) => Promise<TaskOutcome>;

type Logger = { error: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void };

export class TaskRunner {
  private queue: string[] = [];
  private controllers = new Map<string, AbortController>();
  private active: Promise<void> | null = null;
  private handlers = new Map<string, TaskHandler>();

  constructor(
    private db: PrismaClient,
    private log: Logger,
  ) {}

  register(agent: string, handler: TaskHandler) {
    this.handlers.set(agent, handler);
  }

  /** Mark tasks orphaned by a previous server process as failed. */
  async recover() {
    const stale = await this.db.agentTask.findMany({ where: { status: { in: ['QUEUED', 'RUNNING'] } } });
    for (const t of stale) {
      await this.db.$transaction(async (tx) => {
        await tx.agentTask.update({
          where: { id: t.id },
          data: { status: 'FAILED', error: 'Interrupted because the server stopped before the task finished. Run it again.', finishedAt: new Date() },
        });
        await audit(tx, { projectId: t.projectId, entityType: 'AgentTask', entityId: t.id, action: 'FAILED', summary: `${t.agent} task interrupted by a server restart` });
      });
    }
    return stale.length;
  }

  enqueue(taskId: string) {
    this.queue.push(taskId);
    this.pump();
  }

  /** Cancel a queued or running task. Returns false if it had already finished. */
  async cancel(taskId: string) {
    const task = await this.db.agentTask.findUnique({ where: { id: taskId } });
    if (!task || !['QUEUED', 'RUNNING'].includes(task.status)) return false;
    this.queue = this.queue.filter((id) => id !== taskId);
    // Atomic QUEUED → CANCELLED; if the runner claimed it first, abort the run instead.
    const claimed = await this.db.agentTask.updateMany({ where: { id: taskId, status: 'QUEUED' }, data: { status: 'CANCELLED' } });
    if (claimed.count) {
      await this.finish(task, 'CANCELLED', { error: 'Cancelled before it started.' });
      return true;
    }
    const controller = this.controllers.get(taskId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /** Stop accepting work, abort the running task and wait for it to settle. */
  async shutdown() {
    this.queue = [];
    for (const c of this.controllers.values()) c.abort();
    await this.idle();
  }

  /** Resolves when the queue is empty (used by tests and shutdown). */
  async idle() {
    while (this.active) await this.active;
  }

  private pump() {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    this.active = this.run(next).finally(() => {
      this.active = null;
      this.pump();
    });
  }

  private async run(taskId: string) {
    const task = await this.db.agentTask.findUnique({ where: { id: taskId } });
    if (!task || task.status !== 'QUEUED') return;
    const handler = this.handlers.get(task.agent);
    if (!handler) {
      await this.finish(task, 'FAILED', { error: `No handler is registered for agent ${task.agent}.` });
      return;
    }

    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    // Atomic QUEUED → RUNNING so a concurrent cancel can't be overwritten.
    const claimed = await this.db.agentTask.updateMany({
      where: { id: taskId, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date(), progress: 1, progressMessage: 'Starting' },
    });
    if (!claimed.count) {
      this.controllers.delete(taskId);
      return;
    }
    const running = await this.db.agentTask.findUniqueOrThrow({ where: { id: taskId } });

    try {
      const outcome = await handler({
        task: running,
        signal: controller.signal,
        progress: async (percent, message) => {
          if (controller.signal.aborted) return;
          await this.db.agentTask.update({ where: { id: taskId }, data: { progress: Math.max(0, Math.min(99, Math.round(percent))), progressMessage: message } });
        },
      });
      if (controller.signal.aborted) throw new AiError('CANCELLED', 'Cancelled.');
      await this.finish(running, 'COMPLETED', {
        output: JSON.stringify(outcome.output ?? null),
        model: outcome.model,
        usage: outcome.usage === undefined ? undefined : JSON.stringify(outcome.usage),
      });
    } catch (err) {
      const cancelled = controller.signal.aborted || (err instanceof AiError && err.code === 'CANCELLED');
      if (!cancelled && !(err instanceof AiError)) this.log.error({ err, taskId }, 'Agent task failed');
      const message = err instanceof Error ? err.message : String(err);
      await this.finish(running, cancelled ? 'CANCELLED' : 'FAILED', { error: cancelled ? 'Cancelled by the user. Nothing was saved.' : message });
    } finally {
      this.controllers.delete(taskId);
    }
  }

  private async finish(task: AgentTask, status: 'COMPLETED' | 'FAILED' | 'CANCELLED', data: { output?: string; error?: string; model?: string; usage?: string }) {
    await this.db.$transaction(async (tx) => {
      await tx.agentTask.update({
        where: { id: task.id },
        data: {
          ...data,
          status,
          finishedAt: new Date(),
          ...(status === 'COMPLETED' ? { progress: 100, progressMessage: 'Completed' } : { progressMessage: status === 'FAILED' ? 'Failed' : 'Cancelled' }),
        },
      });
      await audit(tx, {
        projectId: task.projectId,
        entityType: 'AgentTask',
        entityId: task.id,
        action: status,
        summary: `${task.agent} task ${status.toLowerCase()}${data.error && status === 'FAILED' ? `: ${data.error.slice(0, 160)}` : ''}`,
      });
    });
  }
}
