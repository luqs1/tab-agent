// The chat surface. Modules talk in semantics (say/note/activity/error), never
// raw log lines — the UI decides how that looks. Friendly by default: code and
// command detail exists but lives behind a "show details" fold.

const chat = () => document.getElementById("chat")!;

function scroll() {
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
}

function add(el: HTMLElement) {
  chat().appendChild(el);
  scroll();
  return el;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Tiny markdown: fences, inline code, bold, links. Enough for chat replies.
function md(s: string): string {
  let html = esc(s);
  // Pull fenced blocks out first, leaving a placeholder, so the inline passes
  // below never reach inside them — backticks/asterisks/links in fenced code
  // must stay literal. Restored at the end.
  const blocks: string[] = [];
  html = html.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre>${code.replace(/\n$/, "")}</pre>`);
    return `\x00${blocks.length - 1}\x00`;
  });
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/\x00(\d+)\x00/g, (_, i) => blocks[+i]);
  return html;
}

/** The dot in the "tab.agent" wordmark is the status light. */
export function status(state: "boot" | "ready" | "think") {
  document.getElementById("dot")!.className = "dot " + state;
}

/** An agent chat bubble. */
export function say(text: string) {
  const el = document.createElement("div");
  el.className = "msg agent";
  el.innerHTML = md(text);
  add(el);
}

/** The user's chat bubble. */
export function userSay(text: string) {
  const el = document.createElement("div");
  el.className = "msg user";
  el.textContent = text;
  add(el);
}

/** A shared workflow being run — on the user's behalf, but not their words. */
export function workflowSay(title: string, instructions: string) {
  const el = document.createElement("div");
  el.className = "msg wfmsg";
  const head = document.createElement("div");
  head.innerHTML = `📦 Running shared workflow: <strong>${esc(title)}</strong>`;
  const d = document.createElement("details");
  d.innerHTML = `<summary>see the steps</summary><pre>${esc(instructions)}</pre>`;
  el.append(head, d);
  add(el);
}

/** A soft centered system line ("Folder shared", …). */
export function note(text: string) {
  const el = document.createElement("div");
  el.className = "note";
  el.textContent = text;
  add(el);
}

/** A friendly error card. */
export function error(text: string) {
  const el = document.createElement("div");
  el.className = "oops";
  el.textContent = text;
  add(el);
}

/**
 * Installer consent: the agent wants to hand the user a script to run on their
 * REAL machine, outside the sandbox. File contents and MCP tool output flow
 * into context, so a malicious file could try to steer the model into minting a
 * hostile installer — show the full script and require an explicit click before
 * anything downloads. Resolves true if approved, false if declined.
 */
export function confirmInstaller(command: string, script: string): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement("section");
    el.className = "card instcard";

    const badge = document.createElement("span");
    badge.className = "wf-badge";
    badge.textContent = "⚠ Runs on your computer";

    const h = document.createElement("h2");
    h.textContent = `Download and run “${command}”?`;

    const p = document.createElement("p");
    p.textContent =
      "This script runs on your real machine, outside my sandbox — read it through, " +
      "and only download it if every line looks right to you.";

    const pre = document.createElement("pre");
    pre.style.cssText =
      "font-family:ui-monospace,Menlo,monospace;font-size:12.5px;background:#f4efe5;border-radius:10px;padding:12px;max-height:260px;overflow:auto;white-space:pre-wrap";
    pre.textContent = script; // never innerHTML — script is model/file-influenced

    const row = document.createElement("div");
    row.className = "step";
    const ok = document.createElement("button");
    ok.className = "primary";
    ok.textContent = "Download it";
    const no = document.createElement("button");
    no.className = "ghost";
    no.textContent = "No thanks";
    row.append(ok, no);

    el.append(badge, h, p, pre, row);
    add(el);

    const finish = (approved: boolean) => {
      row.remove();
      const status = document.createElement("p");
      status.style.color = approved ? "var(--ok)" : "var(--muted)";
      status.textContent = approved
        ? "✓ Downloaded — it's in your Downloads folder."
        : "Declined — nothing was downloaded.";
      el.appendChild(status);
      resolve(approved);
    };
    ok.addEventListener("click", () => finish(true));
    no.addEventListener("click", () => finish(false));
  });
}

/**
 * "What I'm doing right now" — a small line with a spinner and, optionally,
 * the real code/command behind a "show details" fold. Returns a function to
 * call when the work finishes (spinner becomes a check).
 */
export function activity(label: string, detail?: string): () => void {
  const el = document.createElement("div");
  el.className = "doing";
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<span class="tick"></span><span>${esc(label)}</span>`;
  el.appendChild(row);
  if (detail) {
    const d = document.createElement("details");
    d.innerHTML = `<summary>show the details</summary><pre>${esc(detail)}</pre>`;
    el.appendChild(d);
  }
  add(el);
  return () => el.classList.add("done");
}

/** A note whose text keeps updating in place (download progress etc.). */
export function progressNote(): (text: string) => void {
  const el = document.createElement("div");
  el.className = "note";
  add(el);
  return (text) => {
    el.textContent = text;
  };
}

let typingEl: HTMLElement | null = null;

/** The three hopping dots while the agent is deciding what to say. */
export function thinking(on: boolean) {
  if (on && !typingEl) {
    typingEl = document.createElement("div");
    typingEl.className = "typing";
    typingEl.innerHTML = "<i></i><i></i><i></i>";
    add(typingEl);
  } else if (!on && typingEl) {
    typingEl.remove();
    typingEl = null;
  }
}

export function onClick(id: string, fn: () => void) {
  document.getElementById(id)!.addEventListener("click", fn);
}

export function inputValue(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value;
}

/** Show/hide the onboarding card and the folder chip. */
export function showOnboard(show: boolean) {
  const card = document.getElementById("onboard") as HTMLElement;
  card.hidden = !show;
  if (show) {
    chat().appendChild(card); // keep it in conversation flow, not pinned to the top
    scroll();
  }
}

export function showFolderChip(name: string) {
  const chip = document.getElementById("folder-chip")!;
  chip.textContent = "📂 " + name;
  (chip as HTMLElement).hidden = false;
  document.getElementById("pick")!.textContent = "📁 Change folder";
}
