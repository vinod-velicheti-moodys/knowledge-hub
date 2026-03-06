import { describe, it, expect, vi } from "vitest";
import { promoteFromSession } from "../../src/memory/promotion.js";
import type { Session } from "../../src/memory/short-term.js";

vi.mock("../../src/config.js", () => ({
  config: {
    similarityThreshold: 0.85,
  },
}));

function createMockSession(overrides?: Partial<Session>): Session {
  return {
    sessionId: "sess-123",
    taskId: "TIM-999",
    summary: "Test task for unit test",
    currentPhase: "development",
    activeFiles: ["file-a.ts"],
    modifiedFiles: ["file-a.ts"],
    decisions: [
      {
        what: "Used composition API for new component",
        why: "Better reactivity and type inference",
        timestamp: new Date().toISOString(),
      },
    ],
    attempts: [
      {
        action: "Tried direct Vuex state mutation",
        outcome: "failed",
        reason: "Mutations must use commit()",
        timestamp: new Date(Date.now() - 60000).toISOString(),
      },
      {
        action: "Used commit() for state mutations",
        outcome: "success",
        timestamp: new Date().toISOString(),
      },
    ],
    findings: [],
    reusabilityMatrix: [],
    developer: "test-dev",
    status: "completed",
    startedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    ...overrides,
  };
}

describe("promotion pipeline", () => {
  it("creates events from session data", async () => {
    const recordedEvents: any[] = [];
    const factual = {
      recordEvent: vi.fn().mockImplementation(async (ev) => {
        recordedEvents.push(ev);
        return "evt-1";
      }),
    } as any;

    const longTerm = {
      findSimilarPitfall: vi.fn().mockResolvedValue(null),
      addPitfall: vi.fn().mockResolvedValue("pit-1"),
      incrementPitfall: vi.fn(),
      findSimilarPattern: vi.fn().mockResolvedValue(null),
      addPattern: vi.fn().mockResolvedValue("pat-1"),
      reinforcePattern: vi.fn(),
    } as any;

    const session = createMockSession();
    const result = await promoteFromSession(session, factual, longTerm);

    expect(result.eventsCreated).toBe(1);
    expect(result.patternsPromoted).toBeGreaterThanOrEqual(1);
    expect(result.pitfallsPromoted).toBeGreaterThanOrEqual(1);

    expect(factual.recordEvent).toHaveBeenCalledOnce();
    expect(longTerm.addPitfall).toHaveBeenCalledOnce();
    expect(longTerm.addPattern).toHaveBeenCalledOnce();
  });

  it("reinforces existing patterns instead of creating new ones", async () => {
    const factual = {
      recordEvent: vi.fn().mockResolvedValue("evt-1"),
    } as any;

    const longTerm = {
      findSimilarPitfall: vi.fn().mockResolvedValue(null),
      addPitfall: vi.fn().mockResolvedValue("pit-1"),
      findSimilarPattern: vi.fn().mockResolvedValue({
        id: "existing-pattern",
        score: 0.92,
        pattern: "Similar existing pattern",
        category: "best-practice",
        confidence: 0.5,
        occurrences: 3,
      }),
      reinforcePattern: vi.fn(),
      addPattern: vi.fn(),
    } as any;

    const session = createMockSession();
    await promoteFromSession(session, factual, longTerm);

    expect(longTerm.reinforcePattern).toHaveBeenCalledWith(
      "existing-pattern",
      "sess-123"
    );
    expect(longTerm.addPattern).not.toHaveBeenCalled();
  });
});
