import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { skillsCommand } from "../src/skills.js";

it("syncs the first-party catalog, reads an installed workflow, and preserves local edits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clawpanel-skills-"));
  try {
    await expect(skillsCommand(["run", "analytics-dashboard"], dir)).rejects.toThrow("skills sync");
    await expect(skillsCommand(["sync"], dir)).resolves.toContain("11 ClawPanel skills");
    await expect(skillsCommand(["sync"], dir)).resolves.toContain("11 ClawPanel skills");
    await expect(skillsCommand(["run", "analytics-dashboard"], dir)).resolves.toContain("reconcile totals");
    await expect(skillsCommand(["run", "../outside"], dir)).rejects.toThrow("Unknown skill");
    const path = join(dir, ".clawpanel", "skills", "clawpanel-analytics-dashboard.md");
    await writeFile(path, "local edit");
    await expect(skillsCommand(["sync"], dir)).rejects.toThrow("Preserved modified file");
    expect(await readFile(path, "utf8")).toBe("local edit");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
