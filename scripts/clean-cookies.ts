/**
 * Nettoie un export Netscape pollué → uniquement cookies TikTok ou Instagram.
 *
 * Usage:
 *   npx ts-node scripts/clean-cookies.ts tiktok
 *   npx ts-node scripts/clean-cookies.ts instagram
 *   npx ts-node scripts/clean-cookies.ts tiktok --in-place
 */
import fs from 'fs';
import path from 'path';
import {
  filterCookiesForPlatform,
  ParsedCookie,
} from '../src/utils/httpCookies';
import {
  parseNetscapeCookies,
  serializeNetscapeCookies,
} from '../src/utils/cookies';

const ROOT = path.resolve(__dirname, '..');

const TARGETS: Record<
  string,
  { input: string; output: string; platform: 'tiktok' | 'instagram' }
> = {
  tiktok: {
    input: process.env.COOKIES_TIKTOK_PATH || path.join(ROOT, 'cookies-tiktok.txt'),
    output: path.join(ROOT, 'cookies-tiktok.clean.txt'),
    platform: 'tiktok',
  },
  instagram: {
    input: process.env.COOKIES_PATH || path.join(ROOT, 'cookies.txt'),
    output: path.join(ROOT, 'cookies.clean.txt'),
    platform: 'instagram',
  },
};

function main(): void {
  const arg = (process.argv[2] || 'tiktok').toLowerCase();
  const inPlace = process.argv.includes('--in-place');
  const target = TARGETS[arg];

  if (!target) {
    console.error('Usage: clean-cookies.ts <tiktok|instagram> [--in-place]');
    process.exit(1);
  }

  if (!fs.existsSync(target.input)) {
    console.error(`Fichier introuvable: ${target.input}`);
    process.exit(1);
  }

  const parsed = parseNetscapeCookies(target.input);
  const filtered: ParsedCookie[] = filterCookiesForPlatform(parsed, target.platform);
  const output = serializeNetscapeCookies(filtered);
  const dest = inPlace ? target.input : target.output;

  fs.writeFileSync(dest, output, 'utf-8');

  console.log(`✅ ${target.platform}: ${parsed.length} lignes → ${filtered.length} cookies`);
  console.log(`   Écrit: ${dest}`);
  console.log(
    '   Clés attendues:',
    target.platform === 'tiktok'
      ? 'sessionid, ttwid, msToken, sid_tt, tt_csrf_token…'
      : 'sessionid, csrftoken, ds_user_id…'
  );

  if (!inPlace) {
    console.log(`\n💡 Remplace manuellement ${path.basename(target.input)} ou relance avec --in-place`);
  }
}

main();
