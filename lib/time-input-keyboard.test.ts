import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Time and pace boxes must open the FULL phone keyboard (2026-09-28).
 *
 * Athletes type paces and times as "8:30" or "1:12:00". On iOS a
 * `type="number"` box, or one with `inputMode="numeric"` / `"decimal"`, opens a
 * keypad with no colon, so the value cannot be typed at all — which is what the
 * four "Know your paces?" boxes on the program builder did. Levi's decision: a
 * time box is a plain `type="text"` input with no `inputMode`, and the athlete
 * gets the normal keyboard.
 *
 * This scans every `<input …>` in app/ and components/ and fails if one whose
 * placeholder is a clock time (a digit, a colon, two digits) also asks for a
 * numeric keypad.
 */

const ROOT = join(__dirname, "..");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Each `<input` opening tag, up to its closing `/>` (JSX attributes can hold `>`). */
function inputTags(src: string): string[] {
  const tags: string[] = [];
  let i = src.indexOf("<input");
  while (i !== -1) {
    const end = src.indexOf("/>", i);
    if (end === -1) break;
    tags.push(src.slice(i, end + 2));
    i = src.indexOf("<input", end);
  }
  return tags;
}

const CLOCK_PLACEHOLDER = /placeholder=[^\n]*\d:\d\d/;
const NUMERIC_KEYPAD = /inputMode=["{]\s*"?(numeric|decimal|tel)|type="number"/;

function asksForKeypadOnTimeBox(tag: string): boolean {
  return CLOCK_PLACEHOLDER.test(tag) && NUMERIC_KEYPAD.test(tag);
}

describe("time and pace inputs", () => {
  it("recognises the pattern that broke the pace boxes", () => {
    expect(
      asksForKeypadOnTimeBox(
        `<input name="easyPace" type="text" inputMode="numeric" placeholder={u ? "5:15" : "8:30"} />`,
      ),
    ).toBe(true);
    expect(asksForKeypadOnTimeBox(`<input type="number" placeholder="e.g. 3:10" />`)).toBe(true);
    expect(asksForKeypadOnTimeBox(`<input type="text" placeholder="e.g. 1:12:00" />`)).toBe(false);
    expect(asksForKeypadOnTimeBox(`<input inputMode="decimal" placeholder="181" />`)).toBe(false);
  });

  it("no time box in the app opens a numeric keypad", () => {
    const offenders: string[] = [];
    for (const file of [...tsxFiles(join(ROOT, "app")), ...tsxFiles(join(ROOT, "components"))]) {
      for (const tag of inputTags(readFileSync(file, "utf8"))) {
        if (asksForKeypadOnTimeBox(tag)) offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
