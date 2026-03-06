import type pg from "pg";
import { v4 as uuid } from "uuid";
import { embed, vectorLiteral } from "./embeddings.js";
import { findSimilar, findSimilarByText } from "./similarity.js";
import { ensureDb } from "./db.js";

export interface FactualEvent {
  id: string;
  type: string;
  timestamp: string;
  summary: string;
  details?: string;
  ticketId?: string;
  prNumber?: string;
  files?: string[];
  components?: string[];
  tags?: string[];
  author?: string;
}

export interface PaginatedResult<T> {
  results: T[];
  total: number;
  hasMore: boolean;
}

export class FactualMemory {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async recordEvent(event: Omit<FactualEvent, "id" | "timestamp">): Promise<string> {
    if (!(await ensureDb())) throw new Error("Database unavailable");

    if (!event.summary || event.summary.length < 10) {
      throw new Error("Event summary must be at least 10 characters.");
    }

    const eventId = event.ticketId
      ? `${event.type}:${event.ticketId}:${Date.now()}`
      : uuid();

    let embedding: number[] | null = null;
    try {
      embedding = await embed(event.summary + (event.details ? ` ${event.details}` : ""));
    } catch (err) {
      console.error("[factual] Embedding failed, storing without vector:", err);
    }

    if (embedding) {
      const dupes = await findSimilar(this.pool, embedding, "events", 1, {
        archived: false,
      });
      if (dupes.length > 0 && dupes[0].score > 0.95) {
        const dupeAge =
          Date.now() - new Date(dupes[0].timestamp as string).getTime();
        if (dupeAge < 24 * 60 * 60 * 1000) {
          console.error(
            `[factual] Near-duplicate detected (score=${dupes[0].score.toFixed(3)}), skipping`
          );
          return dupes[0].id;
        }
      }
    }

    await this.pool.query(
      `INSERT INTO events (id, type, summary, details, ticket_id, pr_number, files, components, tags, embedding, author)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector,$11)`,
      [
        eventId,
        event.type,
        event.summary,
        event.details ?? null,
        event.ticketId ?? null,
        event.prNumber ?? null,
        JSON.stringify(event.files ?? []),
        JSON.stringify(event.components ?? []),
        JSON.stringify(event.tags ?? []),
        embedding ? vectorLiteral(embedding) : null,
        event.author ?? null,
      ]
    );

    return eventId;
  }

  async recallByTags(
    tags: string[],
    limit = 20,
    offset = 0
  ): Promise<PaginatedResult<FactualEvent>> {
    if (!(await ensureDb())) return { results: [], total: 0, hasMore: false };

    const { rows: countRows } = await this.pool.query(
      "SELECT COUNT(*) AS c FROM events WHERE tags @> $1::jsonb AND archived = false",
      [JSON.stringify(tags)]
    );
    const total = parseInt(countRows[0].c, 10);

    const { rows } = await this.pool.query(
      `SELECT * FROM events WHERE tags @> $1::jsonb AND archived = false
       ORDER BY timestamp DESC LIMIT $2 OFFSET $3`,
      [JSON.stringify(tags), limit, offset]
    );

    return {
      results: rows.map(this.rowToEvent),
      total,
      hasMore: offset + rows.length < total,
    };
  }

  async recallByTicket(
    ticketId: string,
    limit = 20,
    offset = 0
  ): Promise<PaginatedResult<FactualEvent>> {
    if (!(await ensureDb())) return { results: [], total: 0, hasMore: false };

    const { rows: countRows } = await this.pool.query(
      "SELECT COUNT(*) AS c FROM events WHERE ticket_id = $1 AND archived = false",
      [ticketId]
    );
    const total = parseInt(countRows[0].c, 10);

    const { rows } = await this.pool.query(
      `SELECT * FROM events WHERE ticket_id = $1 AND archived = false
       ORDER BY timestamp DESC LIMIT $2 OFFSET $3`,
      [ticketId, limit, offset]
    );

    return {
      results: rows.map(this.rowToEvent),
      total,
      hasMore: offset + rows.length < total,
    };
  }

  async recallByComponent(
    component: string,
    limit = 20,
    offset = 0
  ): Promise<PaginatedResult<FactualEvent>> {
    if (!(await ensureDb())) return { results: [], total: 0, hasMore: false };

    const pattern = `%${component}%`;
    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*) AS c FROM events
       WHERE archived = false AND (
         components::text ILIKE $1 OR files::text ILIKE $1
       )`,
      [pattern]
    );
    const total = parseInt(countRows[0].c, 10);

    const { rows } = await this.pool.query(
      `SELECT * FROM events
       WHERE archived = false AND (
         components::text ILIKE $1 OR files::text ILIKE $1
       )
       ORDER BY timestamp DESC LIMIT $2 OFFSET $3`,
      [pattern, limit, offset]
    );

    return {
      results: rows.map(this.rowToEvent),
      total,
      hasMore: offset + rows.length < total,
    };
  }

  async recallSimilar(
    query: string,
    limit = 20
  ): Promise<(FactualEvent & { score: number })[]> {
    if (!(await ensureDb())) return [];

    const results = await findSimilarByText(
      this.pool,
      query,
      "events",
      limit
    );

    await this.pool.query(
      `UPDATE events SET last_accessed = NOW() WHERE id = ANY($1)`,
      [results.map((r) => r.id)]
    );

    return results.map((r) => ({
      ...this.rowToEvent(r),
      score: r.score,
    }));
  }

  async recallDecisions(
    topic: string,
    limit = 20,
    offset = 0
  ): Promise<PaginatedResult<FactualEvent>> {
    if (!(await ensureDb())) return { results: [], total: 0, hasMore: false };

    let embedding: number[];
    try {
      embedding = await embed(topic);
    } catch {
      const { rows: countRows } = await this.pool.query(
        `SELECT COUNT(*) AS c FROM events WHERE type = 'decision' AND archived = false AND summary ILIKE $1`,
        [`%${topic}%`]
      );
      const total = parseInt(countRows[0].c, 10);

      const { rows } = await this.pool.query(
        `SELECT * FROM events WHERE type = 'decision' AND archived = false AND summary ILIKE $1
         ORDER BY timestamp DESC LIMIT $2 OFFSET $3`,
        [`%${topic}%`, limit, offset]
      );

      return {
        results: rows.map(this.rowToEvent),
        total,
        hasMore: offset + rows.length < total,
      };
    }

    const results = await findSimilar(
      this.pool,
      embedding,
      "events",
      limit,
      { type: "decision" }
    );

    return {
      results: results.map(this.rowToEvent),
      total: results.length,
      hasMore: false,
    };
  }

  async getEventCount(): Promise<number> {
    if (!(await ensureDb())) return 0;
    const { rows } = await this.pool.query(
      "SELECT COUNT(*) AS c FROM events WHERE archived = false"
    );
    return parseInt(rows[0].c, 10);
  }

  async getRecentEventCount(days: number): Promise<number> {
    if (!(await ensureDb())) return 0;
    const { rows } = await this.pool.query(
      `SELECT COUNT(*) AS c FROM events WHERE archived = false AND timestamp > NOW() - INTERVAL '1 day' * $1`,
      [days]
    );
    return parseInt(rows[0].c, 10);
  }

  async prune(olderThanMonths = 24): Promise<number> {
    if (!(await ensureDb())) return 0;

    const { rowCount } = await this.pool.query(
      `UPDATE events SET archived = true
       WHERE archived = false AND timestamp < NOW() - INTERVAL '1 month' * $1`,
      [olderThanMonths]
    );
    return rowCount ?? 0;
  }

  private rowToEvent(row: any): FactualEvent {
    return {
      id: row.id,
      type: row.type,
      timestamp: row.timestamp?.toISOString?.() ?? row.timestamp,
      summary: row.summary,
      details: row.details,
      ticketId: row.ticket_id,
      prNumber: row.pr_number,
      files: row.files ?? [],
      components: row.components ?? [],
      tags: row.tags ?? [],
      author: row.author,
    };
  }
}
