/**
 * US-only location whitelist + validator for the Job Boards search.
 *
 * The Job Boards feature is hard-locked to United States listings for v1.
 * This module gates two things:
 *   1. The controller rejects any non-US `location` with a 400 — defense
 *      in depth, in case a malicious client bypasses the picker.
 *   2. The same whitelist is shipped to the client to populate the
 *      `Autocomplete` so the user physically cannot select a non-US
 *      location.
 *
 * Accepted shapes:
 *   - ""                     → JSearch sees nationwide
 *   - "Remote"               → caller will set `remoteOnly: true`
 *   - "California"           → state name
 *   - "CA"                   → state abbreviation
 *   - "Austin, TX"           → "<City>, <STATE_ABBR>" (any city allowed
 *                              so long as the trailing abbreviation is
 *                              whitelisted)
 */

export interface UsState {
  name: string;
  abbreviation: string;
}

export const US_STATES: UsState[] = [
  { name: "Alabama", abbreviation: "AL" },
  { name: "Alaska", abbreviation: "AK" },
  { name: "Arizona", abbreviation: "AZ" },
  { name: "Arkansas", abbreviation: "AR" },
  { name: "California", abbreviation: "CA" },
  { name: "Colorado", abbreviation: "CO" },
  { name: "Connecticut", abbreviation: "CT" },
  { name: "Delaware", abbreviation: "DE" },
  { name: "District of Columbia", abbreviation: "DC" },
  { name: "Florida", abbreviation: "FL" },
  { name: "Georgia", abbreviation: "GA" },
  { name: "Hawaii", abbreviation: "HI" },
  { name: "Idaho", abbreviation: "ID" },
  { name: "Illinois", abbreviation: "IL" },
  { name: "Indiana", abbreviation: "IN" },
  { name: "Iowa", abbreviation: "IA" },
  { name: "Kansas", abbreviation: "KS" },
  { name: "Kentucky", abbreviation: "KY" },
  { name: "Louisiana", abbreviation: "LA" },
  { name: "Maine", abbreviation: "ME" },
  { name: "Maryland", abbreviation: "MD" },
  { name: "Massachusetts", abbreviation: "MA" },
  { name: "Michigan", abbreviation: "MI" },
  { name: "Minnesota", abbreviation: "MN" },
  { name: "Mississippi", abbreviation: "MS" },
  { name: "Missouri", abbreviation: "MO" },
  { name: "Montana", abbreviation: "MT" },
  { name: "Nebraska", abbreviation: "NE" },
  { name: "Nevada", abbreviation: "NV" },
  { name: "New Hampshire", abbreviation: "NH" },
  { name: "New Jersey", abbreviation: "NJ" },
  { name: "New Mexico", abbreviation: "NM" },
  { name: "New York", abbreviation: "NY" },
  { name: "North Carolina", abbreviation: "NC" },
  { name: "North Dakota", abbreviation: "ND" },
  { name: "Ohio", abbreviation: "OH" },
  { name: "Oklahoma", abbreviation: "OK" },
  { name: "Oregon", abbreviation: "OR" },
  { name: "Pennsylvania", abbreviation: "PA" },
  { name: "Rhode Island", abbreviation: "RI" },
  { name: "South Carolina", abbreviation: "SC" },
  { name: "South Dakota", abbreviation: "SD" },
  { name: "Tennessee", abbreviation: "TN" },
  { name: "Texas", abbreviation: "TX" },
  { name: "Utah", abbreviation: "UT" },
  { name: "Vermont", abbreviation: "VT" },
  { name: "Virginia", abbreviation: "VA" },
  { name: "Washington", abbreviation: "WA" },
  { name: "West Virginia", abbreviation: "WV" },
  { name: "Wisconsin", abbreviation: "WI" },
  { name: "Wyoming", abbreviation: "WY" },
];

const STATE_NAMES = new Set(US_STATES.map((s) => s.name.toLowerCase()));
const STATE_ABBRS = new Set(US_STATES.map((s) => s.abbreviation));

/**
 * Returns true when `loc` is an acceptable US-scoped location string for
 * our Job Boards search.
 */
export function isValidUsLocation(loc: string): boolean {
  const value = (loc || "").trim();
  if (value === "") return true;
  if (value.toLowerCase() === "remote") return true;

  // State by name (case-insensitive).
  if (STATE_NAMES.has(value.toLowerCase())) return true;

  // State by abbreviation (must be upper-case 2 letters to avoid
  // accidentally matching unrelated words like "or").
  if (/^[A-Z]{2}$/.test(value) && STATE_ABBRS.has(value)) return true;

  // "<City>, <STATE_ABBR>" — allow any city, lock the abbreviation.
  const cityStateMatch = value.match(/^(.+),\s*([A-Z]{2})$/);
  if (cityStateMatch) {
    const abbr = cityStateMatch[2];
    if (STATE_ABBRS.has(abbr)) return true;
  }

  return false;
}

/**
 * Normalize a US location into a canonical form so cache keys collide for
 * equivalent inputs. We:
 *   - trim whitespace
 *   - title-case state names ("california" → "California")
 *   - upper-case "<City>, st" → "<City>, ST"
 * The result is the string we send to JSearch and store with the cache row.
 */
export function normalizeUsLocation(loc: string): string {
  const value = (loc || "").trim();
  if (value === "") return "";
  if (value.toLowerCase() === "remote") return "Remote";

  // State by name
  for (const s of US_STATES) {
    if (s.name.toLowerCase() === value.toLowerCase()) return s.name;
  }

  // State by abbreviation
  if (/^[a-zA-Z]{2}$/.test(value)) {
    const upper = value.toUpperCase();
    if (STATE_ABBRS.has(upper)) return upper;
  }

  // "<City>, <STATE>"
  const cityStateMatch = value.match(/^(.+),\s*([a-zA-Z]{2})$/);
  if (cityStateMatch) {
    const city = cityStateMatch[1].trim();
    const abbr = cityStateMatch[2].toUpperCase();
    if (STATE_ABBRS.has(abbr)) return `${city}, ${abbr}`;
  }

  // Caller will validate; just return the trimmed string.
  return value;
}
