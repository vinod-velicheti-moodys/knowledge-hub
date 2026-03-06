import type pg from "pg";
import { v4 as uuid } from "uuid";
import { embed, vectorLiteral } from "./embeddings.js";
import { findSimilar, findSimilarByText } from "./similarity.js";
import { ensureDb } from "./db.js";

export interface Pattern {
  id: string;
  pattern: string;
  category: string;
  confidence: number;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  sources: string[];
}

export interface Pitfall {
  id: string;
  mistake: string;
  fix: string;
  frequency: number;
  lastOccurred: string;
  tags: string[];
}

export interface Preference {
  id: string;
  topic: string;
  preference: string;
  observedFrom: string[];
}

export interface Evolution {
  id: string;
  area: string;
  history: string;
  currentState: string;
  plannedChanges?: string;
}

export interface PaginatedResult<T> {
  results: T[];
  total: number;
  hasMore: boolean;
}

export class LongTermMemory {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  // --- Patterns ---

  async addPattern(data: {
    pattern: string;
    category: string;
    confidence?: number;
    sources?: string[];
    author?: string;
  }): Promise<string> {
    if (!(await ensureDb())) throw new Error("Database unavailable");

    const id = uuid();
    let embedding: number[] | null = null;
    try {
      embedding = await embed(data.pattern);
    } catch {
      /* continue without embedding */
    }

    await this.pool.query(
      `INSERT INTO patterns (id, pattern, category, confidence, sources, last_author, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7::vector)`,
      [
        id,
        data.pattern,
        data.category,
        data.confidence ?? 0.3,
        JSON.stringify(data.sources ?? []),
        data.author ?? null,
        embedding ? vectorLiteral(embedding) : null,
      ]
    );
    return id;
  }

  async reinforcePattern(id: string, source?: string): Promise<void> {
    if (!(await ensureDb())) return;
    await this.pool.query(
      `UPDATE patterns SET
         occurrences = occurrences + 1,
         confidence = LEAST(confidence + 0.1, 1.0),
         last_seen = NOW(),
         last_accessed = NOW(),
         sources = sources || $2::jsonb
       WHERE id = $1`,
      [id, source ? JSON.stringify([source]) : "[]"]
    );
  }

  async findSimilarPattern(
    text: string,
    threshold?: number
  ): Promise<(Pattern & { score: number }) | null> {
    if (!(await ensureDb())) return null;

    const results = await findSimilarByText(
      this.pool,
      text,
      "patterns",
      1,
      { tags: undefined }
    );

    if (results.length === 0) return null;
    const best = results[0];
    if (best.score < (threshold ?? 0.85)) return null;

    return { ...this.rowToPattern(best), score: best.score };
  }

  // --- Pitfalls ---

  async addPitfall(data: {
    mistake: string;
    fix: string;
    tags?: string[];
    author?: string;
  }): Promise<string> {
    if (!(await ensureDb())) throw new Error("Database unavailable");

    const id = uuid();
    let embedding: number[] | null = null;
    try {
      embedding = await embed(`${data.mistake} ${data.fix}`);
    } catch {
      /* continue without embedding */
    }

    await this.pool.query(
      `INSERT INTO pitfalls (id, mistake, fix, tags, last_author, embedding)
       VALUES ($1,$2,$3,$4,$5,$6::vector)`,
      [
        id,
        data.mistake,
        data.fix,
        JSON.stringify(data.tags ?? []),
        data.author ?? null,
        embedding ? vectorLiteral(embedding) : null,
      ]
    );
    return id;
  }

  async incrementPitfall(id: string): Promise<void> {
    if (!(await ensureDb())) return;
    await this.pool.query(
      `UPDATE pitfalls SET frequency = frequency + 1, last_occurred = NOW(), last_accessed = NOW() WHERE id = $1`,
      [id]
    );
  }

  async findSimilarPitfall(
    text: string,
    threshold?: number
  ): Promise<(Pitfall & { score: number }) | null> {
    if (!(await ensureDb())) return null;

    const results = await findSimilarByText(this.pool, text, "pitfalls", 1);
    if (results.length === 0) return null;
    const best = results[0];
    if (best.score < (threshold ?? 0.85)) return null;

    return { ...this.rowToPitfall(best), score: best.score };
  }

  // --- Wisdom (combined query) ---

  async getWisdom(
    topic: string,
    limit = 20
  ): Promise<{
    patterns: (Pattern & { score: number })[];
    pitfalls: (Pitfall & { score: number })[];
    preferences: Preference[];
  }> {
    if (!(await ensureDb())) {
      return { patterns: [], pitfalls: [], preferences: [] };
    }

    let queryEmbedding: number[];
    try {
      queryEmbedding = await embed(topic);
    } catch {
      return { patterns: [], pitfalls: [], preferences: [] };
    }

    const [patternRows, pitfallRows, prefRows] = await Promise.all([
      findSimilar(this.pool, queryEmbedding, "patterns", limit),
      findSimilar(this.pool, queryEmbedding, "pitfalls", limit),
      this.pool.query(
        `SELECT * FROM preferences WHERE topic ILIKE $1 OR preference ILIKE $1`,
        [`%${topic}%`]
      ),
    ]);

    return {
      patterns: patternRows.map((r) => ({
        ...this.rowToPattern(r),
        score: r.score,
      })),
      pitfalls: pitfallRows.map((r) => ({
        ...this.rowToPitfall(r),
        score: r.score,
      })),
      preferences: prefRows.rows.map(this.rowToPreference),
    };
  }

  async getPitfalls(
    area: string,
    limit = 20,
    offset = 0
  ): Promise<PaginatedResult<Pitfall>> {
    if (!(await ensureDb())) return { results: [], total: 0, hasMore: false };

    let results: Pitfall[];
    try {
      const embedding = await embed(area);
      const rows = await findSimilar(this.pool, embedding, "pitfalls", limit);
      results = rows.map(this.rowToPitfall);
      return { results, total: results.length, hasMore: false };
    } catch {
      const { rows } = await this.pool.query(
        `SELECT * FROM pitfalls WHERE archived = false AND (
           mistake ILIKE $1 OR fix ILIKE $1 OR tags::text ILIKE $1
         ) ORDER BY frequency DESC LIMIT $2 OFFSET $3`,
        [`%${area}%`, limit, offset]
      );
      const { rows: countRows } = await this.pool.query(
        `SELECT COUNT(*) AS c FROM pitfalls WHERE archived = false AND (
           mistake ILIKE $1 OR fix ILIKE $1 OR tags::text ILIKE $1
         )`,
        [`%${area}%`]
      );
      const total = parseInt(countRows[0].c, 10);
      return {
        results: rows.map(this.rowToPitfall),
        total,
        hasMore: offset + rows.length < total,
      };
    }
  }

  // --- Preferences ---

  async addPreference(data: {
    topic: string;
    preference: string;
    source?: string;
  }): Promise<string> {
    if (!(await ensureDb())) throw new Error("Database unavailable");
    const id = uuid();
    await this.pool.query(
      `INSERT INTO preferences (id, topic, preference, observed_from) VALUES ($1,$2,$3,$4)`,
      [id, data.topic, data.preference, JSON.stringify(data.source ? [data.source] : [])]
    );
    return id;
  }

  async getPreferences(
    topic?: string,
    limit = 20,
    offset = 0
  ): Promise<PaginatedResult<Preference>> {
    if (!(await ensureDb())) return { results: [], total: 0, hasMore: false };

    if (topic) {
      const { rows: countRows } = await this.pool.query(
        "SELECT COUNT(*) AS c FROM preferences WHERE topic ILIKE $1",
        [`%${topic}%`]
      );
      const total = parseInt(countRows[0].c, 10);
      const { rows } = await this.pool.query(
        `SELECT * FROM preferences WHERE topic ILIKE $1 LIMIT $2 OFFSET $3`,
        [`%${topic}%`, limit, offset]
      );
      return {
        results: rows.map(this.rowToPreference),
        total,
        hasMore: offset + rows.length < total,
      };
    }

    const { rows: countRows } = await this.pool.query(
      "SELECT COUNT(*) AS c FROM preferences"
    );
    const total = parseInt(countRows[0].c, 10);
    const { rows } = await this.pool.query(
      "SELECT * FROM preferences LIMIT $1 OFFSET $2",
      [limit, offset]
    );
    return {
      results: rows.map(this.rowToPreference),
      total,
      hasMore: offset + rows.length < total,
    };
  }

  // --- Evolution ---

  async addEvolution(data: {
    area: string;
    history: string;
    currentState: string;
    plannedChanges?: string;
  }): Promise<string> {
    if (!(await ensureDb())) throw new Error("Database unavailable");
    const id = uuid();
    await this.pool.query(
      `INSERT INTO evolution (id, area, history, current_state, planned_changes) VALUES ($1,$2,$3,$4,$5)`,
      [id, data.area, data.history, data.currentState, data.plannedChanges ?? null]
    );
    return id;
  }

  async getEvolution(area: string): Promise<Evolution | null> {
    if (!(await ensureDb())) return null;
    const { rows } = await this.pool.query(
      "SELECT * FROM evolution WHERE area ILIKE $1 LIMIT 1",
      [`%${area}%`]
    );
    if (rows.length === 0) return null;
    return this.rowToEvolution(rows[0]);
  }

  // --- Stats ---

  async getStats(): Promise<{
    patterns: number;
    highConfidence: number;
    pitfalls: number;
    preferences: number;
    evolution: number;
  }> {
    if (!(await ensureDb())) {
      return { patterns: 0, highConfidence: 0, pitfalls: 0, preferences: 0, evolution: 0 };
    }

    const [p, hc, pit, pref, evo] = await Promise.all([
      this.pool.query("SELECT COUNT(*) AS c FROM patterns WHERE archived = false"),
      this.pool.query("SELECT COUNT(*) AS c FROM patterns WHERE archived = false AND confidence >= 0.7"),
      this.pool.query("SELECT COUNT(*) AS c FROM pitfalls WHERE archived = false"),
      this.pool.query("SELECT COUNT(*) AS c FROM preferences"),
      this.pool.query("SELECT COUNT(*) AS c FROM evolution"),
    ]);

    return {
      patterns: parseInt(p.rows[0].c, 10),
      highConfidence: parseInt(hc.rows[0].c, 10),
      pitfalls: parseInt(pit.rows[0].c, 10),
      preferences: parseInt(pref.rows[0].c, 10),
      evolution: parseInt(evo.rows[0].c, 10),
    };
  }

  // --- Decay ---

  async decayStalePatterns(monthsInactive = 6): Promise<number> {
    if (!(await ensureDb())) return 0;
    const { rowCount } = await this.pool.query(
      `UPDATE patterns SET confidence = confidence * 0.85
       WHERE archived = false AND last_seen < NOW() - INTERVAL '1 month' * $1`,
      [monthsInactive]
    );

    const { rowCount: archived } = await this.pool.query(
      `UPDATE patterns SET archived = true WHERE confidence < 0.1 AND archived = false`
    );

    return (rowCount ?? 0) + (archived ?? 0);
  }

  // --- Row mappers ---

  private rowToPattern(row: any): Pattern {
    return {
      id: row.id,
      pattern: row.pattern,
      category: row.category,
      confidence: row.confidence,
      occurrences: row.occurrences,
      firstSeen: row.first_seen?.toISOString?.() ?? row.first_seen,
      lastSeen: row.last_seen?.toISOString?.() ?? row.last_seen,
      sources: row.sources ?? [],
    };
  }

  private rowToPitfall(row: any): Pitfall {
    return {
      id: row.id,
      mistake: row.mistake,
      fix: row.fix,
      frequency: row.frequency,
      lastOccurred: row.last_occurred?.toISOString?.() ?? row.last_occurred,
      tags: row.tags ?? [],
    };
  }

  private rowToPreference(row: any): Preference {
    return {
      id: row.id,
      topic: row.topic,
      preference: row.preference,
      observedFrom: row.observed_from ?? [],
    };
  }

  private rowToEvolution(row: any): Evolution {
    return {
      id: row.id,
      area: row.area,
      history: row.history,
      currentState: row.current_state,
      plannedChanges: row.planned_changes,
    };
  }
}
