import { readScraperResponse, scrapeKeywordWithStrategy } from '../../utils/scraper';
import { dummyKeywords, dummySettings } from '../../__mocks__/data';

const response = (body: string, headers: Record<string, string> = {}, status = 200) => ({
   status,
   text: async () => body,
   headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
});

describe('readScraperResponse', () => {
   it('returns the parsed payload when the provider answers properly', async () => {
      const parsed = await readScraperResponse(response('{"organic":[{"title":"a","link":"https://a/"}]}'));
      expect(parsed.organic).toHaveLength(1);
   });

   it('names the provider failure hidden behind an empty HTTP 200 body', async () => {
      // Bright Data reports a CAPTCHA this way: 200, no body, error in the headers.
      const res = response('', { 'x-brd-error': 'redirect location was rejected', 'x-brd-error-code': 'captcha' });
      await expect(readScraperResponse(res)).rejects.toThrow(/redirect location was rejected/);
   });

   it('falls back on the status code when an empty body carries no provider header', async () => {
      await expect(readScraperResponse(response('   ', {}, 502))).rejects.toThrow(/no body, HTTP 502/);
   });

   it('quotes the body when the provider refuses in plain text', async () => {
      await expect(readScraperResponse(response('This query is blocked')))
         .rejects.toThrow(/This query is blocked/);
   });

   it('marks every provider refusal so the caller can retry it', async () => {
      await expect(readScraperResponse(response(''))).rejects.toThrow(/^PROVIDER_REFUSAL: /);
      await expect(readScraperResponse(response('not json'))).rejects.toThrow(/^PROVIDER_REFUSAL: /);
   });
});

describe('scrapeKeywordWithStrategy retry', () => {
   const keyword = { ...dummyKeywords[0], country: 'FR', position: 0 } as any;
   const settings = {
      ...dummySettings,
      scraper_type: 'brightdata',
      scaping_api: 'token',
      scrape_strategy: 'basic',
   } as any;

   // The link has to sit on the keyword's own domain, otherwise the position is 0
   // for the ordinary reason and the retry would look broken.
   const organic = JSON.stringify({ organic: [{ title: 'Compress Image', link: 'https://compressimage.io/', rank: 1 }] });

   beforeEach(() => {
      jest.useFakeTimers();
      (fetch as any).resetMocks();
   });
   afterEach(() => { jest.useRealTimers(); });

   const run = async (promise: Promise<any>) => {
      await jest.advanceTimersByTimeAsync(10000);
      return promise;
   };

   it('retries once when the provider returns an empty body, and succeeds', async () => {
      (fetch as any).mockResponses(['', { status: 200 }], [organic, { status: 200 }]);
      const result = await run(scrapeKeywordWithStrategy(keyword, settings));
      expect((fetch as any).mock.calls).toHaveLength(2);
      expect(result && (result as any).error).toBeFalsy();
      expect(result && (result as any).position).toBe(1);
   });

   it('gives up after the second refusal and says so', async () => {
      (fetch as any).mockResponses(['', { status: 200 }], ['', { status: 200 }]);
      const result = await run(scrapeKeywordWithStrategy(keyword, settings));
      expect((fetch as any).mock.calls).toHaveLength(2);
      expect(result && (result as any).error).toBeTruthy();
   });

   it('does not retry a well-formed answer that simply holds no result', async () => {
      (fetch as any).mockResponses([JSON.stringify({ organic: [] }), { status: 200 }]);
      await run(scrapeKeywordWithStrategy(keyword, settings));
      expect((fetch as any).mock.calls).toHaveLength(1);
   });
});

describe('failure messages carry their cause', () => {
   const keyword = { ...dummyKeywords[0], country: 'FR', position: 0 } as any;
   const settings = { ...dummySettings, scraper_type: 'brightdata', scaping_api: 'token', scrape_strategy: 'basic' } as any;

   beforeEach(() => { jest.useFakeTimers(); (fetch as any).resetMocks(); });
   afterEach(() => { jest.useRealTimers(); });

   it('names the provider error instead of only counting failed pages', async () => {
      (fetch as any).mockResponses(
         ['', { status: 200, headers: { 'x-brd-error': 'redirect location was rejected' } }],
         ['', { status: 200, headers: { 'x-brd-error': 'redirect location was rejected' } }],
      );
      const promise = scrapeKeywordWithStrategy(keyword, settings);
      await jest.advanceTimersByTimeAsync(10000);
      const result = await promise;
      expect((result as any).error).toMatch(/Scraper failed on all 1 pages/);
      expect((result as any).error).toMatch(/redirect location was rejected/);
      // The internal routing marker never reaches the dashboard.
      expect((result as any).error).not.toMatch(/PROVIDER_REFUSAL/);
   });

   it('leaves the no-result message alone when nothing failed', async () => {
      (fetch as any).mockResponses([JSON.stringify({ organic: [] }), { status: 200 }]);
      const promise = scrapeKeywordWithStrategy(keyword, settings);
      await jest.advanceTimersByTimeAsync(10000);
      const result = await promise;
      expect((result as any).error).toMatch(/No search results found/);
   });
});
