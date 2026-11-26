import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { assignedWorkDoctor, workEnrollmentDoctor } from "./assigned-work.js";

type Provider = "claude" | "hermes";
type ProviderStatus = "verified" | "unchecked" | "unconfirmed" | "signed_out" | "missing";
type Options = { config?: string; provider?: Provider; hermesProbe?: string };

export function workReadinessOptions(flags: Record<string, string | boolean>): Options {
  const provider = flags.provider;
  const hermesProbe = flags["hermes-probe"];
  if (Object.keys(flags).some((key) => !["config", "json", "provider", "hermes-probe"].includes(key))
      || (flags.json !== undefined && flags.json !== true)
      || (flags.config !== undefined && (typeof flags.config !== "string" || !flags.config))
      || (provider !== undefined && provider !== "claude" && provider !== "hermes")
      || (hermesProbe !== undefined && (provider !== "hermes" || typeof hermesProbe !== "string"
        || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/health\/provider$/.test(hermesProbe) || !URL.canParse(hermesProbe)))) {
    throw new Error("Use clawpanel work doctor [--config FILE] [--provider claude|hermes] [--hermes-probe LOOPBACK_URL] [--json].");
  }
  return { config: flags.config, provider, hermesProbe };
}

async function checkClaude(env: NodeJS.ProcessEnv): Promise<ProviderStatus> {
  const installed = join(homedir(), ".local", "bin", "claude");
  const executable = await access(installed, constants.X_OK).then(() => installed, () => "claude");
  return new Promise((resolve) => {
    execFile(executable, ["auth", "status"], {
      env: { HOME: homedir(), PATH: env.PATH ?? "/usr/bin:/bin" }, timeout: 5000, maxBuffer: 64 * 1024,
    }, (error, stdout) => {
      if (error?.code === "ENOENT") return resolve("missing");
      try {
        const result = JSON.parse(stdout);
        if (result?.loggedIn === false) return resolve("signed_out");
        if (!error && result?.loggedIn === true && result.apiProvider === "firstParty"
            && ["claude.ai", "console"].includes(result.authMethod)) return resolve("verified");
      } catch { /* Provider diagnostics are never included in the report. */ }
      resolve("unconfirmed");
    });
  });
}

async function checkProvider(options: Options, env: NodeJS.ProcessEnv): Promise<ProviderStatus> {
  if (options.provider === "claude") return checkClaude(env);
  if (!options.hermesProbe) return "unchecked";
  try {
    const response = await fetch(options.hermesProbe, { signal: AbortSignal.timeout(5000), redirect: "error" });
    const size = Number(response.headers.get("content-length"));
    if (!response.ok || !(size > 0 && size <= 4096)) {
      await response.body?.cancel();
      return "unconfirmed";
    }
    const result: unknown = await response.json();
    return typeof result === "object" && result !== null && "provider" in result && result.provider === "hermes"
      && "authenticated" in result && result.authenticated === true ? "verified" : "unconfirmed";
  } catch {
    return "unconfirmed";
  }
}

const providerRecovery = {
  unchecked: "Supply the Hermes runner's local authenticated provider probe to verify the model connection.",
  missing: "Install Claude Code on this runner.",
  signed_out: "Sign Claude Code in on this runner and rerun Work Doctor.",
  unconfirmed: "Check the selected provider's authentication on this runner.",
};

export async function workReadinessDoctor(options: Options, env: NodeJS.ProcessEnv, executable?: string) {
  const [work, provider] = await Promise.all([
    options.config ? workEnrollmentDoctor(options.config, executable) : assignedWorkDoctor(env, executable),
    checkProvider(options, env),
  ]);
  const ready = ("configured" in work ? work.configured : work.ready) && (!options.provider || provider === "verified");
  const issueAccess = work.checks.assignedIssue;
  const verified = issueAccess === "verified";
  const checkedScope = verified ? "verified" as const : issueAccess === "unchecked" ? "unchecked" as const : "unconfirmed" as const;
  const actorEnrollment = verified ? "verified" as const
    : issueAccess === "enrollment_refused" ? "enrollment_refused" as const : "unchecked" as const;
  const nextAction = options.provider && provider !== "verified" ? providerRecovery[provider] : work.nextAction;
  return { ...work, ready, checks: { ...work.checks, provider, actorEnrollment,
    projectGrant: checkedScope, activeAssignment: checkedScope }, ...(nextAction ? { nextAction } : {}) };
}
