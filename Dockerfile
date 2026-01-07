# Utilisation de Node.js 20 Bookworm comme base
FROM node:20-bookworm

# 1. Installation des dépendances système pour Playwright, Python et FFMPEG
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 2. Création d'un environnement virtuel pour Python (Recommandé par Debian/Bookworm)
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# 3. Installation de yt-dlp (Le téléchargeur vidéo ultime) - Toujours la dernière version
RUN pip3 install --upgrade yt-dlp

# 4. Installation des dépendances Node
WORKDIR /app
COPY package*.json ./
RUN npm ci

# 5. Installation des navigateurs Playwright
RUN npx playwright install chromium --with-deps

# 6. Copie du code source et du fichier cookies (si présent)
COPY . .
# Le fichier cookies.txt sera copié si présent (optionnel, peut être monté via volume)

# 7. Build TypeScript
RUN npm run build

# Variables d'environnement par défaut
ENV PORT=5000
ENV NODE_ENV=production

EXPOSE 5000

# Lancement
CMD ["npm", "start"]
