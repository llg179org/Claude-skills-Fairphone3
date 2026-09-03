#!/usr/bin/env node
"use strict";
/**
 * PreCompact hook — dump a crash-safe status snapshot to disk.
 *
 * Why this exists: the strategic-compact plugin's own PreCompact hook only
 * stamps its ledger and toasts. Nothing in the chain ever writes a status
 * FILE. The plugin's context bands ask *the model* to save state, which means
 * a compaction that arrives without a band firing first takes the session's
 * working state with it — measured 2026-08-23 06:10, an auto-compaction at
 * 264k with bandsFired: [] and zero band injections in the transcript.
 *
 * This hook does not depend on the model noticing anything. It reads the
 * transcript that is already on disk and writes what a resumed session would
 * otherwise have to reconstruct: the last narration, the last tool calls, and
 * the token count it happened at.
 *
 * Exits 0 on every path; never blocks a compaction.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
let t = (k) => k;
try { ({ t } = require("./lang.cjs")); } catch { /* English keys as a last resort */ }

const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR
  ? process.env.CLAUDE_CONFIG_DIR
  : path.join(os.homedir(), ".claude");
const OUT_DIR = path.join(CLAUDE_HOME, ".state", "precompact-status");

const KEEP_NARRATION = 12;   // last assistant text blocks
const KEEP_TOOLS = 25;       // last tool calls
const KEEP_FILES = 40;       // snapshots retained per project dir
const MAX_SCAN_BYTES = 24 * 1024 * 1024;

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => { try { run(); } catch { /* never block */ } process.exit(0); });
setTimeout(() => process.exit(0), 8000).unref();

/** Read the tail of a file without pulling a multi-hundred-MB transcript into memory. */
function tailLines(file) {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - MAX_SCAN_BYTES);
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    // A partial first line is inevitable when we seek into the middle.
    return text.split("\n").slice(start > 0 ? 1 : 0).filter(Boolean);
  } finally {
    fs.closeSync(fd);
  }
}

function usageTokens(u) {
  if (!u || typeof u !== "object") return 0;
  return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) +
         (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
}

function collect(file) {
  const narration = [], tools = [];
  let tokens = 0, model = "unknown";

  for (const line of tailLines(file)) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const msg = rec && rec.message;
    if (!msg || msg.role !== "assistant") continue;
    if (msg.model) model = msg.model;
    const t = usageTokens(msg.usage);
    if (t) tokens = t;
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === "text" && block.text && block.text.trim()) {
        narration.push(block.text.trim());
      } else if (block.type === "tool_use") {
        const inp = block.input || {};
        const gist = inp.command || inp.file_path || inp.pattern || inp.prompt || "";
        tools.push(`${block.name}: ${String(gist).replace(/\s+/g, " ").slice(0, 160)}`);
      }
    }
  }
  return { narration: narration.slice(-KEEP_NARRATION), tools: tools.slice(-KEEP_TOOLS), tokens, model };
}

/** Keep the directory from growing one file per compaction forever. */
function gc(dir) {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "latest.md").sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_FILES))) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* raced or gone */ }
    }
  } catch { /* dir missing */ }
}

function run() {
  let data;
  try { data = JSON.parse(input); } catch { data = null; }
  if (!data) return;

  const session = String(data.session_id || "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
  const trigger = data.trigger || data.compaction_trigger || data.compaction_reason || "unknown";
  const cwd = data.cwd || process.cwd();
  const tp = data.transcript_path;

  let info = { narration: [], tools: [], tokens: 0, model: "unknown" };
  let readError = null;
  try {
    if (tp && fs.existsSync(tp)) info = collect(tp);
    else readError = `transcript not readable: ${tp}`;
  } catch (e) {
    readError = `transcript scan failed: ${e && e.message}`;
  }

  const ts = new Date().toISOString();
  const projectDir = path.join(OUT_DIR, cwd.replace(/[^A-Za-z0-9_-]/g, "_"));
  fs.mkdirSync(projectDir, { recursive: true });

  const body = [
    `# Pre-compaction status — ${ts}`,
    "",
    `- trigger: **${trigger}**`,
    `- session: \`${session}\``,
    `- cwd: \`${cwd}\``,
    `- context at compaction: **${Math.round(info.tokens / 1000)}k** tokens (${info.model})`,
    `- transcript: \`${tp || "?"}\``,
    readError ? `- ☠️ ${readError}` : null,
    "",
    "## Last narration (oldest first)",
    "",
    info.narration.length
      ? info.narration.map((n) => `> ${n.replace(/\n/g, "\n> ")}`).join("\n>\n")
      : "_(none captured)_",
    "",
    "## Last tool calls (oldest first)",
    "",
    info.tools.length ? info.tools.map((t) => `- \`${t}\``).join("\n") : "_(none captured)_",
    "",
  ].filter((l) => l !== null).join("\n");

  const stamp = ts.replace(/[:.]/g, "-");
  const file = path.join(projectDir, `${stamp}-${session.slice(0, 8)}.md`);
  fs.writeFileSync(file, body);
  fs.writeFileSync(path.join(projectDir, "latest.md"), body);
  gc(projectDir);

  // PreCompact does not support hookSpecificOutput/additionalContext in the
  // hook schema (only PreToolUse/UserPromptSubmit/PostToolUse/PostToolBatch/Stop
  // do). The snapshot file is already written above; surface the pointer via the
  // generic, always-valid `systemMessage` field instead so validation passes.
  process.stdout.write(JSON.stringify({
    systemMessage: t('precompact.written', { file }, data.cwd),
  }) + "\n");
}
