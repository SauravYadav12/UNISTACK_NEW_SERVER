import { HolidayModel, HolidayCountry, HolidaySource } from "../models/holidayModel";
import { lookupHolidays } from "./holidayData";

interface SyncResult {
  country: "IN" | "US";
  upserted: number;
  skipped: number;
  error?: string;
}

interface NormalisedHoliday {
  isoDate: string; // YYYY-MM-DD
  name: string;
}

async function upsertHolidays(
  list: NormalisedHoliday[],
  countryCode: "IN" | "US",
): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0;
  let skipped = 0;
  for (const h of list) {
    const fromDate = h.isoDate.replace(/-/g, "/");
    // Stable external key so re-syncing is idempotent.
    const externalId = `holidays:${countryCode}:${h.isoDate}`;
    try {
      await HolidayModel.updateOne(
        { externalId, country: countryCode },
        {
          $set: {
            name: h.name,
            description: "",
            fromDate,
            toDate: fromDate,
            isHalfDay: false,
            country: countryCode as HolidayCountry,
            source: HolidaySource.System,
            externalId,
          },
        },
        { upsert: true },
      );
      upserted++;
    } catch {
      skipped++;
    }
  }
  return { upserted, skipped };
}

async function syncCountry(year: number, countryCode: "IN" | "US"): Promise<SyncResult> {
  try {
    const data = lookupHolidays(countryCode, year);
    if (!data.length) {
      return {
        country: countryCode,
        upserted: 0,
        skipped: 0,
        error: `No holiday data available for ${year}. Ask the admin to update the holidays dataset.`,
      };
    }
    const { upserted, skipped } = await upsertHolidays(
      data.map((d) => ({ isoDate: d.date, name: d.name })),
      countryCode,
    );
    return { country: countryCode, upserted, skipped };
  } catch (e) {
    return {
      country: countryCode,
      upserted: 0,
      skipped: 0,
      error: (e as Error).message,
    };
  }
}

/**
 * Sync national holidays for the given year. `only` narrows to a single
 * country; omit to sync both.
 */
export async function syncNationalHolidays(
  year: number,
  only?: "IN" | "US",
) {
  if (only === "IN") {
    const india = await syncCountry(year, "IN");
    return { year, india };
  }
  if (only === "US") {
    const us = await syncCountry(year, "US");
    return { year, us };
  }
  const [india, us] = await Promise.all([
    syncCountry(year, "IN"),
    syncCountry(year, "US"),
  ]);
  return { year, india, us };
}
