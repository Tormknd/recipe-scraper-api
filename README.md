# RecipeMe Scraper API

API intelligente de scraping et d'extraction de recettes depuis les réseaux sociaux (Instagram, TikTok) utilisant l'IA multimodale Google Gemini 1.5 Flash.

## 🎯 Fonctionnalités

### Scraping Hybride Intelligent
- **Scraping Web** : Extraction automatique depuis le DOM, meta tags et screenshots
- **Analyse Vidéo IA** : Fallback automatique vers l'analyse vidéo/audio si les données web sont incomplètes
- **Détection d'incomplétude** : Gemini détecte automatiquement si les informations extraites sont insuffisantes et bascule sur l'analyse vidéo

### Analyse Multimodale
- **Vision** : Analyse des screenshots et images
- **Audio + Vidéo** : Analyse complète des vidéos (visuel + audio) pour extraire les recettes
- **Optimisation RAM** : Limitation à 720p pour économiser la mémoire

### Métriques et Monitoring
- **Tokens Gemini** : Suivi des tokens d'entrée, de sortie et totaux
- **Coûts estimés** : Calcul automatique des coûts en EUR par requête
- **Ressources système** : Monitoring CPU, RAM, réseau et disque
- **Méthode utilisée** : Indication claire de la méthode (web_scraping ou video_ai)

## 🏗️ Architecture

```
┌─────────────────┐
│   Client API    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Express API    │ ◄── Rate Limiting, CORS, Helmet
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   P-Queue       │ ◄── Concurrency: 1 (optimisé 4GB RAM)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Scraper Service │ ──► Playwright (Chromium)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   AI Service    │ ──► Gemini Flash (Web Scraping)
└────────┬────────┘
         │
         ├─── Données incomplètes ? ──►
         │
         ▼
┌─────────────────┐
│ Video Agent     │ ──► yt-dlp + Gemini 1.5 Flash (Vidéo)
└─────────────────┘
```

## 📋 Prérequis

- **Node.js** 20+ (ou Docker)
- **Docker** et **Docker Compose** (recommandé)
- **Clé API Google Gemini** (`GEMINI_API_KEY`)
- **Serveur** : Minimum 4GB RAM (optimisé pour Hetzner VPS)

## 🚀 Installation

### Option 1 : Docker (Recommandé)

1. **Cloner le repository**
```bash
git clone <repository-url>
cd scraper-api
```

2. **Configurer les variables d'environnement**
```bash
cp .env.example .env
# Éditer .env et ajouter votre GEMINI_API_KEY
```

3. **Construire et démarrer**
```bash
docker-compose up --build -d
```

4. **Vérifier le statut**
```bash
curl http://localhost:5000/health
```

### Option 2 : Installation Locale

1. **Installer les dépendances**
```bash
npm install
```

2. **Configurer l'environnement**
```bash
cp .env.example .env
# Éditer .env
```

3. **Build TypeScript**
```bash
npm run build
```

4. **Démarrer l'API**
```bash
npm start
# ou en mode développement
npm run dev
```

## 🔧 Configuration

### Variables d'environnement

Créer un fichier `.env` à la racine :

```env
# API Configuration
PORT=5000

# Google Gemini API
GEMINI_API_KEY=your_gemini_api_key_here

# CORS (optionnel)
ALLOWED_ORIGIN=*

# Environment
NODE_ENV=production
```

### Docker Compose - Limites de ressources

Le fichier `docker-compose.yml` est configuré pour un serveur 4GB RAM :

```yaml
deploy:
  resources:
    limits:
      cpus: '1.50'
      memory: 3G
    reservations:
      memory: 512M
```

## 📡 Utilisation de l'API

### Endpoint : `/process`

Extrait une recette depuis une URL Instagram ou TikTok.

**Requête :**
```bash
POST http://localhost:5000/process
Content-Type: application/json

{
  "url": "https://www.instagram.com/reel/ABC123/",
  "forceVideo": false  // Optionnel : force l'analyse vidéo
}
```

**Réponse (Succès) :**
```json
{
  "success": true,
  "method": "video_ai",
  "data": {
    "id": "uuid",
    "title": "Pasta Carbonara",
    "ingredients": [
      "200g de pâtes",
      "100g de lardons",
      "2 œufs",
      "50g de parmesan"
    ],
    "steps": [
      "Cuire les pâtes",
      "Faire revenir les lardons",
      "Mélanger avec les œufs et le parmesan"
    ],
    "prep_time": "10 min",
    "cook_time": "15 min",
    "servings": "2 personnes",
    "tips": ["Utiliser du parmesan frais"],
    "source_url": "https://www.instagram.com/reel/ABC123/",
    "image_url": "https://..."
  },
  "usage": {
    "promptTokens": 150000,
    "candidatesTokens": 5000,
    "totalTokens": 155000,
    "costEUR": 0.013845
  }
}
```

**Réponse (Erreur) :**
```json
{
  "success": false,
  "error": "Failed to process recipe",
  "message": "Invalid URL provided"
}
```

### Endpoint : `/health`

Vérifie le statut de l'API.

**Requête :**
```bash
GET http://localhost:5000/health
```

**Réponse :**
```json
{
  "status": "ok",
  "queueSize": 0,
  "pending": 0,
  "memory": "77.18 MB"
}
```

## 🧪 Tests

Un script de test complet est fourni pour valider le fonctionnement :

```bash
node test-api.js
```

Le script :
- ✅ Vérifie la santé de l'API
- ✅ Teste chaque URL du tableau `testUrls`
- ✅ Affiche les métriques détaillées (tokens, coûts, ressources)
- ✅ Génère un résumé global avec coûts totaux

**Configuration des tests :**
Éditer `test-api.js` et modifier le tableau `testUrls` :

```javascript
const testUrls = [
  'https://www.instagram.com/reel/ABC123/',
  'https://vm.tiktok.com/XYZ789/',
];
```

## 💰 Coûts Gemini

### Tarification (Gemini Flash)
- **Input** : $0.075 / 1M tokens (~0.069 EUR)
- **Output** : $0.30 / 1M tokens (~0.276 EUR)

### Estimation des coûts
- **Scraping Web** : ~1,000-5,000 tokens → ~0.0001-0.0005 EUR
- **Analyse Vidéo** : ~100,000-200,000 tokens → ~0.01-0.02 EUR

Les métriques de coûts sont automatiquement calculées et retournées dans chaque réponse.

### Limites Free Tier
- **20 requêtes/jour** par modèle
- **5 requêtes/minute** (depuis décembre 2025)
- Réinitialisation quotidienne à minuit UTC

Pour une utilisation en production, considérer un plan payant : https://ai.google.dev/pricing

## 🔒 Sécurité

- **Rate Limiting** : 100 requêtes / 15 minutes par IP
- **Helmet.js** : Protection des headers HTTP
- **CORS** : Configuration restrictive
- **Validation** : Validation des URLs avec Zod
- **SSRF Protection** : Vérification des URLs pour éviter les attaques SSRF
- **Docker** : Isolation des processus

## 📊 Optimisations

### Gestion de la RAM (4GB serveur)
- ✅ Limitation de la qualité vidéo à 720p max
- ✅ Garbage Collection manuel (`--expose-gc`)
- ✅ Queue avec concurrency = 1
- ✅ Nettoyage automatique des fichiers temporaires
- ✅ Limites Docker (3GB RAM max)

### Performance
- ✅ Cache des dépendances Docker
- ✅ Timeout configurable (5 minutes par défaut)
- ✅ Gestion d'erreurs robuste
- ✅ Logging structuré avec Pino

## 📁 Structure du Projet

```
scraper-api/
├── src/
│   ├── index.ts              # Point d'entrée Express
│   ├── services/
│   │   ├── scraper.ts        # Service de scraping web
│   │   ├── ai.ts             # Service AI (Gemini) pour scraping
│   │   └── videoAgent.ts     # Service d'analyse vidéo
│   ├── types/
│   │   └── index.ts          # Types TypeScript
│   └── utils/
│       └── security.ts       # Validation et sécurité
├── test-api.js               # Script de test
├── Dockerfile                # Image Docker
├── docker-compose.yml        # Configuration Docker Compose
├── package.json
└── README.md
```

## 🔍 Logs

Les logs sont structurés avec Pino et incluent :
- Niveau de log (info, warn, error)
- Timestamp
- Métadonnées contextuelles (URL, méthode, tokens, coûts)

En développement, les logs sont formatés avec `pino-pretty`.

## 🐛 Dépannage

### Le conteneur redémarre en boucle
- Vérifier que `GEMINI_API_KEY` est défini dans `.env`
- Vérifier les logs : `docker-compose logs -f`

### Erreur "Garbage Collector not available"
- Normal en développement local
- En production, le script `start` inclut `--expose-gc`

### Timeout sur les vidéos longues
- Augmenter `API_TIMEOUT` dans `src/index.ts` (par défaut 5 minutes)

### Consommation RAM élevée
- Vérifier les limites Docker dans `docker-compose.yml`
- Réduire la qualité vidéo dans `videoAgent.ts` (actuellement 720p)

### Erreur 429 (Quota API dépassé)
- Le free tier Gemini limite à 20 requêtes/jour
- Attendre la réinitialisation quotidienne (minuit UTC)
- Vérifier l'usage : https://ai.dev/usage?tab=rate-limit
- Considérer un plan payant pour la production

## 📝 Notes Techniques

### Modèles Gemini utilisés
- **Web Scraping** : `gemini-flash-latest` (multimodal - texte + image)
- **Analyse Vidéo** : `gemini-flash-latest` (multimodal - vidéo/audio via inlineData)

### Outils externes
- **Playwright** : Scraping web avec Chromium
- **yt-dlp** : Téléchargement de vidéos (Instagram, TikTok)
- **FFmpeg** : Traitement vidéo (inclus dans Docker)

## 🤝 Contribution

1. Fork le projet
2. Créer une branche (`git checkout -b feature/amazing-feature`)
3. Commit les changements (`git commit -m 'Add amazing feature'`)
4. Push vers la branche (`git push origin feature/amazing-feature`)
5. Ouvrir une Pull Request

## 📄 Licence

ISC

## 👤 Auteur

RecipeMe Team

---

**Version** : 1.0.0  
**Dernière mise à jour** : Janvier 2025
