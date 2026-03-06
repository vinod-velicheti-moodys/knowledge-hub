import type pg from "pg";
import { embed, vectorLiteral } from "./embeddings.js";

export interface SimilarityResult {
  id: string;
  score: number;
  [key: string]: unknown;
}

export async function findSimilar(
  pool: pg.Pool,
  queryEmbedding: number[],
  table: string,
  topK: number,
  filters?: { type?: string; tags?: string[]; archived?: boolean }
): Promise<SimilarityResult[]> {
  const conditions: string[] = ["embedding IS NOT NULL"];
  const params: unknown[] = [vectorLiteral(queryEmbedding)];
  let paramIdx = 2;

  if (filters?.archived !== undefined) {
    conditions.push(`archived = $${paramIdx++}`);
    params.push(filters.archived);
  } else {
    conditions.push("archived = false");
  }

  if (filters?.type) {
    conditions.push(`type = $${paramIdx++}`);
    params.push(filters.type);
  }

  if (filters?.tags?.length) {
    conditions.push(`tags @> $${paramIdx++}::jsonb`);
    params.push(JSON.stringify(filters.tags));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(topK);
  const sql = `
    SELECT *, 1 - (embedding <=> $1::vector) AS score
    FROM ${table}
    ${where}
    ORDER BY embedding <=> $1::vector
    LIMIT $${paramIdx}
  `;

  const result = await pool.query(sql, params);
  return result.rows;
}

export async function findSimilarByText(
  pool: pg.Pool,
  queryText: string,
  table: string,
  topK: number,
  filters?: { type?: string; tags?: string[] }
): Promise<SimilarityResult[]> {
  const queryEmbedding = await embed(queryText);
  return findSimilar(pool, queryEmbedding, table, topK, filters);
}
