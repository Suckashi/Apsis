import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname } from "node:path";

export class ConfigConflictError extends Error {
  readonly status = 409;
  constructor(file: string) {
    super(`${basename(file)} 已變更，請重新載入後再儲存。`);
  }
}

export function configError(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

export const configHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/** All application writers cooperate through this per-file, short-lived lock. */
function locked<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  let fd: number;
  try {
    fd = openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Do not guess whether an unknown lock is stale. A dead PID is safe to recover.
    let dead = false;
    try {
      const pid = Number(readFileSync(lock, "utf8"));
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (e) {
          dead = (e as NodeJS.ErrnoException).code === "ESRCH";
        }
      }
    } catch {
      /* A writer may still be recording its PID. */
    }
    if (!dead) throw new ConfigConflictError(file);
    unlinkSync(lock);
    fd = openSync(lock, "wx", 0o600);
  }
  try {
    writeFileSync(fd, String(process.pid));
    return fn();
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

function atomicWrite(file: string, text: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, file);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export interface ConfigSnapshot<T> {
  text: string;
  revision: string;
  value: T;
}

/** Synchronous small-file transactions. No await between comparing and replacing. */
export class ConfigFile<T> {
  readonly file: string;
  private readonly decode: (text: string) => T;
  private cached?: ConfigSnapshot<T>;
  constructor(file: string, decode: (text: string) => T) {
    this.file = file;
    this.decode = decode;
  }
  init(create: () => string) {
    mkdirSync(dirname(this.file), { recursive: true });
    locked(this.file, () => {
      const marker = `${this.file}.initialized`;
      if (!existsSync(this.file)) {
        if (existsSync(marker))
          configError(`${basename(this.file)} 遺失；請恢復檔案或備份。`);
        const text = create();
        this.decode(text);
        atomicWrite(this.file, text);
      }
      this.read();
      if (!existsSync(marker)) atomicWrite(marker, "1\n");
    });
    return this;
  }
  read(): ConfigSnapshot<T> {
    const text = readFileSync(this.file, "utf8");
    if (text !== this.cached?.text)
      this.cached = {
        text,
        revision: configHash(text),
        value: this.decode(text),
      };
    return structuredClone(this.cached);
  }
  write(text: string, expectedRevision: string): ConfigSnapshot<T> {
    this.decode(text);
    return locked(this.file, () => {
      const previous = this.read();
      if (previous.revision !== expectedRevision)
        throw new ConfigConflictError(this.file);
      if (text === previous.text) return previous;
      atomicWrite(`${this.file}.bak`, previous.text);
      // Recheck after the backup as an external editor does not take our lock.
      if (configHash(readFileSync(this.file, "utf8")) !== expectedRevision)
        throw new ConfigConflictError(this.file);
      atomicWrite(this.file, text);
      return this.read();
    });
  }
}
