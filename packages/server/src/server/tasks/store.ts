import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  StoredTaskQuestionSchema,
  StoredTaskSchema,
  type StoredTask,
  type StoredTaskQuestion,
} from "@getpaseo/protocol/tasks/types";
import { writeJsonFileAtomic } from "../atomic-file.js";

function generateId(): string {
  return randomBytes(4).toString("hex");
}

type TaskUpdater = (task: StoredTask) => StoredTask | Promise<StoredTask>;
type QuestionUpdater = (
  question: StoredTaskQuestion,
) => StoredTaskQuestion | Promise<StoredTaskQuestion>;

/**
 * Per-record JSON storage for coordination tasks, mirroring ScheduleStore:
 * one file per record under `tasks/`, atomic writes, and per-id serialized
 * mutations so concurrent RPCs cannot interleave read-modify-write cycles.
 */
export class TaskStore {
  private readonly taskMutations = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async list(): Promise<StoredTask[]> {
    await this.ensureDir();
    const entries = await readdir(this.dir, { withFileTypes: true });
    const tasks = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const content = await readFile(join(this.dir, entry.name), "utf-8");
          return StoredTaskSchema.parse(JSON.parse(content));
        }),
    );
    return tasks.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async listByOwner(ownerAgentId: string): Promise<StoredTask[]> {
    const tasks = await this.list();
    return tasks.filter((task) => task.ownerAgentId === ownerAgentId);
  }

  async get(id: string): Promise<StoredTask | null> {
    await this.ensureDir();
    try {
      const content = await readFile(this.filePath(id), "utf-8");
      return StoredTaskSchema.parse(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async create(task: Omit<StoredTask, "id">): Promise<StoredTask> {
    const created = StoredTaskSchema.parse({ ...task, id: generateId() });
    await this.write(created);
    return created;
  }

  async update(id: string, updater: TaskUpdater): Promise<StoredTask | null> {
    return this.serializeMutation(id, async () => {
      const current = await this.get(id);
      if (!current) {
        return null;
      }
      const next = await updater(current);
      if (next === current) {
        return current;
      }
      if (next.id !== id) {
        throw new Error(`Task update cannot change id: ${id}`);
      }
      const updated = StoredTaskSchema.parse(next);
      await this.write(updated);
      return updated;
    });
  }

  async delete(id: string): Promise<void> {
    await this.serializeMutation(id, async () => {
      await this.ensureDir();
      await rm(this.filePath(id), { force: true });
    });
  }

  private async write(task: StoredTask): Promise<void> {
    await this.ensureDir();
    await writeJsonFileAtomic(this.filePath(task.id), task);
  }

  private async serializeMutation<T>(id: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.taskMutations.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(mutation);
    this.taskMutations.set(id, next);
    try {
      return await next;
    } finally {
      void next
        .catch(() => undefined)
        .finally(() => {
          if (this.taskMutations.get(id) === next) {
            this.taskMutations.delete(id);
          }
        });
    }
  }
}

/** Same storage contract for durable agent-to-agent questions. */
export class TaskQuestionStore {
  private readonly questionMutations = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async list(): Promise<StoredTaskQuestion[]> {
    await this.ensureDir();
    const entries = await readdir(this.dir, { withFileTypes: true });
    const questions = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const content = await readFile(join(this.dir, entry.name), "utf-8");
          return StoredTaskQuestionSchema.parse(JSON.parse(content));
        }),
    );
    return questions.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async get(id: string): Promise<StoredTaskQuestion | null> {
    await this.ensureDir();
    try {
      const content = await readFile(this.filePath(id), "utf-8");
      return StoredTaskQuestionSchema.parse(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async create(question: Omit<StoredTaskQuestion, "id">): Promise<StoredTaskQuestion> {
    const created = StoredTaskQuestionSchema.parse({ ...question, id: generateId() });
    await this.write(created);
    return created;
  }

  async update(id: string, updater: QuestionUpdater): Promise<StoredTaskQuestion | null> {
    return this.serializeMutation(id, async () => {
      const current = await this.get(id);
      if (!current) {
        return null;
      }
      const next = await updater(current);
      if (next === current) {
        return current;
      }
      if (next.id !== id) {
        throw new Error(`Question update cannot change id: ${id}`);
      }
      const updated = StoredTaskQuestionSchema.parse(next);
      await this.write(updated);
      return updated;
    });
  }

  async delete(id: string): Promise<void> {
    await this.serializeMutation(id, async () => {
      await this.ensureDir();
      await rm(this.filePath(id), { force: true });
    });
  }

  private async write(question: StoredTaskQuestion): Promise<void> {
    await this.ensureDir();
    await writeJsonFileAtomic(this.filePath(question.id), question);
  }

  private async serializeMutation<T>(id: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.questionMutations.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(mutation);
    this.questionMutations.set(id, next);
    try {
      return await next;
    } finally {
      void next
        .catch(() => undefined)
        .finally(() => {
          if (this.questionMutations.get(id) === next) {
            this.questionMutations.delete(id);
          }
        });
    }
  }
}
