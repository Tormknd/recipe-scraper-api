# Spécifications — Recipe Scraper API (adapté au dépôt)

Document de référence pour Cursor / contributeurs. Version alignée sur le code réel (`recipe-scraper-api`), pas sur une stack Next.js / R2 fictive.

**Dernière mise à jour :** mai 2026

---

## 1. Vue d’ensemble du projet

| Élément | Réalité dans ce repo |
|--------|----------------------|
| Runtime | Node 20 + Express (`src/index.ts`) |
| File d’attente | `p-queue` (concurrence configurable) |
| Scraping web | Playwright + stealth **+** extracteurs HTTP (`src/extractors/`) |
| Fallback vidéo | `yt-dlp` (Docker) **+** téléchargement CDN TikTok direct |
| IA | Gemini (`src/services/ai.ts`, `videoAgent.ts`) |
| Persistance | Prisma + SQLite (`prisma/`) |
| Cookies | Netscape `cookies.txt` (IG) / `cookies-tiktok.txt` (TikTok) |

### Pipeline `/process`

```
POST /process { url }
  → validateRequest (SSRF)
  → queue
  → ScraperService.scrapeUrl()
       1. extractPostMetadata()  [HTTP — prioritaire]
       2. Playwright DOM + screenshot + commentaires DOM
  → AIService.extractRecipe()
  → si incomplet → processVideoRecipe()
       TikTok: CDN direct → yt-dlp (cascade)
  → réponse JSON + option save Prisma
```

---

## 2. Architecture de scraping (cascade réelle)

### Niveau 0 — Métadonnées HTTP (implémenté)

**Philosophie :** lire le JSON embarqué dans la page TikTok / Instagram, pas simuler toute l’app mobile (X-Gorgon, etc.) — trop fragile pour un side-project.

| Plateforme | Fichier | Méthode |
|------------|---------|---------|
| TikTok | `src/extractors/tiktok.ts` | `__UNIVERSAL_DATA_FOR_REHYDRATION__` ou `SIGI_STATE` + `/api/comment/list/` |
| Instagram | `src/extractors/instagram.ts` | GraphQL `doc_id=10015901848480474` si `sessionid` dans cookies, sinon JSON-LD HTML |

**Orchestrateur :** `src/extractors/index.ts` → `extractPostMetadata(url)`

### Niveau 1 — Playwright (existant, complété)

- TikTok : UA **desktop Chrome**, viewport 1280×720 (meilleur hydratation que mobile seul).
- Instagram : UA mobile iPhone (inchangé).
- Cookies filtrés par hostname (`src/utils/httpCookies.ts`).

### Niveau 2 — Vidéo

1. **TikTok CDN** : URL `downloadAddr` / `playAddr` extraite du JSON → `fetch` + cookies (`videoAgent.ts`).
2. **yt-dlp** : cascade 720p → best, avec `--extractor-args` TikTok et cookies copiés dans `/tmp`.

### Niveau 3 — Non implémenté (roadmap)

- Apify (`APIFY_API_TOKEN`) — voir §5.
- Microservice signature TikTok (`TIKTOK_SIGNER_URL`) — seulement si le niveau 0–2 échoue systématiquement.
- Proxies résidentiels (`PROXY_URLS`) — utile en datacenter si cookies seuls ne suffisent pas.

---

## 3. TikTok — diagnostic et bonnes pratiques

### Pourquoi « ça ne marchait pas »

1. **Cookies par domaine** : `cookies.txt` Instagram ≠ TikTok. Fichier dédié obligatoire : `cookies-tiktok.txt` / `COOKIES_TIKTOK_PATH`.
2. **Fichier cookies pollué** : exports navigateur contenant des milliers de lignes (autres sites). → Le code filtre désormais par hostname (`.tiktok.com` uniquement).
3. **yt-dlp seul** : souvent bloqué sans session + mauvais extractor-args. → Le JSON embarqué fournit une URL CDN directe.
4. **Playwright mobile** : parfois page vide / login. → UA desktop + données API en amont.

### Checklist opérationnelle

- [ ] Exporter cookies **depuis tiktok.com** (nav privée / profil dédié), format Netscape — **uniquement tiktok.com**.
- [ ] Nettoyer le fichier pollué : `npm run cookies:clean:tiktok` puis remplacer `cookies-tiktok.txt` (ou `--in-place`).
- [ ] Monter le volume Docker : `./cookies-tiktok.txt:/app/cookies-tiktok.txt:ro`
- [ ] `docker compose up --build -d`
- [ ] Tests happy path (voir logs) :
  1. Lien court `vm.tiktok.com/...` → résolution URL canonique
  2. `[TikTok] API metadata` + commentaires JSON dans le prompt Gemini
  3. `TikTok CDN direct download` avant yt-dlp si possible
- [ ] Logs : `[Cookies] Filtre … N → M entrées` à chaque téléchargement yt-dlp

### Variables d’environnement

```env
COOKIES_PATH=/app/cookies.txt
COOKIES_TIKTOK_PATH=/app/cookies-tiktok.txt
GEMINI_API_KEY=...
# Optionnel (roadmap)
APIFY_API_TOKEN=
PROXY_URLS=
INSTAGRAM_SESSION_ID=   # alternative au cookie file pour IG GraphQL
```

---

## 4. Instagram — améliorations

| Approche | Statut |
|----------|--------|
| GraphQL reel (`doc_id` media) | Implémenté si `sessionid` dans `cookies.txt` |
| JSON-LD dans HTML | Fallback |
| Playwright DOM + commentaires | Toujours actif en complément |

**Recommandation :** compte burner, exporter `cookies.txt` depuis instagram.com, ne pas committer le fichier.

---

## 5. Modèle de données (actuel vs spec v2)

Le schéma Prisma actuel est **plus simple** que la spec « RecipeMe v2 » (ingredients/steps en tableaux de strings, pas `Ingredient` structuré).

```typescript
// src/types/index.ts — contrat API actuel
interface Recipe {
  title: string;
  ingredients: string[];
  steps: string[];
  source_url: string;
  tips?: string[];
  // ...
}
```

Évolution possible (hors scope immédiat) : migrer vers ingredients structurés + Zod strict comme dans l’ancienne spec §3.

---

## 6. Prompt Gemini (aligné produit)

- **Web** (`ai.ts`) : priorité `DESCRIPTION_FULL` (inclut bloc API), commentaires utilisateurs, détection `isIncomplete`.
- **Vidéo** (`videoAgent.ts`) : JSON strict, français, analyse audio+visuel.

Température basse recommandée si vous durcissez les configs (actuellement modèle `gemini-flash-latest`).

---

## 7. Directives pour l’agent Cursor (ce dépôt)

### À faire

- Étendre `src/extractors/` avant d’ajouter de la complexité Playwright.
- Réutiliser `utils/platform.ts`, `utils/httpCookies.ts`, `utils/cookies.ts`.
- Conserver la copie cookies → `/tmp` pour yt-dlp (read-only Docker).
- Logger via `pino` dans `index.ts` ; `console` toléré dans services legacy.

### À ne pas faire sans demande explicite

- Réécrire en Next.js / R2 / undici-only.
- Hardcoder `sessionid`, tokens, algorithmes X-Gorgon.
- Charger des vidéos > 50 Mo entièrement en RAM sans besoin.
- Commiter `cookies*.txt`.

### Tests manuels suggérés

```bash
docker compose up --build -d
curl -X POST http://localhost:5000/process \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://www.tiktok.com/@USER/video/VIDEO_ID\"}"
```

---

## 8. Roadmap priorisée

| Priorité | Tâche | Impact |
|----------|-------|--------|
| P0 | Cookies TikTok valides + déploiement volume | Débloque prod |
| P1 | ✅ Extracteurs HTTP + CDN direct | Fait |
| P2 | Apify fallback optionnel (`APIFY_API_TOKEN`) | Secours datacenter |
| P3 | Proxies résidentiels rotatifs | Anti-429 massif |
| P4 | Schéma recette structuré (Zod + Prisma JSON) | Qualité données |

---

## 9. Fichiers clés (carte)

```
src/
  index.ts                 # POST /process
  services/
    scraper.ts             # API + Playwright
    videoAgent.ts          # CDN TikTok + yt-dlp + Gemini vidéo
    ai.ts                  # Gemini texte/image
  extractors/
    tiktok.ts              # JSON embarqué + commentaires API
    instagram.ts           # GraphQL + JSON-LD
    index.ts
  utils/
    cookies.ts             # Netscape parse + chemins
    httpCookies.ts         # Filtre domaine + Cookie header
    platform.ts            # Détection URL / IDs
```

---

## Annexe — Spec « furtive » originale (archivée conceptuellement)

L’ancienne version de ce document décrivait :

- API mobile TikTok signée (X-Gorgon / msToken)
- `tls-client`, proxies Bright Data, Cloudflare R2
- Route Next.js `/api/recipeme/extract`

**Non retenu tel quel** : coût ops élevé, maintenance signatures, stack différente. Les idées utiles sont reprises au §2 (cascade, commentaires triés par likes, fallback Apify en roadmap).

---

*Recipe Scraper API — documentation maintenue avec le code source.*
