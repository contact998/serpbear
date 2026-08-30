import countries from '../../utils/countries';

interface BrightDataOrganicResult {
   title?: string,
   link?: string,
   rank?: number,
   global_rank?: number,
}

/**
 * Bright Data SERP API — asks Bright Data for the ALREADY PARSED result set
 * (`brd_json=1`) instead of scraping Google's HTML.
 *
 * Why this exists: the `proxy` scraper reads Google's markup, and Google now
 * serves its result links as `/goto?url=<opaque token>` rather than an absolute
 * URL or the older `/url?q=https://…`. `cleanResultURL` cannot recognise that
 * shape, drops every result, and the keyword is recorded as "No search results
 * found" while the site is in fact ranking. Parsed JSON removes that whole
 * class of breakage — there is no markup left to change.
 *
 * Two constraints, both measured against the live API (2026-08-30):
 *  - `brd_json=1` only works on the API endpoint. Through the proxy port
 *    (`brd.superproxy.io:44445`) the same URL answers HTTP 502.
 *  - Bright Data strips the `num` parameter from the Google URL, so this
 *    scraper does not claim `nativePagination`: it reads the first page, which
 *    is what the `basic` strategy already did.
 *
 * Settings: put the Bright Data API token in the scraper API key field. The
 * zone name comes from BRIGHTDATA_SERP_ZONE.
 */

const GOOGLE_DOMAINS: Record<string, string> = {
   GB: 'google.co.uk',
   US: 'google.com',
};

/**
 * Google's `hl` is a LANGUAGE code, not a country one.
 *
 * Passing the country through worked by accident for FR/DE/ES/IT/PT, where the
 * two codes coincide, and broke every English-speaking market: Bright Data
 * answered HTTP 200 with "the inputted language value (hl parameter) is not
 * allowed" for hl=gb and hl=us, so the .com domain measured nothing at all.
 * countries[code][2] is the language, and is what the other scrapers read.
 */
const languageOf = (country: string): string => countries[country]?.[2] || 'en';

const brightdata: ScraperSettings = {
   id: 'brightdata',
   name: 'Bright Data (SERP API)',
   website: 'brightdata.com',
   resultObjectKey: 'organic',
   headers: (keyword, settings) => {
      return {
         'Content-Type': 'application/json',
         Authorization: `Bearer ${settings.scaping_api}`,
      };
   },
   scrapeURL: () => 'https://api.brightdata.com/request',
   method: 'POST',
   body: (keyword, settings, pagination) => {
      const country = (keyword.country || 'US').toUpperCase();
      const domain = GOOGLE_DOMAINS[country] || `google.${country.toLowerCase()}`;
      const start = pagination?.start || 0;
      const parametres = [
         `q=${encodeURIComponent(keyword.keyword)}`,
         `gl=${country.toLowerCase()}`,
         `hl=${languageOf(country)}`,
         start ? `start=${start}` : '',
         keyword.device === 'mobile' ? 'brd_mobile=1' : '',
         'brd_json=1',
      ].filter(Boolean).join('&');
      return {
         // The exit country follows the KEYWORD, not a single hardcoded country:
         // the proxy string it replaces was pinned to country-fr for all six
         // markets, so DE/ES/IT/PT/GB/US positions were measured from France.
         zone: process.env.BRIGHTDATA_SERP_ZONE || 'serp',
         country: country.toLowerCase(),
         url: `https://www.${domain}/search?${parametres}`,
         format: 'raw',
      };
   },
   serpExtractor: (content) => {
      const extractedResult = [];
      const results: BrightDataOrganicResult[] = (typeof content === 'string')
         ? JSON.parse(content)
         : content as unknown as BrightDataOrganicResult[];

      for (let index = 0; index < results.length; index += 1) {
         const { title, link, rank, global_rank: globalRank } = results[index];
         if (title && link) {
            extractedResult.push({
               title,
               url: link,
               // Bright Data numbers the organic block itself; fall back on the
               // array order when it does not.
               position: globalRank || rank || index + 1,
            });
         }
      }
      return extractedResult;
   },
};

export default brightdata;
