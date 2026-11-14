import { spawn } from "node:child_process";

const url = "https://workspace.clawpanel.app/auth";
export function openSignIn({ printOnly = false } = {}) {
  if (!printOnly) {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    const browser = spawn(command, [url], { detached: true, stdio: "ignore", windowsHide: true });
    browser.on("error", () => {});
    browser.unref();
  }
  return `Sign in to ClawPanel in your browser: ${url}\nIf the skill needs a hosted workspace, connect your AI client using Workspace → Connect after signing in. This command does not store your browser session.`;
}
