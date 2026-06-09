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
  html = html.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, code) => `<pre>${code.replace(/\n$/, "")}</pre>`);
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
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
