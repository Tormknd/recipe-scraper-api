import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { ScrapedData } from '../types';

chromium.use(stealthPlugin());

const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export class ScraperService {
  async scrapeUrl(url: string): Promise<ScrapedData> {
    console.log(`[Scraper] Starting scrape for: ${url}`);
    
    const browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });

    try {
      const context = await browser.newContext({
        userAgent: USER_AGENT,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        locale: 'fr-FR',
        timezoneId: 'Europe/Paris'
      });

      const page = await context.newPage();

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      } catch (e) {}

      const removeModals = async () => {
        await page.evaluate(() => {
          const selectors = [
            '[role="dialog"]', 
            '[role="presentation"]', 
            'div[class*="Backdrop"]', 
            'div[class*="Overlay"]',
            'div[role="dialog"] > div > div > div > div'
          ];
          
          selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
              if (el.textContent?.toLowerCase().includes('log in') || 
                  el.textContent?.toLowerCase().includes('sign up') ||
                  el.textContent?.toLowerCase().includes('connectez-vous') ||
                  el.clientHeight > 0) {
                 el.remove();
              }
            });
          });
          document.body.style.overflow = 'auto';
        });
      };

      await removeModals();

      try {
        console.log('[Scraper] Attempting to expand caption...');
        const moreButtons = await page.getByRole('button', { name: /more|plus|suite/i }).all();
        for (const btn of moreButtons) {
          if (await btn.isVisible()) {
            await btn.click({ timeout: 1000 }).catch(() => {});
            await page.waitForTimeout(200);
          }
        }
      } catch (e) {}

      console.log('[Scraper] Scrolling for comments...');
      
      try {
        const viewCommentsBtn = page.getByText(/View all.*comments|Voir les.*commentaires/i);
        if (await viewCommentsBtn.isVisible()) {
            await viewCommentsBtn.click({ timeout: 2000 });
            await page.waitForTimeout(1000);
        }
      } catch (e) {}

      let comments: string[] = [];
      
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 800);
        await page.waitForTimeout(1500);
        await removeModals();
        
        const newComments = await page.evaluate(() => {
          const commentElements = document.querySelectorAll('ul li, div[role="button"] + div'); 
          return Array.from(commentElements)
            .map(el => el.textContent || '')
            .filter(text => text.length > 10 && text.length < 500)
            .filter(text => !text.includes('Reply') && !text.includes('View all'));
        });
        
        comments = [...comments, ...newComments];
      }
      comments = [...new Set(comments)].slice(0, 20);
      console.log(`[Scraper] Found ${comments.length} comments.`);

      const jsonLd = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        return Array.from(scripts).map(s => s.textContent).join('\n');
      });

      const metaDescription = await page.evaluate(() => {
        return document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
      });

      const visibleText = await page.evaluate(() => document.body.innerText);

      const specificCaption = await page.evaluate(() => {
         const h1 = document.querySelector('h1');
         
         const candidates = Array.from(document.querySelectorAll('span, div, li, h1'))
            .filter(el => {
                const t = (el as HTMLElement).innerText || '';
                return t.length > 50 && (t.includes('Ingrédients') || t.includes('Recette') || t.includes('Steps'));
            })
            .sort((a, b) => ((b as HTMLElement).innerText?.length || 0) - ((a as HTMLElement).innerText?.length || 0));

         if (candidates.length > 0) return (candidates[0] as HTMLElement).innerText;
         if (h1 && (h1 as HTMLElement).innerText.length > 20) return (h1 as HTMLElement).innerText;
         return '';
      });

      const text = `
        PRIORITY_CAPTION_DOM: ${specificCaption}
        META_DESCRIPTION: ${metaDescription}
        JSON_LD: ${jsonLd}
        FULL_VISIBLE_BODY: ${visibleText}
      `;

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
      const buffer = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 70 });
      const screenshotBase64 = buffer.toString('base64');
      const title = await page.title();

      console.log(`[Scraper] Successfully scraped ${url}. Text length: ${text.length}`);
      
      return {
        text,
        comments,
        screenshotBase64,
        url,
        title
      };

    } catch (error) {
      console.error('[Scraper] Error scraping URL:', error);
      throw error;
    } finally {
      if (browser) {
          try {
              await browser.close();
          } catch(e) {
              // Ignore close errors
          }
      }
    }
  }
}
