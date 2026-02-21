# API RecipeMe — Guide pour les frontends

Ce document décrit comment le backend expose les fonctionnalités **recherche de recettes**, **tags** et **dossiers**, afin de brancher facilement un frontend (web, mobile, etc.).

---

## Conventions générales

- **Base URL** : `http://localhost:5000` (ou l’URL de déploiement).
- **Format** : JSON pour les requêtes (`Content-Type: application/json`) et les réponses.
- **Réponse succès** : `{ "success": true, "data": ... }` (parfois d’autres champs selon l’endpoint).
- **Réponse erreur** : `{ "success": false, "error": "Message" }` avec un code HTTP 4xx/5xx.
- **CORS** : GET, POST, PATCH, DELETE autorisés ; en prod, configurer `ALLOWED_ORIGIN`.

---

## 1. Extraction d’une recette depuis une URL (Instagram / TikTok)

Permet d’extraire une recette à partir d’un lien, et optionnellement de **l’enregistrer** en base avec tags et dossier.

### `POST /process`

**Body :**

| Champ        | Type     | Obligatoire | Description |
|-------------|----------|-------------|-------------|
| `url`       | string   | oui         | URL du post (Instagram Reel, TikTok, etc.) |
| `forceVideo`| boolean  | non         | Forcer l’analyse vidéo (défaut : false) |
| `save`      | boolean  | non         | Si true, enregistre la recette en base après extraction |
| `tagIds`    | string[] | non         | IDs des tags à associer (si `save: true`) |
| `folderId`  | string \| null | non  | ID du dossier, ou null (si `save: true`) |

**Exemple :**

```json
{
  "url": "https://www.instagram.com/reel/xxx/",
  "save": true,
  "tagIds": ["clx123", "clx456"],
  "folderId": "clx789"
}
```

**Réponse succès (200) :**

```json
{
  "success": true,
  "method": "web_scraping",
  "data": {
    "id": "clx...",
    "title": "Tarte au citron",
    "ingredients": ["Pâte", "Citrons", "Sucre", "Œufs"],
    "steps": ["Étaler la pâte", "Mélanger la crème", "Enfourner 30 min"],
    "source_url": "https://...",
    "image_url": "https://...",
    "servings": "6",
    "prep_time": "20 min",
    "cook_time": "30 min",
    "tips": []
  },
  "saved": true,
  "usage": { "totalTokens": 2500, "costEUR": 0.0002 }
}
```

- `data` : recette extraite ; si `save: true`, contient aussi `id`.
- `saved` : présent et `true` si la recette a bien été enregistrée.
- Utiliser `data.id` pour afficher la fiche ou faire un `GET /recipes/:id` ensuite.

**Cas frontend typique :**  
Formulaire « Coller un lien » → `POST /process` avec `save: true` et éventuellement `tagIds` / `folderId` sélectionnés → rediriger vers la fiche recette avec `data.id`.

---

## 2. Recettes : recherche, liste, détail, CRUD

### Structure d’une recette (objet renvoyé par l’API)

Chaque recette renvoyée par les endpoints recettes contient au minimum :

```ts
{
  id: string;
  title: string;
  ingredients: string[];
  steps: string[];
  source_url: string;
  image_url?: string;
  servings?: string;
  prep_time?: string;
  cook_time?: string;
  tips?: string[];
  // Lorsque la recette est chargée avec relations :
  tagIds?: string[];
  tagNames?: string[];
  folderId?: string | null;
  folderName?: string | null;
}
```

- `tagIds` / `tagNames` : présents sur liste et détail pour afficher / filtrer par tag.
- `folderId` / `folderName` : présents pour afficher le dossier ou filtrer par dossier.

---

### 2.1 Recherche et filtres (barre de recherche + filtres)

### `GET /recipes`

Liste des recettes avec **recherche texte** et **filtres par tags et dossier**.

**Query params :**

| Paramètre   | Type   | Description |
|------------|--------|-------------|
| `q`        | string | Recherche dans **titre**, **ingrédients** et **étapes** (contient le texte). |
| `tagIds`   | string | IDs de tags séparés par des virgules. La recette doit avoir **tous** ces tags. |
| `folderId` | string | Ne renvoyer que les recettes de ce dossier. |

- Tous les paramètres sont optionnels et peuvent être combinés.
- Exemples :  
  - `GET /recipes?q=chocolat`  
  - `GET /recipes?tagIds=id1,id2`  
  - `GET /recipes?folderId=idDossier`  
  - `GET /recipes?q=citron&folderId=id&tagIds=idTag`

**Réponse (200) :**

```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "title": "Tarte au citron",
      "ingredients": [...],
      "steps": [...],
      "source_url": "https://...",
      "tagIds": ["clx1"],
      "tagNames": ["sucré"],
      "folderId": "clx2",
      "folderName": "Desserts"
    }
  ]
}
```

**Cas frontend typique :**  
Barre de recherche → `q` = valeur saisie ; filtres « Tags » / « Dossier » → `tagIds` et `folderId`. Appeler `GET /recipes` avec ces paramètres et afficher `data` dans une grille ou une liste.

---

### 2.2 Détail d’une recette

### `GET /recipes/:id`

**Réponse (200) :** `{ "success": true, "data": <recette> }` avec la même structure que ci‑dessus (inclut `tagIds`, `tagNames`, `folderId`, `folderName`).

**404** si l’id n’existe pas : `{ "success": false, "error": "Recette introuvable" }`.

---

### 2.3 Créer une recette (saisie manuelle ou après traitement)

### `POST /recipes`

Utilisable pour une recette saisie à la main ou pour enregistrer une recette déjà extraite (ex. si vous n’avez pas utilisé `save: true` sur `/process`).

**Body :**

| Champ         | Type     | Obligatoire | Description |
|--------------|----------|-------------|-------------|
| `title`      | string   | oui         | Titre de la recette |
| `ingredients`| string[] | non         | Liste d’ingrédients (défaut : []) |
| `steps`     | string[] | non         | Étapes (défaut : []) |
| `source_url`| string   | oui         | URL (ex. lien du post) |
| `image_url` | string   | non         | URL de l’image |
| `servings`  | string   | non         | Nombre de parts |
| `prep_time` | string   | non         | Temps de préparation |
| `cook_time` | string   | non         | Temps de cuisson |
| `tips`      | string[] | non         | Conseils |
| `tagIds`    | string[] | non         | IDs des tags à associer |
| `folderId`  | string \| null | non  | ID du dossier, ou null |

**Exemple :**

```json
{
  "title": "Pâtes carbonara",
  "ingredients": ["Pâtes", "Lardons", "Crème", "Parmesan"],
  "steps": ["Cuire les pâtes", "Faire revenir les lardons", "Mélanger et servir"],
  "source_url": "https://example.com/recipe",
  "tagIds": ["clx1"],
  "folderId": "clx2"
}
```

**Réponse (201) :** `{ "success": true, "data": <recette créée> }` (avec `id`, `tagIds`, `tagNames`, `folderId`, `folderName`).

---

### 2.4 Modifier une recette

### `PATCH /recipes/:id`

Mise à jour partielle : envoyer uniquement les champs à modifier (y compris `tagIds` et `folderId`).

**Body (tous optionnels) :** mêmes champs que `POST /recipes` (au moins un champ requis).

- Pour **changer les tags** : envoyer `tagIds` avec la nouvelle liste (remplace l’ancienne).
- Pour **changer de dossier** : envoyer `folderId` (ou `null` pour retirer du dossier).

**Exemple :**

```json
{
  "title": "Nouveau titre",
  "tagIds": ["id1", "id2"],
  "folderId": null
}
```

**Réponse (200) :** `{ "success": true, "data": <recette mise à jour> }`.

**404** si la recette n’existe pas.

---

### 2.5 Supprimer une recette

### `DELETE /recipes/:id`

**Réponse (200) :** `{ "success": true }`.

**404** si la recette n’existe pas.

---

## 3. Tags (pour filtrer et catégoriser)

Les tags permettent de **filtrer** les recettes et de les **retrouver** (recherche + filtre par tag). Une recette peut avoir plusieurs tags.

### 3.1 Liste des tags

### `GET /tags`

À utiliser pour afficher les filtres, l’autocomplete ou les chips de sélection.

**Réponse (200) :**

```json
{
  "success": true,
  "data": [
    { "id": "clx1", "name": "sucré", "recipeCount": 12 },
    { "id": "clx2", "name": "sans gluten", "recipeCount": 3 }
  ]
}
```

- `recipeCount` : nombre de recettes ayant ce tag.

---

### 3.2 Créer un tag

### `POST /tags`

**Body :** `{ "name": "sucré" }` (nom unique, trimmé).

- Si un tag avec ce nom existe déjà, l’API renvoie quand même **201** avec le tag existant (éviter les doublons côté front en réutilisant l’id).

**Réponse (201) :** `{ "success": true, "data": { "id": "clx...", "name": "sucré" } }`.

**Cas frontend typique :**  
Saisie « Nouveau tag » → `POST /tags` → utiliser `data.id` dans `tagIds` lors de la création / édition de recette.

---

## 4. Dossiers (ex. Sucré, Salé, Apéro)

Un dossier regroupe des recettes (ex. « Sucré », « Salé »). Une recette appartient à **au plus un** dossier.

### 4.1 Liste des dossiers

### `GET /folders`

Pour afficher la sidebar ou le sélecteur de dossier.

**Réponse (200) :**

```json
{
  "success": true,
  "data": [
    {
      "id": "clx1",
      "name": "Sucré",
      "recipeCount": 8,
      "createdAt": "2025-02-21T...",
      "updatedAt": "2025-02-21T..."
    }
  ]
}
```

---

### 4.2 Détail d’un dossier (avec recettes)

### `GET /folders/:id`

Récupère le dossier et **toutes les recettes** qu’il contient (avec tags et nom du dossier).

**Réponse (200) :**

```json
{
  "success": true,
  "data": {
    "id": "clx1",
    "name": "Sucré",
    "recipeCount": 8,
    "createdAt": "...",
    "updatedAt": "...",
    "recipes": [
      { "id": "...", "title": "Tarte au citron", "tagIds": [...], "folderId": "clx1", "folderName": "Sucré", ... }
    ]
  }
}
```

**Cas frontend typique :**  
Clic sur un dossier dans la sidebar → `GET /folders/:id` → afficher `data.recipes` dans la vue « Dossier ».

---

### 4.3 Créer un dossier

### `POST /folders`

**Body :** `{ "name": "Sucré" }` (1–200 caractères, trimmé).

**Réponse (201) :** `{ "success": true, "data": { "id": "...", "name": "Sucré", "createdAt": "...", "updatedAt": "..." } }`.

---

### 4.4 Renommer un dossier

### `PATCH /folders/:id`

**Body :** `{ "name": "Nouveau nom" }`.

**Réponse (200) :** `{ "success": true, "data": <dossier> }`.

**404** si le dossier n’existe pas.

---

### 4.5 Supprimer un dossier

### `DELETE /folders/:id`

Supprime le dossier. Les recettes ne sont **pas** supprimées : leur `folderId` est mis à `null`.

**Réponse (200) :** `{ "success": true }`.

**404** si le dossier n’existe pas.

---

## 5. Scénarios frontend résumés

| Besoin | Endpoints à utiliser |
|--------|----------------------|
| Barre de recherche | `GET /recipes?q=<texte>` |
| Filtre par tags (plusieurs tags requis) | `GET /recipes?tagIds=id1,id2` |
| Filtre par dossier | `GET /recipes?folderId=<id>` |
| Recherche + filtre dossier + filtre tags | `GET /recipes?q=...&folderId=...&tagIds=...` |
| Afficher les filtres (tags / dossiers) | `GET /tags`, `GET /folders` |
| Ajouter une recette depuis un lien | `POST /process` avec `save: true`, puis afficher `data.id` ou faire `GET /recipes/:id` |
| Créer une recette à la main | `POST /recipes` avec titre, ingredients, steps, source_url, optionnellement tagIds, folderId |
| Modifier tags / dossier d’une recette | `PATCH /recipes/:id` avec `tagIds` et/ou `folderId` |
| Vue « Dossier » (liste des recettes du dossier) | `GET /folders/:id` → afficher `data.recipes` |
| Nouveau tag (création à la volée) | `POST /tags` avec `name` → utiliser `data.id` dans `tagIds` |
| Nouveau dossier | `POST /folders` avec `name` → utiliser `data.id` dans `folderId` |

---

## 6. Codes HTTP et erreurs

- **200** : Succès (GET, PATCH, DELETE).
- **201** : Création (POST /recipes, POST /tags, POST /folders, parfois POST /process si enregistrement).
- **400** : Body invalide (ex. URL invalide, champs manquants) → `details` possible dans la réponse.
- **404** : Ressource introuvable (recette, dossier, etc.).
- **500** : Erreur serveur → `{ "success": false, "error": "Message" }`.

En cas d’erreur, toujours vérifier `success === false` et afficher `error` (et éventuellement `details`) à l’utilisateur.
