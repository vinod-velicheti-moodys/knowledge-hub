import type { Session } from "./short-term.js";
import type { FactualMemory } from "./factual.js";
import type { LongTermMemory } from "./long-term.js";
import { config } from "../config.js";

export async function promoteFromSession(
  session: Session,
  factual: FactualMemory,
  longTerm: LongTermMemory
): Promise<{ eventsCreated: number; patternsPromoted: number; pitfallsPromoted: number }> {
  let eventsCreated = 0;
  let patternsPromoted = 0;
  let pitfallsPromoted = 0;

  try {
    await factual.recordEvent({
      type: "feature",
      summary: `${session.taskId}: ${session.summary}`,
      details: [
        `Developer: ${session.developer}`,
        `Phase completed: ${session.currentPhase}`,
        `Decisions made: ${session.decisions.length}`,
        `Attempts: ${session.attempts.length} (${session.attempts.filter((a) => a.outcome === "failed").length} failed)`,
        "",
        ...session.decisions.map((d) => `- Decision: ${d.what} (${d.why})`),
      ].join("\n"),
      ticketId: session.ticket?.id,
      files: session.modifiedFiles,
      tags: [session.currentPhase, "task-completion"],
      author: session.developer,
    });
    eventsCreated++;
  } catch (err) {
    console.error("[promotion] Failed to create session summary event:", err);
  }

  const threshold = config.similarityThreshold;

  for (const attempt of session.attempts.filter((a) => a.outcome === "failed")) {
    try {
      const existingPitfall = await longTerm.findSimilarPitfall(
        attempt.action,
        threshold
      );

      if (existingPitfall) {
        await longTerm.incrementPitfall(existingPitfall.id);
        pitfallsPromoted++;
      } else {
        const successfulFollow = session.attempts.find(
          (a) =>
            a.outcome === "success" &&
            new Date(a.timestamp) > new Date(attempt.timestamp)
        );

        if (successfulFollow) {
          await longTerm.addPitfall({
            mistake: attempt.action,
            fix: successfulFollow.action,
            tags: session.ticket?.id ? [session.ticket.id] : [],
            author: session.developer,
          });
          pitfallsPromoted++;
        }
      }
    } catch (err) {
      console.error("[promotion] Failed to promote pitfall:", err);
    }
  }

  for (const decision of session.decisions) {
    try {
      const existingPattern = await longTerm.findSimilarPattern(
        `${decision.what} ${decision.why}`,
        threshold
      );

      if (existingPattern) {
        await longTerm.reinforcePattern(existingPattern.id, session.sessionId);
        patternsPromoted++;
      } else {
        await longTerm.addPattern({
          pattern: `${decision.what} — ${decision.why}`,
          category: "best-practice",
          confidence: 0.3,
          sources: [session.sessionId],
          author: session.developer,
        });
        patternsPromoted++;
      }
    } catch (err) {
      console.error("[promotion] Failed to promote pattern:", err);
    }
  }

  console.error(
    `[promotion] Session ${session.taskId}: ${eventsCreated} events, ${patternsPromoted} patterns, ${pitfallsPromoted} pitfalls`
  );

  return { eventsCreated, patternsPromoted, pitfallsPromoted };
}
