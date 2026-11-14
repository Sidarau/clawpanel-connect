import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const skills = [
  ["analytics-dashboard", "Analytics Dashboard", "Build an analytics dashboard from the data in your warehouse.",
    "Identify the business question, available warehouse tables, grain, and metric definitions. Use authorized read-only queries. Check missing data, time zones, and duplicated joins. Propose the layout, build it in the agreed tool, then reconcile totals to the source and hand off a reproducible query."],
  ["seo", "SEO", "Audit your site, research keywords, and draft or refresh articles.",
    "Inventory public pages. Check crawlability, titles, internal links, and page intent. Map search terms to pages. Prioritize fixes and draft updates grounded in the website and reliable sources. Get approval before editing the live site."],
  ["google-ads", "Google Ads", "Review spend and prepare budget, keyword, and search-term recommendations.",
    "Read authorized campaign and conversion data. Check tracking and date windows. Compare spend and conversion value, flag costly queries, and propose budget or keyword changes with supporting numbers. Do not change live campaigns without approval."],
  ["cold-email", "Cold email", "Build an outreach playbook and draft replies for review.",
    "Use the authorized campaign, audience and opt-out list. Draft short messages tied to a real reason to reach out. Check the sender identity and opt-out handling. Stop before sending or scheduling unless the user authorizes the specific action."],
  ["post-to-video", "Post to video", "Turn an X or LinkedIn post into a short motion graphics video.",
    "Get the source post and permission to reuse its content. Write a compact storyboard with on-screen text, beats and shot lengths. Select licensed audio and render if an authorized video tool is available. Check captions and hand off the export."],
  ["linkedin-engagers", "LinkedIn engagers", "Organize authorized engagement records and verify permitted work contacts.",
    "Use an authorized export or connector; respect access limits. Deduplicate profiles, distinguish verified work addresses from guesses, and exclude opt-outs. Document the provenance of the resulting list. Do not send outreach."],
  ["post-engagers", "Post engagers", "Build a team view of people who reacted to or commented on a post.",
    "Use an authorized post or engagement export. Normalize reactions and comments, deduplicate by profile, and keep source URLs and collection dates. Keep contact data limited to permitted work addresses. Ask before enabling recurring tracking."],
  ["enrichment-tables", "Enrichment tables", "Enrich a lead list and export the results as CSV.",
    "Start with the supplied lead list and requested columns. Use approved tools and permitted business contact data. Deduplicate, label unknown or unverified fields, record sources, and return a CSV with an example row and field definitions."],
  ["static-ads", "Static ads", "Create static Meta ads for angles a brand’s current campaigns miss.",
    "Review the brand site and current ads using available authorized sources. Identify underserved buyer questions and offers. Draft distinct concepts with copy, evidence, visual direction and placements. Tell the user which source supports each claim. Use an approved image tool if available. Do not launch ads."],
  ["ugc-video", "UGC video", "Turn a script into a finished vertical talking-head ad.",
    "Obtain the script, offer, usage rights and consent for any avatar or synthetic voice. Prepare a vertical shot with captions, render through an authorized provider, and check names, key claims and every scripted line. Hand off the file for approval."],
  ["ugc-studio", "UGC studio", "Set up a repeatable workflow for testing and rendering batches of video ads.",
    "Define the approved script, avatar, and format options. Build a small batch manifest and a review step for voice permissions, word timing, captions and claims. Render only after the batch, provider and cost are approved. Keep the drafts and review notes together."],
] as const;

function markdown(skill: (typeof skills)[number]) {
  const [id, title, description, directions] = skill;
  return `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${title}\n\n${directions}\n\nAsk for missing project context or required access. Give the user the result, sources, and next step.\n`;
}

export async function skillsCommand(args: string[], workspace = process.cwd()): Promise<string> {
  const [action, id, ...extra] = args;
  if (action === "list" && !id) return skills.map(([slug, name, description]) => `${slug}\t${name}\t${description}`).join("\n");
  const folder = resolve(workspace, ".clawpanel", "skills");
  if (action === "sync" && !id) {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    for (const skill of skills) {
      const path = resolve(folder, `clawpanel-${skill[0]}.md`);
      const content = markdown(skill);
      try { await writeFile(path, content, { flag: "wx", mode: 0o600 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await readFile(path, "utf8") !== content) throw new Error(`Preserved modified file: ${path}. Move it aside before syncing.`);
      }
    }
    return `Available: ${skills.length} ClawPanel skills in ${folder}. Use clawpanel skills run <name> for the selected playbook.`;
  }
  if (action === "run" && id && !extra.length) {
    const skill = skills.find(([slug]) => slug === id);
    if (!skill) throw new Error("Unknown skill. Run clawpanel skills list.");
    const path = resolve(folder, `clawpanel-${skill[0]}.md`);
    const installed = await readFile(path, "utf8").catch(() => { throw new Error("Run clawpanel skills sync in this project first."); });
    if (installed !== markdown(skill)) throw new Error("Installed skill differs from the bundled playbook. Review it before continuing.");
    return installed.trimEnd();
  }
  throw new Error("Use clawpanel skills list, skills sync, or skills run <name>.");
}
