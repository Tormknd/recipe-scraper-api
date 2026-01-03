# Utilisation de l'image officielle Playwright (basée sur Ubuntu)
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Bonne pratique : ne pas utiliser root. L'image Playwright fournit "pwuser".
# Mais on a besoin de root d'abord pour l'installation des deps Node.

WORKDIR /app

# 1. Copie des fichiers de dépendances
COPY package*.json ./

# 2. Installation des dépendances (en root pour avoir les droits d'écriture globaux si besoin)
# npm ci assure une installation propre basée sur le lockfile
RUN npm ci

# 3. Copie du code source
COPY . .

# 4. Build TypeScript
RUN npm run build

# 5. Permission Fix : On donne la propriété du dossier /app à pwuser
RUN chown -R pwuser:pwuser /app

# 6. Switch vers l'utilisateur non-privilégié pour l'exécution
USER pwuser

# Variables d'environnement par défaut
ENV PORT=5000
ENV NODE_ENV=production

EXPOSE 5000

# Lancement
CMD ["npm", "start"]
