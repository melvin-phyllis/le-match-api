# Le Match — Backend

Backend API Node.js/Express pour l’application de rencontres **Le Match**. Gère l’authentification, les profils, les conversations (chat, images, audio), la découverte en direct par vidéo (WebRTC via Socket.io) et le backoffice admin.

---

## Technologies

| Technologie   | Usage                            |
|---------------|----------------------------------|
| **Node.js**   | Runtime                         |
| **Express**   | API REST                        |
| **MongoDB**   | Base de données (Mongoose)      |
| **Socket.io** | WebSocket (queue, matching, WebRTC signaling) |
| **JWT**       | Authentification                |
| **Firebase Admin** | Connexion Google             |
| **bcryptjs**  | Hash des mots de passe          |
| **Multer**    | Upload fichiers (images, audio, APK) |
| **Helmet**    | Sécurité HTTP                   |
| **CORS**      | Origines autorisées             |

---

## Structure du projet

```
backend/
├── src/
│   ├── app.js              # Point d'entrée, routes, serveur HTTP + Socket.io
│   ├── config/
│   │   ├── db.js           # Connexion MongoDB
│   │   ├── firebase.js     # Configuration Firebase Admin (Google Auth)
│   │   └── seedAdmin.js    # Création du compte admin au démarrage
│   ├── middlewares/
│   │   ├── auth.js         # JWT utilisateur (requireAuth)
│   │   ├── requireAdmin.js # JWT + vérification isAdmin
│   │   ├── errorHandler.js # Gestion des erreurs
│   │   └── upload.js       # Multer (images messages, audio)
│   ├── models/
│   │   ├── User.js         # Utilisateur (profil, isAdmin, isBanned)
│   │   ├── Conversation.js # Conversations + messages (text, image, audio)
│   │   ├── Report.js       # Signalements
│   │   └── AppVersion.js   # Versions APK uploadées
│   ├── routes/
│   │   ├── auth.js         # /auth (register, login, google)
│   │   ├── admin.js        # /admin (stats, users, reports, sessions, app)
│   │   ├── profile.js      # /api/profile
│   │   ├── swipe.js        # /api/swipe (likes, matchs)
│   │   ├── conversations.js# /api/conversations
│   │   ├── report.js       # /api/report
│   │   └── app.js          # /api/app (info, download APK)
│   ├── sockets/
│   │   ├── index.js        # Queue, matching, WebRTC signaling
│   │   └── state.js        # Maps partagées (users, queue, sessions)
│   └── utils/
│       ├── notifications.js # Push FCM
│       └── compatibility.js # Score de compatibilité
├── uploads/                # Fichiers uploadés (messages, app)
├── .env.example
├── package.json
└── README.md
```

---

## Installation

### Prérequis

- Node.js 18+
- MongoDB (local ou Atlas)
- Compte Firebase (pour la connexion Google, optionnel)

### Étapes

1. **Cloner et installer les dépendances**

```bash
cd backend
npm install
```

2. **Configurer les variables d'environnement**

```bash
cp .env.example .env
```

3. **Renseigner le fichier `.env`** (voir section suivante)

4. **Démarrer le serveur**

```bash
# Développement (avec nodemon)
npm run dev

# Production
npm start
```

Le serveur écoute par défaut sur le port **3000**.

---

## Variables d'environnement

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `PORT` | Non | Port du serveur (défaut: 3000) |
| `NODE_ENV` | Non | `development` ou `production` (impacte CORS) |
| `MONGODB_URI` | Oui | URI MongoDB (ex: `mongodb+srv://...`) |
| `JWT_SECRET` | Oui | Secret pour signer les JWT |
| `ALLOWED_ORIGINS` | Non | Origines CORS séparées par virgules (en production) |
| `BASE_URL` | Non | URL de base du serveur (pour les liens de téléchargement APK) |
| `FIREBASE_PROJECT_ID` | Non* | Projet Firebase (Google Auth) |
| `FIREBASE_CLIENT_EMAIL` | Non* | Email du compte de service Firebase |
| `FIREBASE_PRIVATE_KEY` | Non* | Clé privée Firebase (échapper `\n`) |
| `ADMIN_SEED_EMAIL` | Non | Email admin par défaut (sinon: guehiphilippe@ya-consulting.com) |
| `ADMIN_SEED_PASSWORD` | Non | Mot de passe admin par défaut |

\* Requis uniquement pour `/auth/google`. Sans Firebase, le backend démarre mais cette route retourne 503.

---

## API REST

### Authentification (`/auth`)

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/auth/register` | Non | Inscription (name, email, password, avatarUrl, age, city, bio, hobbies, language) |
| POST | `/auth/login` | Non | Connexion (email, password) |
| POST | `/auth/google` | Non | Connexion Google (idToken) |

Réponse typique : `{ token, user: { _id, name, email, avatarUrl } }`.

---

### Profil (`/api/profile`)

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/api/profile` | JWT | Profil de l'utilisateur connecté |
| PUT | `/api/profile` | JWT | Mise à jour (name, age, bio, city, avatarUrl, hobbies, ageMin, ageMax) |
| GET | `/api/profile/:id` | JWT | Profil public d'un utilisateur |
| POST | `/api/profile/fcm-token` | JWT | Enregistrer le token FCM pour les push notifications |

---

### Swipe / Matchs (`/api/swipe`)

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/api/swipe` | JWT | `{ targetId, action: "like" | "dislike" }` — crée une conversation si match mutuel |

---

### Conversations (`/api/conversations`)

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/api/conversations` | JWT | Liste des conversations |
| GET | `/api/conversations/:id` | JWT | Détail + messages |
| POST | `/api/conversations` | JWT | Créer ou récupérer une conversation (`targetId`) |
| POST | `/api/conversations/:id/messages` | JWT | Envoyer un message (`content`, `type`: text/image/audio) |
| POST | `/api/conversations/:id/upload-image` | JWT | Upload image (form-data `image`) |
| POST | `/api/conversations/:id/upload-audio` | JWT | Upload audio (form-data `audio`) |

---

### Signalements (`/api/report`)

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/api/report` | JWT | `{ reportedUser, conversationId?, reason }` — raison: Contenu inapproprié, Harcèlement, Spam, Comportement suspect |

---

### Application Android (`/api/app`)

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/api/app/info` | Non | `{ hasApp, version, uploadedAt, downloadUrl }` |
| GET | `/api/app/download` | Non | Redirection vers l’APK le plus récent |

---

### Admin (`/admin`)

Toutes les routes admin exigent un JWT avec `isAdmin: true` (`Authorization: Bearer <token>`).

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/admin/login` | Connexion admin (email, password) |
| GET | `/admin/stats` | Stats : totalUsers, matchesToday, messagesToday, pendingReports, signupsByDay, recentActivity |
| GET | `/admin/users` | Liste utilisateurs (search, page) |
| GET | `/admin/users/export` | Export de tous les utilisateurs (JSON) |
| GET | `/admin/users/:id` | Détail d'un utilisateur |
| PATCH | `/admin/users/:id/ban` | Bannir / débannir |
| DELETE | `/admin/users/:id` | Supprimer un utilisateur |
| GET | `/admin/reports` | Liste des signalements (filter: status) |
| PATCH | `/admin/reports/:id` | Mettre à jour le statut (En attente, Résolu, Ignoré) |
| GET | `/admin/sessions` | Sessions vidéo actives |
| GET | `/admin/app` | Infos sur l’APK actuel |
| POST | `/admin/app/upload` | Upload APK (form-data: `apk`, `version`) |

---

## Socket.io (Découverte en direct)

La découverte vidéo type Omegle/OmeTV utilise une **queue** Socket.io et du **WebRTC** pour la vidéo P2P.

### Authentification

Connexion avec `auth.token` ou header `Authorization: Bearer <token>`.

### Événements principaux

| Événement | Direction | Description |
|-----------|-----------|-------------|
| `queue:join` | Client → Serveur | Rejoindre la file d'attente |
| `queue:waiting` | Serveur → Client | En attente d'un partenaire |
| `match:found` | Serveur → Client | Partenaire trouvé (`{ partnerId, sessionId, isCaller }`) |
| `match:like` | Client → Serveur | Liker le partenaire |
| `match:skip` | Client → Serveur | Passer / disliker |
| `match:mutual` | Serveur → Client | Match mutuel → conversation créée |
| `match:ended` | Serveur → Client | Session terminée |
| `rtc:offer` | Client → Serveur → Client | Offre SDP WebRTC |
| `rtc:answer` | Client → Serveur → Client | Réponse SDP |
| `rtc:ice-candidate` | Client → Serveur → Client | ICE candidate |

### Flux résumé

1. L’utilisateur ouvre Découverte → `queue:join` → `queue:waiting` si personne en attente.
2. Un deuxième utilisateur rejoint → `match:found` pour les deux (le premier reçoit `isCaller: true`).
3. Échange SDP et ICE → connexion WebRTC vidéo.
4. Like / Skip pendant la session → si les deux likent → `match:mutual` et création de conversation.

---

## Modèles de données

### User

- `name`, `email`, `passwordHash`, `googleId`
- `avatarUrl`, `age`, `city`, `bio`, `hobbies`
- `gender`, `lookingFor`, `language`
- `ageMin`, `ageMax`
- `location` (GeoJSON Point)
- `fcmToken`
- `isBanned`, `isAdmin`

### Conversation

- `participants` (ObjectId[])
- `messages` : `{ senderId, content, sentAt, read, type, duration }`
- `lastMessage`, `lastActivity`

### Report

- `reportedBy`, `reportedUser`, `conversationId?`
- `reason` (enum), `status` (En attente, Résolu, Ignoré)

### AppVersion

- `version`, `filename`, `filePath`, `uploadedBy`

---

## Fichiers statiques

- `/uploads` : dossiers `messages/` (images), `audio/`, `app/` (APK).
- Les URLs d’images/audio sont de la forme : `{BASE_URL}/uploads/messages/xxx.jpg`, etc.

---

## Compte admin par défaut

Au premier démarrage, un admin est créé si aucun n’existe :

- Email : `guehiphilippe@ya-consulting.com` (ou `ADMIN_SEED_EMAIL`)
- Mot de passe : `9Tc+L1MC8e}f` (ou `ADMIN_SEED_PASSWORD`)

En production, changez ces valeurs ou désactivez le seed après création manuelle.

---

## Développement

```bash
npm run dev   # Nodemon (redémarrage auto)
```

En mode `development`, CORS accepte toutes les origines pour faciliter les tests (localhost, IP privées, etc.).
