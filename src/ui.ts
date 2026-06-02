// Tiny UI helpers so the other modules don't touch the DOM directly.

const logEl = () => document.getElementById("log")!;
const statusEl = () => document.getElementById("status")!;

export function log(line: string) {
  logEl().textContent += line + "\n";
  logEl().scrollTop = logEl().scrollHeight;
}

export function status(s: string) {
  statusEl().textContent = s;
}

export function onClick(id: string, fn: () => void) {
  document.getElementById(id)!.addEventListener("click", fn);
}

export function inputValue(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value;
}
