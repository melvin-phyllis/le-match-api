# Configuration proxy cPanel pour Le Match

## Problème actuel

Les requêtes vers `/le-match-api/socket.io` renvoient **"It works! NodeJS 22.22.0"** au lieu de la réponse Socket.io. Cela signifie que le proxy ne redirige pas correctement ces requêtes vers votre application Express.

Les requêtes `/le-match-api/api/*` fonctionnent (fcm-token, conversations, etc.), mais `/le-match-api/socket.io` est traité par un autre handler.

## Solution : Vérifier la configuration proxy

### 1. cPanel → Setup Node.js App

- Assurez-vous que l’**Application root** pointe vers le dossier du backend (celui qui contient `package.json`).
- L’**Application URL** doit être `/le-match-api` (ou le chemin que vous utilisez).
- L’application doit être **démarrée** (bouton "Start").

### 2. Règle proxy Apache

Le proxy doit transmettre **tout** le sous-chemin `/le-match-api` à votre app Node, sans exclure `socket.io`.

Exemple pour un `.htaccess` à la racine du site (ou dans le dossier de l’app) :

```apache
RewriteEngine On
RewriteCond %{REQUEST_URI} ^/le-match-api [OR]
RewriteCond %{REQUEST_URI} ^/le-match-api/
# Préserver le chemin /le-match-api pour Express
RewriteRule ^(le-match-api/.*)$ http://127.0.0.1:PORT/$1 [P,L]
```

Remplacez `PORT` par le port de votre app Node (souvent fourni par cPanel dans Setup Node.js App).

**Important** : si la règle ne préserve pas le chemin (`/le-match-api/...`), l’app Express ne recevra pas les requêtes sous le bon chemin.

### 3. Proxy qui conserve le chemin

Si votre app écoute sur le port 3000 et que vous utilisez `ProxyPass` :

```apache
ProxyPreserveHost On
ProxyPass /le-match-api http://127.0.0.1:3000/le-match-api
ProxyPassReverse /le-match-api http://127.0.0.1:3000/le-match-api
```

### 4. Support WebSocket / long-polling

Socket.io utilise le long-polling HTTP par défaut. Assurez-vous que le proxy n’interrompt pas les requêtes longues (timeout suffisant, pas de buffer qui coupe la réponse).

## Test

Après modification, testez avec :

```bash
curl "https://ya-consulting.com/le-match-api/socket.io/?EIO=4&transport=polling"
```

Réponse attendue (format Engine.IO) :

```
0{"sid":"...","upgrades":["websocket"],...}
```

**À ne pas obtenir** : `It works! NodeJS...`
