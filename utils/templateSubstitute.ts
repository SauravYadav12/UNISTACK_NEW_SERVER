/**
 * Minimal `{{ token }}` substitution used by email templates.
 *
 * Design goals:
 *  - Zero-dep (no mustache / handlebars) — only token replacement, no logic
 *  - Unknown tokens are left as-is so admins can preview their templates
 *    and spot unsubstituted placeholders at a glance
 *  - Allows whitespace inside braces: `{{foo}}`, `{{ foo }}`, `{{  foo  }}`
 *  - Values are coerced with `String(...)`; null / undefined leave the token intact
 */

export type SubstitutionVars = Record<string, unknown>;

const TOKEN_RE = /{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g;

export function substitute(template: string, vars: SubstitutionVars): string {
  if (!template) return "";
  return template.replace(TOKEN_RE, (match, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return match;
    return String(v);
  });
}

/** Pull every token name out of a template — useful for preview UIs. */
export function listTokens(template: string): string[] {
  if (!template) return [];
  const out = new Set<string>();
  for (const m of template.matchAll(TOKEN_RE)) {
    out.add(m[1]);
  }
  return [...out];
}
