import { API_URL_DEFAULT, buildHostedConfig, type HttpMcpServerEntry } from "./config.js";

type Action = "context" | "update";

export async function runTask(
  action: Action,
  opts: { apiUrl?: string; token?: string; runtimeKey?: string; input?: unknown },
) {
  const config = buildHostedConfig(opts.apiUrl ?? API_URL_DEFAULT, opts.token ?? "", opts.runtimeKey ?? "");
  const server = config.mcpServers.clawpanel as HttpMcpServerEntry;
  const response = await fetch(server.url, {
    method: "POST",
    headers: { ...server.headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: action === "context" ? "task_sop_context" : "task_sop_update",
        arguments: opts.input ?? {},
      },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {
    throw new Error("ClawPanel could not be reached. Check the API URL and try again.");
  });
  if (response.status === 401) throw new Error("The ClawPanel connection was rejected. Check both credentials or create a new connection.");
  if (response.status === 402) throw new Error("The workplace has no API credit remaining.");
  if (!response.ok) throw new Error(`ClawPanel returned HTTP ${response.status}.`);

  const rpc = await response.json().catch(() => null) as {
    result?: { isError?: boolean; content?: { type?: string; text?: string }[]; structuredContent?: unknown };
  } | null;
  if (rpc?.result?.isError) {
    const message = rpc.result.content?.find((item) => item?.type === "text")?.text;
    throw new Error(typeof message === "string" ? message.slice(0, 500) : "ClawPanel rejected the task request.");
  }
  const output = rpc?.result?.structuredContent;
  if (!output || typeof output !== "object") throw new Error("The response did not contain a task result. Check that this connection supports the task SOP.");
  return output;
}

export async function readTaskUpdate(input: AsyncIterable<Buffer | string>): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > 32_768) throw new Error("The task update exceeds the 32 KB input limit.");
    chunks.push(bytes);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The task update must be a JSON object.");
  return value;
}
