import { chromium } from 'playwright-core';
import { localChromium } from './harness';

/** Physical print-layout measurements with the same embedded fonts and CSS as the PDF. No remote requests. */
export async function measureLayout(html: string) {
  const browser = await chromium.launch({ executablePath: localChromium(), headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
    await page.route('**/*', route => route.abort());
    await page.setContent(html);
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(() => {
      const mm = (px: number) => Math.round(px * 25.4 / 96 * 100) / 100;
      return {
        grids: [...document.querySelectorAll('.ms-grid-area')].map(el => ({ heightMm: mm(el.getBoundingClientRect().height), widthMm: mm(el.getBoundingClientRect().width), rows: Number(el.getAttribute('data-rows')), cellMm: Number(el.getAttribute('data-cell-mm')) })),
        fields: [...document.querySelectorAll('.ms-answer-field')].map(el => ({ label: el.querySelector('.ms-answer-field-label')?.textContent, lines: el.querySelectorAll('.ms-lines > div').length, heightMm: mm(el.getBoundingClientRect().height) })),
        writingLinesMm: [...document.querySelectorAll('.ms-lines > div')].map(el => mm(el.getBoundingClientRect().height)),
        bodyFontPt: parseFloat(getComputedStyle(document.querySelector('.ms-root')!).fontSize) * 72 / 96,
        figures: [...document.querySelectorAll('.ms-activity-figures svg')].map(el => el.outerHTML),
        activities: document.querySelectorAll('.ms-activity').length,
      };
    });
  } finally { await browser.close(); }
}
