# RecipeMe Scraper API

API intelligente de scraping et d'extraction de recettes depuis les réseaux sociaux (Instagram, TikTok) utilisant l'IA multimodale Google Gemini 1.5 Flash.

## 🎯 Fonctionnalités

### Scraping Hybride Intelligent

* **Scraping Web** : Extraction automatique depuis le DOM, meta tags et screenshots.
* **Analyse Vidéo IA** : Fallback automatique vers l'analyse vidéo/audio si les données web sont incomplètes.
* **Détection d'incomplétude** : Gemini détecte automatiquement si les informations extraites sont insuffisantes et bascule sur l'analyse vidéo.

### Analyse Multimodale

* **Vision** : Analyse des screenshots et images.
* **Audio + Vidéo** : Analyse complète des vidéos (visuel + audio) pour extraire les recettes.
* **Optimisation RAM** : Limitation à 720p pour économiser la mémoire.

### Métriques et Monitoring

* **Tokens Gemini** : Suivi des tokens d'entrée, de sortie et totaux.
* **Coûts estimés** : Calcul automatique des coûts en EUR par requête.
* **Ressources système** : Monitoring CPU, RAM, réseau et disque.

## 🛡️ Challenges Techniques & Solutions

Le déploiement de ce scraper sur une infrastructure Cloud (type Hetzner/AWS) a nécessité de surmonter plusieurs défis techniques liés aux protections anti-bot et à l'architecture Docker.

### 1. Blocage des IPs Datacenter (Instagram)

Les réseaux sociaux bloquent agressivement les requêtes provenant d'adresses IP de centres de données (Hetzner, AWS) lorsqu'elles sont anonymes, renvoyant des erreurs 429 ou des redirections de login.

* **Solution** : Implémentation d'un système d'authentification par cookies (`cookies.txt` au format Netscape). Cela permet d'authentifier la requête comme venant d'un utilisateur légitime, contournant le blocage géographique/IP.

### 2. Gestion des Permissions Docker (Read-Only)

La librairie `yt-dlp` tente par défaut de réécrire le fichier de cookies pour maintenir la session, ce qui échoue dans un conteneur Docker où les montages sont souvent en lecture seule ou détenus par root (`OSError: Read-only file system`).

* **Solution** : Le service effectue une copie à la volée du fichier `cookies.txt` vers le répertoire temporaire du conteneur (`/tmp`) avant chaque exécution. Cela garantit l'accès en écriture nécessaire sans corrompre le fichier source.

### 3. Fragmentation des Formats Vidéo

Les formats de diffusion (Reels) changent fréquemment (audio séparé, conteneurs mp4/webm), faisant échouer les stratégies de téléchargement strictes.

* **Solution** : Mise en place d'un algorithme de **Fallback en cascade**. L'API tente plusieurs stratégies de la plus précise à la plus générique (ex: "720p Optimized" → "MP4 Fallback" → "Best Available"), assurant un taux de succès maximal.

> **⚖️ Note Éthique & Légale** : L'utilisation de cookies permet l'interopérabilité technique nécessaire au fonctionnement sur serveur. Cependant, ce projet est conçu pour un usage personnel, éducatif ou de démonstration. Le scraping massif de données peut violer les Conditions d'Utilisation (ToS) des plateformes. Il est recommandé d'utiliser un compte dédié secondaire et de respecter des délais raisonnables entre les requêtes.

## 🏗️ Architecture

```mermaid
graph TD
    Client[Client API] --> Express[Express API]
    Express --> Queue[P-Queue (Concurrency: 1)]
    Queue --> Scraper[Scraper Service]
    Scraper -->|Playwright| Web[Web Analysis]
    Web --> Check{Data Complete?}
    Check -->|Yes| Return[Return JSON]
    Check -->|No| VideoAgent[Video Agent]
    VideoAgent -->|Cookies Auth| YTDLP[yt-dlp]
    YTDLP -->|Video File| Gemini[Gemini 1.5 Flash]
    Gemini --> Return

```

## 📋 Prérequis

* **Node.js** 20+ (ou Docker)
* **Docker** et **Docker Compose**
* **Clé API Google Gemini** (`GEMINI_API_KEY`)
* **Fichier(s) Cookies** : Format Netscape (ex. extension "Get cookies.txt LOCALLY"). **Instagram** : `cookies.txt` depuis instagram.com. **TikTok** : les cookies sont **par domaine** — un fichier exporté depuis Instagram ne suffit pas pour TikTok ; il faut exporter depuis tiktok.com dans `cookies-tiktok.txt` (ou `COOKIES_TIKTOK_PATH`).

## 🚀 Installation

### Option 1 : Docker (Recommandé)

1. **Cloner le repository**

```bash
git clone <repository-url>
cd scraper-api

```

2. **Configuration**

```bash
cp .env.example .env
# Ajouter votre GEMINI_API_KEY dans le fichier .env

```

3. **Préparation des Cookies**
* Installez l'extension "Get cookies.txt LOCALLY" (Chrome/Firefox).
* **Instagram** : connectez-vous à Instagram, exportez les cookies dans `cookies.txt`, placez-le à la racine.
* **TikTok** : connectez-vous à tiktok.com, exportez les cookies dans `cookies-tiktok.txt` à la racine (ou définissez `COOKIES_TIKTOK_PATH`). Sans cela, les liens TikTok peuvent échouer (blocage / login requis depuis un datacenter).

4. **Démarrage**

```bash
docker compose up --build -d

```

### Option 2 : Installation Locale

```bash
npm install
npm run build
npm start

```

## 🔧 Configuration

### Variables d'environnement (.env)

```env
PORT=5000
GEMINI_API_KEY=votre_cle_api_ici
NODE_ENV=production
# Base de données (SQLite par défaut)
DATABASE_URL="file:./prisma/dev.db"
# Cookies (format Netscape). Instagram par défaut.
COOKIES_PATH=/app/cookies.txt
# Optionnel : cookies TikTok (obligatoire si vous scrapez des liens TikTok depuis un datacenter)
COOKIES_TIKTOK_PATH=/app/cookies-tiktok.txt

```

### Volume Docker

Le fichier `docker-compose.yml` doit monter le fichier de cookies :

```yaml
services:
  scraper-api:
    volumes:
      - ./cookies.txt:/app/cookies.txt:ro  # Montage en lecture seule (copié dans /tmp par l'app)

```

## 📡 Utilisation de l'API

### Endpoint : `/process`

**Requête :**

```bash
POST http://localhost:5000/process
Content-Type: application/json

{
  "url": "https://www.instagram.com/reel/DRNDWfBiFpn/",
  "forceVideo": false,
  "save": true,
  "tagIds": ["id_tag1"],
  "folderId": "id_dossier_ou_null"
}

```

**Réponse (Exemple Succès) :**

```json
{
  "success": true,
  "method": "video_ai",
  "data": {
    "id": "clx...",
    "title": "Filet de poisson blanc sauce crémeuse",
    "ingredients": ["Cabillaud", "Moutarde", "Crème", "Haricots verts"],
    "steps": ["Saisir le poisson", "Préparer la sauce", "Servir chaud"],
    "source_url": "https://..."
  },
  "saved": true,
  "usage": {
    "totalTokens": 18288,
    "costEUR": 0.0013
  }
}

```

### Recettes, tags et dossiers

- **GET /recipes?q=...&tagIds=id1,id2&folderId=...** — Liste avec recherche (titre, ingrédients, étapes) et filtres par tags (tous requis) et dossier.
- **GET /recipes/:id** — Détail. **POST /recipes** — Créer (body : title, ingredients, steps, source_url, tagIds, folderId). **PATCH /recipes/:id** — Modifier. **DELETE /recipes/:id** — Supprimer.
- **GET /tags** — Liste des tags. **POST /tags** — Créer (body : `{ "name": "sucré" }`).
- **GET /folders** — Liste des dossiers. **GET /folders/:id** — Détail + recettes. **POST /folders** — Créer. **PATCH /folders/:id** — Renommer. **DELETE /folders/:id** — Supprimer (recettes conservées).

## 💰 Coûts et Performance

L'API utilise **Gemini 1.5 Flash**, choisi pour son excellent rapport performance/coût sur l'analyse multimodale.

| Méthode | Coût Moyen (EUR) | Tokens Moyens |
| --- | --- | --- |
| **Web Scraping** (Texte seul) | ~0.0002 € | 1k - 3k |
| **Analyse Vidéo** (Vision + Audio) | ~0.0015 € | 15k - 25k |

*Note : L'analyse vidéo consomme plus de tokens car Gemini analyse le flux visuel image par image, mais reste très économique (~1.50€ pour 1000 vidéos).*

## 🔒 Sécurité

* **Isolation** : Exécution dans un conteneur Docker sécurisé.
* **Nettoyage** : Suppression automatique des vidéos téléchargées et cookies temporaires après analyse.
* **Rate Limiting** : Protection contre les abus d'API.
* **Confidentialité** : Les cookies ne sont jamais exposés dans les logs ou les réponses API.

## 🤝 Contribution

Les contributions sont bienvenues !

1. Fork le projet
2. Créer une branche (`git checkout -b feature/amazing-feature`)
3. Commit les changements (`git commit -m 'Add amazing feature'`)
4. Push vers la branche (`git push origin feature/amazing-feature`)
5. Ouvrir une Pull Request

## 📄 Licence

ISC

---

**Version** : 1.1.0

**Auteur** : Chhaju CHAKMA
