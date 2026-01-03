# 🥘 RecipeMe Scraper API

> **Le Cerveau de l'Opération.**  
> Ce microservice est le moteur d'ingestion intelligent de RecipeMe. Il transforme n'importe quel lien Instagram, TikTok ou Web en une recette structurée, propre et prête à cuisiner.

---

## 🧐 Pourquoi ce service ?

Récupérer une recette sur internet en 2026 est un enfer : pop-ups, murs de connexion, vidéos de 30 secondes pour une liste d'ingrédients...  
Ce service résout ça avec une approche **"Force Brute Intelligente"** :

1.  **Il voit ce que vous voyez** : Utilise un navigateur réel (Playwright) pour charger la page.
2.  **Il est malin** : Si Instagram bloque le texte derrière un login, il va chercher les données cachées (`JSON-LD`, `Meta Tags`) et analyse visuellement la page via Screenshot.
3.  **Il est persévérant** : Scrolle automatiquement pour charger les commentaires et dénicher les astuces des utilisateurs ("Cuire à 180°C, pas 160 !").
4.  **Il est polyglotte** : Traduit et normalise tout en Français via Gemini 1.5 Flash.

---

## 🚀 Architecture Technique

Ce projet est conçu comme un **Microservice Dockerisé**.

-   **Runtime** : Node.js + Express
-   **Engine** : Playwright (Chromium Headless) avec `puppeteer-extra-plugin-stealth` pour éviter la détection de bot.
-   **AI Core** : Google Gemini 1.5 Flash (Vision + Texte) pour l'extraction structurée.
-   **Infrastructure** : Docker Compose (prêt pour Hetzner/VPS).

---

## 🛠️ Installation & Démarrage

### Pré-requis
-   Docker & Docker Compose
-   Une clé API Google Gemini (Gratuite)

### 1. Configuration
Créez un fichier `.env` à la racine :

```bash
PORT=5000
GEMINI_API_KEY=votre_clé_api_ici
# Optionnel : URL de callback ou autre
```

### 2. Lancement (Mode Production / Docker)
C'est la méthode recommandée. L'image Docker inclut toutes les dépendances lourdes (Navigateurs, FFMPEG...).

```bash
docker-compose up --build -d
```
Le service écoutera sur `http://localhost:5000`.

### 3. Lancement (Mode Développement)
Si vous voulez bricoler le code :

```bash
npm install
npm run dev
```

---

## 🔌 Documentation API

Il n'y a qu'une seule route maîtresse. Simple et efficace.

### `POST /process`

Envoie une URL à analyser. Le processus peut prendre 10 à 30 secondes (le temps de scroller, capturer, et réfléchir).

**Requête :**
```json
{
  "url": "https://www.instagram.com/reel/DQcSVKQDBl7/..."
}
```

**Réponse (Succès 200) :**
```json
{
  "success": true,
  "data": {
    "title": "ONE POT PASTA BUTTERNUT",
    "ingredients": [
      "1/2 courge butternut",
      "220g de pâtes",
      "..."
    ],
    "steps": [
      "Éplucher la courge...",
      "Cuire 40min à 180°C..."
    ],
    "tips": [
      "Utilisez des pâtes courtes pour une meilleure cuisson."
    ],
    "servings": "2 personnes",
    "prep_time": "15 min",
    "cook_time": "40 min",
    "source_url": "...",
    "id": "uuid..."
  }
}
```

---

## 🧠 Logique de Scraping ("Smart Fallback")

Pour garantir un taux de succès de ~99%, le scraper utilise une stratégie en cascade :

1.  **Tentative UI** : Clic sur "Afficher plus", suppression des modales de login, scroll pour charger les commentaires.
2.  **Extraction DOM** : Récupération du texte visible complet (`FULL_VISIBLE_BODY`) et de la légende spécifique (`PRIORITY_CAPTION`).
3.  **Extraction Meta (Fallback)** : Si le DOM est bloqué, récupération de la `Meta Description` et du `JSON-LD` (données structurées cachées pour Google).
4.  **Vision IA** : En dernier recours ou en complément, une capture d'écran est envoyée à Gemini pour lire le texte incrusté dans l'image/vidéo.

---

## 🌍 Déploiement (Hetzner / VPS)

Ce service est conçu pour fonctionner de pair avec la Webapp RecipeMe (Next.js).

Dans votre `docker-compose.yml` global :
1.  Mettez ce service et la Webapp dans le même `network`.
2.  La Webapp doit appeler le scraper via son nom de conteneur : `http://scraper:5000/process`.
3.  Pas besoin d'exposer le port 5000 sur Internet (sécurité), laissez-le en interne.

---

## 👨‍💻 Auteur

Créé avec passion par **Chhaju**.
👉 Portfolio : [chhaju.fr](https://chhaju.fr)

*Fait avec ❤️ (et beaucoup de café) pour RecipeMe.*
