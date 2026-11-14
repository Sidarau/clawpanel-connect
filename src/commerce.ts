export const marketUrl = "https://zeuglab.com/contact";
export const partnerUrl = "https://partner.clawpanel.app";
const codePattern = /^[a-f0-9]{32}$/;

export function marketplace(action: "buy" | "sell") {
  return {
    action, url: marketUrl, creatorSharePercent: 50,
    handoff: action === "buy"
      ? "Tell Zeug Lab what you want the workflow or skill to do."
      : "Share the outcome, requirements, example output, and proposed price. ClawPanel and the creator split the sale 50/50.",
  };
}

export function partner(action: "dashboard" | "share", code?: unknown) {
  if (action === "dashboard") return { url: partnerUrl, handoff: "Sign in to see your link, verified installs, paying clients, and earnings." };
  if (typeof code !== "string" || !codePattern.test(code)) throw new Error("Use the 32-character referral code from your ClawPanel partner dashboard.");
  const url = `https://clawpanel.app/refer/${code}`;
  return { url, shareText: `Try ClawPanel for your team: ${url}. I may earn a commission if you make a purchase through my referral.` };
}

export function commerceCommand(argv: string[]) {
  const [group, action, ...flags] = argv;
  const json = flags.includes("--json");
  const args = flags.filter(flag => flag !== "--json");
  if (group === "marketplace" && (action === "buy" || action === "sell") && !args.length) return { json, data: marketplace(action) };
  if (group === "credits" && action === "open" && !args.length) {
    return { json, data: { url: "https://clawpanel.app/pricing", handoff: "Compare workflow options and choose a prepaid pack. Sign in before checkout." } };
  }
  if (group === "starter" && action === "open" && !args.length) {
    return { json, data: { url: "https://clawpanel.app/dashboard#usage-billing", handoff: "Sign in to use ClawPanel Assistant and see your prepaid credit balance." } };
  }
  if (group === "partner" && action === "dashboard" && !args.length) return { json, data: partner(action) };
  if (group === "partner" && action === "share" && args.length === 2 && args[0] === "--code") return { json, data: partner(action, args[1]) };
  throw new Error("Use marketplace buy|sell, credits open, starter open, partner dashboard, or partner share --code CODE. Add --json for structured output.");
}
