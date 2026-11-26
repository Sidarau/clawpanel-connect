import { afterEach, describe, expect, it, vi } from "vitest";
import { assignedWorkDoctor, workEnrollmentDoctor } from "../src/mcp/assigned-work.js";
import { workReadinessDoctor, workReadinessOptions } from "../src/mcp/work-readiness.js";

vi.mock("../src/mcp/assigned-work.js", () => ({ assignedWorkDoctor: vi.fn(), workEnrollmentDoctor: vi.fn() }));

const probe = "http://127.0.0.1:8765/health/provider";
const access = { launcher: "ready", binding: "present", assignedIssue: "verified" } as const;

describe("Work readiness", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("checks the authenticated provider and the signed scope without emitting payloads", async () => {
    vi.mocked(assignedWorkDoctor).mockResolvedValue({ ready: true, checks: access });
    const data = JSON.stringify({ provider: "hermes", authenticated: true, unrelated: "secret-fixture" });
    const fetch = vi.fn().mockResolvedValue(new Response(data, { headers: { "content-length": String(data.length) } }));
    vi.stubGlobal("fetch", fetch);
    const report = await workReadinessDoctor(workReadinessOptions({ provider: "hermes", "hermes-probe": probe }), {});
    expect(fetch).toHaveBeenCalledWith(probe, expect.objectContaining({ redirect: "error" }));
    expect(report).toMatchObject({ ready: true, checks: {
      provider: "verified", actorEnrollment: "verified", projectGrant: "verified", activeAssignment: "verified",
    } });
    expect(JSON.stringify(report)).not.toContain("secret-fixture");
  });

  it("preserves the shared refusal and keeps preflight separate from live authorization", async () => {
    vi.mocked(assignedWorkDoctor).mockResolvedValue({ ready: false, checks: { ...access, assignedIssue: "run_or_grant_refused" } });
    expect(await workReadinessDoctor({}, {})).toMatchObject({ ready: false, checks: {
      provider: "unchecked", projectGrant: "unconfirmed", activeAssignment: "unconfirmed",
    } });
    vi.mocked(workEnrollmentDoctor).mockResolvedValue({ configured: true,
      checks: { launcher: "ready", enrollment: "verified", assignedIssue: "unchecked" }, nextAction: "Check the run." });
    expect(await workReadinessDoctor({ config: "/fixture/work.json", provider: "hermes" }, {})).toMatchObject({
      configured: true, ready: false, checks: { provider: "unchecked", enrollment: "verified", projectGrant: "unchecked", activeAssignment: "unchecked" },
    });
    expect(() => workReadinessOptions({ provider: "hermes", "hermes-probe": "https://other.example/health/provider" })).toThrow(/doctor/);
  });
});
