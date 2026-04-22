// Curated national-holiday dataset for India and the United States.
// Used by holidaySyncService to seed the DB without external network calls.
//
// Covers public + bank holidays for the years most relevant to payroll
// (current + neighbouring years). Extend as needed each calendar year.
//
// Dates are ISO (YYYY-MM-DD). `name` is the canonical label shown on slips
// and in the Holidays list.

interface StaticHoliday {
  date: string;
  name: string;
}

type CountryYearMap = Record<number, StaticHoliday[]>;

export const STATIC_HOLIDAYS: Record<"IN" | "US", CountryYearMap> = {
  IN: {
    2025: [
      { date: "2025-01-26", name: "Republic Day" },
      { date: "2025-03-14", name: "Holi" },
      { date: "2025-03-31", name: "Id-ul-Fitr" },
      { date: "2025-04-10", name: "Mahavir Jayanti" },
      { date: "2025-04-14", name: "Dr. Ambedkar Jayanti" },
      { date: "2025-04-18", name: "Good Friday" },
      { date: "2025-05-01", name: "Labour Day" },
      { date: "2025-05-12", name: "Buddha Purnima" },
      { date: "2025-06-07", name: "Id-ul-Zuha (Bakrid)" },
      { date: "2025-07-06", name: "Muharram" },
      { date: "2025-08-15", name: "Independence Day" },
      { date: "2025-08-16", name: "Janmashtami" },
      { date: "2025-09-05", name: "Eid-e-Milad" },
      { date: "2025-10-02", name: "Gandhi Jayanti" },
      { date: "2025-10-02", name: "Dussehra" },
      { date: "2025-10-20", name: "Diwali" },
      { date: "2025-11-05", name: "Guru Nanak Jayanti" },
      { date: "2025-12-25", name: "Christmas Day" },
    ],
    2026: [
      { date: "2026-01-26", name: "Republic Day" },
      { date: "2026-03-04", name: "Holi" },
      { date: "2026-03-20", name: "Id-ul-Fitr" },
      { date: "2026-03-30", name: "Mahavir Jayanti" },
      { date: "2026-04-03", name: "Good Friday" },
      { date: "2026-04-14", name: "Dr. Ambedkar Jayanti" },
      { date: "2026-05-01", name: "Labour Day" },
      { date: "2026-05-01", name: "Buddha Purnima" },
      { date: "2026-05-27", name: "Id-ul-Zuha (Bakrid)" },
      { date: "2026-06-26", name: "Muharram" },
      { date: "2026-08-15", name: "Independence Day" },
      { date: "2026-09-04", name: "Janmashtami" },
      { date: "2026-08-26", name: "Eid-e-Milad" },
      { date: "2026-10-02", name: "Gandhi Jayanti" },
      { date: "2026-10-20", name: "Dussehra" },
      { date: "2026-11-08", name: "Diwali" },
      { date: "2026-11-24", name: "Guru Nanak Jayanti" },
      { date: "2026-12-25", name: "Christmas Day" },
    ],
    2027: [
      { date: "2027-01-26", name: "Republic Day" },
      { date: "2027-03-22", name: "Holi" },
      { date: "2027-03-10", name: "Id-ul-Fitr" },
      { date: "2027-03-26", name: "Good Friday" },
      { date: "2027-04-14", name: "Dr. Ambedkar Jayanti" },
      { date: "2027-05-01", name: "Labour Day" },
      { date: "2027-05-20", name: "Buddha Purnima" },
      { date: "2027-05-17", name: "Id-ul-Zuha (Bakrid)" },
      { date: "2027-06-16", name: "Muharram" },
      { date: "2027-08-15", name: "Independence Day" },
      { date: "2027-08-25", name: "Janmashtami" },
      { date: "2027-10-02", name: "Gandhi Jayanti" },
      { date: "2027-10-09", name: "Dussehra" },
      { date: "2027-10-28", name: "Diwali" },
      { date: "2027-11-14", name: "Guru Nanak Jayanti" },
      { date: "2027-12-25", name: "Christmas Day" },
    ],
  },
  US: {
    2025: [
      { date: "2025-01-01", name: "New Year's Day" },
      { date: "2025-01-20", name: "Martin Luther King Jr. Day" },
      { date: "2025-02-17", name: "Presidents' Day" },
      { date: "2025-05-26", name: "Memorial Day" },
      { date: "2025-06-19", name: "Juneteenth" },
      { date: "2025-07-04", name: "Independence Day" },
      { date: "2025-09-01", name: "Labor Day" },
      { date: "2025-10-13", name: "Columbus Day" },
      { date: "2025-11-11", name: "Veterans Day" },
      { date: "2025-11-27", name: "Thanksgiving Day" },
      { date: "2025-12-25", name: "Christmas Day" },
    ],
    2026: [
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-01-19", name: "Martin Luther King Jr. Day" },
      { date: "2026-02-16", name: "Presidents' Day" },
      { date: "2026-05-25", name: "Memorial Day" },
      { date: "2026-06-19", name: "Juneteenth" },
      { date: "2026-07-04", name: "Independence Day" },
      { date: "2026-09-07", name: "Labor Day" },
      { date: "2026-10-12", name: "Columbus Day" },
      { date: "2026-11-11", name: "Veterans Day" },
      { date: "2026-11-26", name: "Thanksgiving Day" },
      { date: "2026-12-25", name: "Christmas Day" },
    ],
    2027: [
      { date: "2027-01-01", name: "New Year's Day" },
      { date: "2027-01-18", name: "Martin Luther King Jr. Day" },
      { date: "2027-02-15", name: "Presidents' Day" },
      { date: "2027-05-31", name: "Memorial Day" },
      { date: "2027-06-19", name: "Juneteenth" },
      { date: "2027-07-04", name: "Independence Day" },
      { date: "2027-09-06", name: "Labor Day" },
      { date: "2027-10-11", name: "Columbus Day" },
      { date: "2027-11-11", name: "Veterans Day" },
      { date: "2027-11-25", name: "Thanksgiving Day" },
      { date: "2027-12-25", name: "Christmas Day" },
    ],
  },
};

export function lookupHolidays(country: "IN" | "US", year: number): StaticHoliday[] {
  const years = STATIC_HOLIDAYS[country] || {};
  const list = years[year];
  if (!list) return [];
  // Deduplicate same-date rows (e.g. Labour Day + Buddha Purnima on 2026-05-01):
  // prefer keeping each unique date, but concatenate names with " / " so the
  // admin sees both without two rows hitting the unique index.
  const byDate = new Map<string, string>();
  for (const h of list) {
    const existing = byDate.get(h.date);
    byDate.set(h.date, existing ? `${existing} / ${h.name}` : h.name);
  }
  return Array.from(byDate.entries()).map(([date, name]) => ({ date, name }));
}
