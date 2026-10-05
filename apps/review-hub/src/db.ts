import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

export interface ShareRecord {
  id: string;
  request_id: string;
  manifest_sha256: string;
  capability: string | null;
  capability_hash: string | null;
  status: "pending" | "completed" | "revoked";
  manifest_json: string | null;
  url: string | null;
  created_at: number;
  revoked_at: number | null;
}

export function openHubDatabase(databasePath: string): DatabaseSync {
  const dir = path.dirname(databasePath);

  mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(databasePath, { timeout: 5000 });

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      request_id TEXT UNIQUE NOT NULL,
      manifest_sha256 TEXT NOT NULL,
      capability TEXT,
      capability_hash TEXT,
      status TEXT NOT NULL,
      manifest_json TEXT,
      url TEXT,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_shares_request_id ON shares(request_id);
    CREATE INDEX IF NOT EXISTS idx_shares_status ON shares(status);
  `);

  return db;
}

function toShareRecord(row: Record<string, SQLOutputValue>): ShareRecord {
  return {
    id: String(row.id),
    request_id: String(row.request_id),
    manifest_sha256: String(row.manifest_sha256),
    // SAFETY: Database stores only valid status enum values.
    status: row.status as ShareRecord["status"],
    created_at: Number(row.created_at),
    manifest_json: row.manifest_json != null ? String(row.manifest_json) : null,
    capability: row.capability != null ? String(row.capability) : null,
    capability_hash:
      row.capability_hash != null ? String(row.capability_hash) : null,
    url: row.url != null ? String(row.url) : null,
    revoked_at: row.revoked_at != null ? Number(row.revoked_at) : null,
  };
}

export class HubStore {
  constructor(private readonly db: DatabaseSync) {}

  getShare(id: string): ShareRecord | null {
    const row = this.db.prepare("SELECT * FROM shares WHERE id = ?").get(id);

    if (!row) {
      return null;
    }

    return toShareRecord(row);
  }

  getShareByRequestId(requestId: string): ShareRecord | null {
    const row = this.db
      .prepare("SELECT * FROM shares WHERE request_id = ?")
      .get(requestId);

    if (!row) {
      return null;
    }

    return toShareRecord(row);
  }

  createPendingShare(input: {
    id: string;
    requestId: string;
    manifestSha256: string;
  }): ShareRecord {
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO shares (id, request_id, manifest_sha256, status, created_at)
         VALUES (?, ?, ?, 'pending', ?)`,
      )
      .run(input.id, input.requestId, input.manifestSha256, now);

    return this.getShare(input.id)!;
  }

  updateManifest(id: string, manifestJson: string): void {
    this.db
      .prepare("UPDATE shares SET manifest_json = ? WHERE id = ?")
      .run(manifestJson, id);
  }

  completeShare(input: {
    id: string;
    capability: string;
    capabilityHash: string;
    url: string;
  }): void {
    this.db
      .prepare(
        `UPDATE shares
         SET status = 'completed',
             capability = ?,
             capability_hash = ?,
             url = ?
         WHERE id = ?`,
      )
      .run(input.capability, input.capabilityHash, input.url, input.id);
  }

  revokeShare(id: string): boolean {
    const now = Date.now();

    const result = this.db
      .prepare(
        "UPDATE shares SET status = 'revoked', revoked_at = ? WHERE id = ?",
      )
      .run(now, id);

    return result.changes > 0;
  }
}
