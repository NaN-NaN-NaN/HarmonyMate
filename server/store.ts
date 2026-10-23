import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { State } from "../shared/types.ts";

export class Store {
  readonly db: DatabaseSync;
  constructor(readonly directory: string) {
    mkdirSync(path.join(directory, "audio"), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(directory, "harmony.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)",
    );
    const initial: State = {
      songs: [
        {
          id: "a-little-closer",
          title: "A little closer",
          owner: "alex",
          members: ["alex", "ben"],
          createdAt: new Date().toISOString(),
        },
      ],
      takes: [],
      mixes: [],
      surprises: [],
      confirmations: [],
      recordings: [],
      traces: [],
      idempotency: {},
    };
    this.db
      .prepare("INSERT OR IGNORE INTO state (id, value) VALUES (1, ?)")
      .run(JSON.stringify(initial));
  }
  read(): State {
    return JSON.parse(
      (
        this.db.prepare("SELECT value FROM state WHERE id=1").get() as {
          value: string;
        }
      ).value,
    );
  }
  update<T>(fn: (state: State) => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.read();
      const value = fn(state);
      this.db
        .prepare("UPDATE state SET value=? WHERE id=1")
        .run(JSON.stringify(state));
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
