import type pg from "pg";
import { v4 as uuid } from "uuid";
import { isDbAvailable, ensureDb } from "./db.js";

export interface Session {
  sessionId: string;
  taskId: string;
  summary: string;
  ticket?: { id: string; summary: string; acceptanceCriteria: string[] };
  currentPhase: "planning" | "development" | "testing" | "review";
  activeFiles: string[];
  modifiedFiles: string[];
  decisions: { what: string; why: string; timestamp: string }[];
  attempts: {
    action: string;
    outcome: "success" | "failed";
    reason?: string;
    timestamp: string;
  }[];
  findings: { key: string; value: unknown }[];
  reusabilityMatrix: {
    needed: string;
    existingMatch: string | null;
    decision: string;
    justification: string;
  }[];
  developer: string;
  status: "active" | "completed";
  startedAt: string;
  lastActivity: string;
}

export class ShortTermMemory {
  private pool: pg.Pool;
  private developer: string;
  private cache: Session | null = null;

  constructor(pool: pg.Pool, developer: string) {
    this.pool = pool;
    this.developer = developer;
  }

  async startSession(
    taskId: string,
    summary: string,
    ticket?: { id: string; summary: string; acceptanceCriteria: string[] }
  ): Promise<Session> {
    // Validate taskId is never null/undefined/empty
    if (!taskId || taskId.trim() === "") {
      throw new Error("taskId cannot be null or empty. Check that auto-generation worked correctly.");
    }

    const existing = await this.getActiveSession();
    if (existing) {
      throw new Error(
        `Active session already exists for task "${existing.taskId}". ` +
          `Call task_end first, or task_recover to resume.`
      );
    }

    const session: Session = {
      sessionId: uuid(),
      taskId,
      summary,
      ticket,
      currentPhase: "planning",
      activeFiles: [],
      modifiedFiles: [],
      decisions: [],
      attempts: [],
      findings: [],
      reusabilityMatrix: [],
      developer: this.developer,
      status: "active",
      startedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };

    this.cache = session;
    await this.flush(session);
    return session;
  }

  async getActiveSession(): Promise<Session | null> {
    if (this.cache?.status === "active") return this.cache;

    if (!(await ensureDb())) return null;

    const { rows } = await this.pool.query(
      `SELECT * FROM sessions WHERE developer = $1 AND status = 'active' ORDER BY last_activity DESC LIMIT 1`,
      [this.developer]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    const session = this.rowToSession(row);
    this.cache = session;
    return session;
  }

  async addDecision(what: string, why: string): Promise<void> {
    const session = await this.requireActive();
    if (!what || what.trim() === "") {
      throw new Error("Decision 'what' cannot be empty");
    }
    if (!why || why.trim() === "") {
      throw new Error("Decision 'why' cannot be empty");
    }
    session.decisions.push({
      what: what.trim(),
      why: why.trim(),
      timestamp: new Date().toISOString(),
    });
    session.lastActivity = new Date().toISOString();
    await this.flush(session);
  }

  async addAttempt(
    action: string,
    outcome: "success" | "failed",
    reason?: string
  ): Promise<void> {
    const session = await this.requireActive();
    session.attempts.push({
      action,
      outcome,
      reason,
      timestamp: new Date().toISOString(),
    });
    session.lastActivity = new Date().toISOString();
    await this.flush(session);
  }

  async addFinding(key: string, value: unknown): Promise<void> {
    const session = await this.requireActive();
    const existing = session.findings.findIndex((f) => f.key === key);
    if (existing >= 0) {
      session.findings[existing].value = value;
    } else {
      session.findings.push({ key, value });
    }
    session.lastActivity = new Date().toISOString();
    await this.flush(session);
  }

  async setPhase(
    phase: "planning" | "development" | "testing" | "review"
  ): Promise<void> {
    const session = await this.requireActive();
    session.currentPhase = phase;
    session.lastActivity = new Date().toISOString();
    await this.flush(session);
  }

  async endSession(): Promise<Session> {
    const session = await this.requireActive();
    session.status = "completed";
    session.lastActivity = new Date().toISOString();
    await this.flush(session);
    this.cache = null;
    return session;
  }

  async recoverSession(taskId?: string): Promise<Session | null> {
    if (!(await ensureDb())) return null;

    let query: string;
    let params: unknown[];

    if (taskId) {
      query = `SELECT * FROM sessions WHERE developer = $1 AND task_id = $2 AND status = 'active' LIMIT 1`;
      params = [this.developer, taskId];
    } else {
      query = `SELECT * FROM sessions WHERE developer = $1 AND status = 'active' ORDER BY last_activity DESC LIMIT 1`;
      params = [this.developer];
    }

    const { rows } = await this.pool.query(query, params);
    if (rows.length === 0) return null;

    const session = this.rowToSession(rows[0]);
    this.cache = session;
    return session;
  }

  async getConflicts(
    files?: string[]
  ): Promise<{ developer: string; taskId: string; conflictingFiles: string[] }[]> {
    if (!(await ensureDb())) return [];

    const session = this.cache;
    const filesToCheck = files ?? session?.activeFiles ?? [];
    if (filesToCheck.length === 0) return [];

    const { rows } = await this.pool.query(
      `SELECT developer, task_id, active_files FROM sessions
       WHERE status = 'active' AND developer != $1`,
      [this.developer]
    );

    const conflicts: {
      developer: string;
      taskId: string;
      conflictingFiles: string[];
    }[] = [];

    for (const row of rows) {
      const otherFiles = row.active_files as string[];
      const overlap = filesToCheck.filter((f) => otherFiles.includes(f));
      if (overlap.length > 0) {
        conflicts.push({
          developer: row.developer,
          taskId: row.task_id,
          conflictingFiles: overlap,
        });
      }
    }

    return conflicts;
  }

  async getSessionCount(): Promise<number> {
    if (!(await ensureDb())) return 0;
    const { rows } = await this.pool.query(
      "SELECT COUNT(*) AS c FROM sessions WHERE status = 'active'"
    );
    return parseInt(rows[0].c, 10);
  }

  async getActiveDevelopers(): Promise<string[]> {
    if (!(await ensureDb())) return [];
    const { rows } = await this.pool.query(
      "SELECT DISTINCT developer FROM sessions WHERE status = 'active'"
    );
    return rows.map((r) => r.developer);
  }

  private async requireActive(): Promise<Session> {
    const session = await this.getActiveSession();
    if (!session) throw new Error("No active task session. Call task_start first.");
    return session;
  }

  private async flush(session: Session): Promise<void> {
    if (!(await ensureDb())) return;

    await this.pool.query(
      `INSERT INTO sessions (
        session_id, task_id, summary, ticket_id, current_phase,
        active_files, modified_files, decisions, attempts, findings,
        reusability_matrix, developer, status, started_at, last_activity
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (session_id) DO UPDATE SET
        current_phase = $5,
        active_files = $6,
        modified_files = $7,
        decisions = $8,
        attempts = $9,
        findings = $10,
        reusability_matrix = $11,
        status = $13,
        last_activity = $15`,
      [
        session.sessionId,
        session.taskId,
        session.summary,
        session.ticket?.id ?? null,
        session.currentPhase,
        JSON.stringify(session.activeFiles),
        JSON.stringify(session.modifiedFiles),
        JSON.stringify(session.decisions),
        JSON.stringify(session.attempts),
        JSON.stringify(session.findings),
        JSON.stringify(session.reusabilityMatrix),
        session.developer,
        session.status,
        session.startedAt,
        session.lastActivity,
      ]
    );
  }

  private rowToSession(row: any): Session {
    // Parse JSON fields from database
    const decisions = Array.isArray(row.decisions) 
      ? row.decisions 
      : (typeof row.decisions === 'string' ? JSON.parse(row.decisions) : []);
    
    const attempts = Array.isArray(row.attempts)
      ? row.attempts
      : (typeof row.attempts === 'string' ? JSON.parse(row.attempts) : []);
    
    const findings = Array.isArray(row.findings)
      ? row.findings
      : (typeof row.findings === 'string' ? JSON.parse(row.findings) : []);
    
    const activeFiles = Array.isArray(row.active_files)
      ? row.active_files
      : (typeof row.active_files === 'string' ? JSON.parse(row.active_files) : []);
    
    const modifiedFiles = Array.isArray(row.modified_files)
      ? row.modified_files
      : (typeof row.modified_files === 'string' ? JSON.parse(row.modified_files) : []);
    
    const reusabilityMatrix = Array.isArray(row.reusability_matrix)
      ? row.reusability_matrix
      : (typeof row.reusability_matrix === 'string' ? JSON.parse(row.reusability_matrix) : []);

    return {
      sessionId: row.session_id,
      taskId: row.task_id,
      summary: row.summary,
      ticket: row.ticket_id ? { id: row.ticket_id, summary: "", acceptanceCriteria: [] } : undefined,
      currentPhase: row.current_phase,
      activeFiles,
      modifiedFiles,
      decisions,
      attempts,
      findings,
      reusabilityMatrix,
      developer: row.developer,
      status: row.status,
      startedAt: row.started_at?.toISOString?.() ?? row.started_at,
      lastActivity: row.last_activity?.toISOString?.() ?? row.last_activity,
    };
  }
}
