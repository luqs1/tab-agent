// Skills = markdown instructions (+ optional scripts) injected into the prompt.
// In the sketch we eagerly bundle every SKILL.md under /skills via Vite's glob.
// Later: lazy-load by description (progressive disclosure) like real harnesses.
const files = import.meta.glob("/skills/**/SKILL.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function loadSkills(): string {
  const entries = Object.entries(files);
  if (entries.length === 0) return "";
  const blocks = entries.map(([path, body]) => {
    const name = path.split("/").slice(-2, -1)[0];
    return `<skill name="${name}">\n${body}\n</skill>`;
  });
  return `\n\n# Available skills\n${blocks.join("\n\n")}`;
}
