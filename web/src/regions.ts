// Sensible defaults by country for a new home: the money it pays in and how it measures.
// Anyone can change both afterwards (Settings → You for measurements, Settings → Home for currency).

export interface Region { id: string; name: string; currency: string; units: 'us' | 'metric'; deals: boolean }

export const REGIONS: Region[] = [
  { id: 'US', name: 'United States', currency: 'USD', units: 'us', deals: true },
  { id: 'CA', name: 'Canada', currency: 'CAD', units: 'metric', deals: false },
  { id: 'MX', name: 'México', currency: 'MXN', units: 'metric', deals: false },
  { id: 'GB', name: 'United Kingdom', currency: 'GBP', units: 'metric', deals: false },
  { id: 'IE', name: 'Ireland', currency: 'EUR', units: 'metric', deals: false },
  { id: 'AU', name: 'Australia', currency: 'AUD', units: 'metric', deals: false },
  { id: 'NZ', name: 'New Zealand', currency: 'NZD', units: 'metric', deals: false },
  { id: 'DE', name: 'Deutschland', currency: 'EUR', units: 'metric', deals: false },
  { id: 'FR', name: 'France', currency: 'EUR', units: 'metric', deals: false },
  { id: 'ES', name: 'España', currency: 'EUR', units: 'metric', deals: false },
  { id: 'IT', name: 'Italia', currency: 'EUR', units: 'metric', deals: false },
  { id: 'NL', name: 'Nederland', currency: 'EUR', units: 'metric', deals: false },
  { id: 'BE', name: 'Belgique / België', currency: 'EUR', units: 'metric', deals: false },
  { id: 'AT', name: 'Österreich', currency: 'EUR', units: 'metric', deals: false },
  { id: 'CH', name: 'Schweiz / Suisse', currency: 'CHF', units: 'metric', deals: false },
  { id: 'SE', name: 'Sverige', currency: 'SEK', units: 'metric', deals: false },
  { id: 'NO', name: 'Norge', currency: 'NOK', units: 'metric', deals: false },
  { id: 'DK', name: 'Danmark', currency: 'DKK', units: 'metric', deals: false },
  { id: 'FI', name: 'Suomi', currency: 'EUR', units: 'metric', deals: false },
  { id: 'PL', name: 'Polska', currency: 'PLN', units: 'metric', deals: false },
  { id: 'PT', name: 'Portugal', currency: 'EUR', units: 'metric', deals: false },
  { id: 'BR', name: 'Brasil', currency: 'BRL', units: 'metric', deals: false },
  { id: 'AR', name: 'Argentina', currency: 'ARS', units: 'metric', deals: false },
  { id: 'CO', name: 'Colombia', currency: 'COP', units: 'metric', deals: false },
  { id: 'CL', name: 'Chile', currency: 'CLP', units: 'metric', deals: false },
  { id: 'IN', name: 'India', currency: 'INR', units: 'metric', deals: false },
  { id: 'JP', name: '日本', currency: 'JPY', units: 'metric', deals: false },
  { id: 'KR', name: '대한민국', currency: 'KRW', units: 'metric', deals: false },
  { id: 'PH', name: 'Philippines', currency: 'PHP', units: 'metric', deals: false },
  { id: 'SG', name: 'Singapore', currency: 'SGD', units: 'metric', deals: false },
  { id: 'ZA', name: 'South Africa', currency: 'ZAR', units: 'metric', deals: false },
];

/** A best guess from the browser's language setting ("en-GB" → United Kingdom), or the United States. */
export function guessRegion(locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US'): Region {
  const country = locale.split('-')[1]?.toUpperCase();
  return REGIONS.find((r) => r.id === country) ?? REGIONS[0];
}
