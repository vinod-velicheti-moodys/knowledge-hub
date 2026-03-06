import { describe, it, expect } from "vitest";
import { loadRules } from "../../src/parsers/rules-parser.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

describe("rules-parser", () => {
  it("loads .mdc files and extracts frontmatter", () => {
    const rules = loadRules(fixturesDir);
    const rule = rules.get("sample-rule");

    expect(rule).toBeDefined();
    expect(rule!.title).toBe("sample-rule");
    expect(rule!.description).toBe("Sample rule for testing");
    expect(rule!.content).toContain("# Sample Rule");
    expect(rule!.content).toContain("## Section A");
  });

  it("returns empty map for non-existent directory", () => {
    const rules = loadRules("/non/existent/path");
    expect(rules.size).toBe(0);
  });
});
