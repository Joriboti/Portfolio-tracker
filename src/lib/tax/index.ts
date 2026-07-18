// Country registry for the tax wizard. Adding a country = one engine module +
// one entry here + its i18n content block; the wizard itself doesn't change.

import type { TaxCountry } from "./types";
import { ES_AVAILABLE_YEARS, ES_DEFAULT_YEAR } from "./es-config";

export type CountryMeta = {
  code: TaxCountry;
  flag: string;
  available: boolean;
  years: number[];
  defaultYear: number;
};

export const TAX_COUNTRIES: CountryMeta[] = [
  {
    code: "es",
    flag: "🇪🇸",
    available: true,
    years: ES_AVAILABLE_YEARS,
    defaultYear: ES_DEFAULT_YEAR,
  },
  // Phase 3 of TAXES_PROPOSAL.md: short/long-term split, basic wash sales,
  // Form 8949 summary. Visible in the selector as "coming soon" until then.
  { code: "us", flag: "🇺🇸", available: false, years: [], defaultYear: 2025 },
];

export * from "./types";
export * from "./es-config";
export * from "./es";
