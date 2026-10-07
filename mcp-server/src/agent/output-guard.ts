/**
 * Output guard — rules for replies that must hold regardless of what the model writes.
 *
 * Users never see internal IDs. The prompts say so, but prompt wording is fragile with the
 * primary model (F7: adding unrelated rules made it start printing UUIDs), so replies are
 * redacted deterministically before they leave the agent.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const PATTERNS: RegExp[] = [
  // "(ID: …)" / "（id：…）" — drop the whole parenthetical
  new RegExp(`\\s*[(（]\\s*(?:id|uuid)\\s*[:：]?\\s*${UUID}\\s*[)）]`, "gi"),
  // "ID: …" inline
  new RegExp(`(?:id|uuid)\\s*[:：]\\s*${UUID}`, "gi"),
  // anything left
  new RegExp(UUID, "gi"),
];

export function redactIds(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, "");
  // tidy what the removals leave behind: doubled spaces, a space before punctuation
  return out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([，。、；：,.;:)）])/g, "$1");
}
