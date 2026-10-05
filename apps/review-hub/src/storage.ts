import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export function digestBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class ObjectStorage {
  private readonly objectsDir: string;
  private readonly stagingDir: string;

  constructor(readonly homeDir: string) {
    this.objectsDir = path.join(homeDir, "objects");
    this.stagingDir = path.join(homeDir, "staging");
  }

  async init(): Promise<void> {
    await mkdir(this.objectsDir, { recursive: true, mode: 0o700 });
    await mkdir(this.stagingDir, { recursive: true, mode: 0o700 });
  }

  objectPath(objectId: string): string {
    return path.join(this.objectsDir, objectId);
  }

  async hasObject(objectId: string): Promise<boolean> {
    try {
      await stat(this.objectPath(objectId));

      return true;
    } catch {
      return false;
    }
  }

  async readObject(objectId: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.objectPath(objectId));
    } catch {
      return null;
    }
  }

  async writeObject(declaredId: string, bytes: Uint8Array): Promise<void> {
    const computedDigest = digestBytes(bytes);

    if (computedDigest !== declaredId) {
      throw new Error(
        `Digest mismatch: declared ${declaredId}, got ${computedDigest}`,
      );
    }

    const tempFile = path.join(
      this.stagingDir,
      `${declaredId}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );

    await writeFile(tempFile, bytes, { mode: 0o600 });
    const targetFile = this.objectPath(declaredId);

    try {
      await rename(tempFile, targetFile);
    } catch (err) {
      await rm(tempFile, { force: true }).catch(() => {});
      throw err;
    }
  }
}
