**Club Lit – AI‑Powered Digital Library**

- Clean, themed React client + Node/Express API
- MongoDB (Atlas or local), JWT auth, Socket.IO chat
- Styled with the “Club Lit Aurora” design system

**Monorepo Layout**
- `client/` – React app (Vite/CRA style)
- `server/` – Express API, Mongo models, seed + admin helpers

**Prerequisites**
- Node.js 18+
- npm 9+
- MongoDB
  - Option A: MongoDB Atlas (recommended)
  - Option B: Local MongoDB Community + Compass

**Quick Start**
- Clone or unzip this repo.
- Terminal 1 (API):
  - `cd server`
  - `npm install`
  - Create `server/.env` (see below) and confirm DB URI.
  - `npm start`
- Terminal 2 (Web):
  - `cd client`
  - `npm install`
  - Create `client/.env.local` with `REACT_APP_API_URL=http://localhost:8080/api`
  - `npm start`

**Admin Login (Seeded)**
- Email: `seedadmin@clubreaders.com`
- Password: `ChangeMe123!`
- Notes:
  - The server seeds this admin if missing at startup (see `server/seed-data.js`).
  - You can also promote any user: `cd server && node make-admin.js user@example.com`.

**Environment Configuration**
- Files you will create/update:
  - `server/.env`
  - `client/.env.local`

- `server/.env` example
  - `PORT=8080`
  - `DB=<your mongodb uri>`
    - Atlas example: `mongodb+srv://<user>:<pass>@<cluster>/<db>?retryWrites=true&w=majority`
    - Local example: `mongodb://127.0.0.1:27017/clubreader`
  - `JWTPRIVATEKEY=<generate a long secret>`
  - `SALT=10`
  - `NODE_ENV=development`
  - `MASTER_ADMIN_EMAIL=support@clubreaders.com`
  - `SEED_ADMIN_EMAIL=seedadmin@clubreaders.com`
  - `SEED_ADMIN_PASSWORD=ChangeMe123!`

- `client/.env.local` example
  - `REACT_APP_API_URL=http://localhost:8080/api`

**MongoDB Setup**
- Atlas (easier to share)
  - Create a free cluster on mongodb.com
  - Add a database user and allow your IP
  - Copy the connection string into `DB` in `server/.env`
- Local MongoDB + Compass
  - Install MongoDB Community + MongoDB Compass
  - Start MongoDB (default `mongodb://127.0.0.1:27017`)
  - Set `DB=mongodb://127.0.0.1:27017/clubreader` in `server/.env`
  - Optional: open Compass, connect to `127.0.0.1:27017`, create DB `clubreader`

**Seeding & Admin**
- On first API start, `server/seed-data.js` runs:
  - Ensures placeholder assets
  - Creates a seed admin when missing (email/password above)
  - Seeds a few sample books/clubs if empty
- Promote an existing user to admin at any time:
  - `cd server && node make-admin.js user@example.com`

**Development URLs**
- Client: `http://localhost:3000`
- API base: `http://localhost:8080/api`
  - Auth: `/auth/login`, `/auth/register`, `/auth/profile`
  - Users: `/users/*`
  - Books: `/books/*`
  - Clubs: `/clubs/*`
  - Requests: `/book-requests/*`
  - Admin: `/admin/*`

**Design System — Club Lit Aurora**
- Tokens live in `client/src/index.css` under `:root`.
- Primary: cyan (`--primary`) with warm accent (`--accent`).
- Surfaces: `--card`, `--surface`, borders via `--border`, shadows `--shadow-*`.
- Apply chips/pills and glass panels via gradient backgrounds + thin borders.

**Common Tasks**
- Change API URL (dev): edit `client/.env.local`
- Switch DB to local: set `DB=mongodb://127.0.0.1:27017/clubreader` in `server/.env`, restart API
- Reset seed: `cd server && node seed-data.js`

**Troubleshooting**
- CORS or 401 errors
  - Ensure client `REACT_APP_API_URL` points to `http://localhost:8080/api`
  - Clear browser storage and log in again
- Mongo connection fails
  - Verify `DB` string and network/IP allowlist (Atlas)
  - For local, ensure `mongod` is running
- Admin missing
  - Run `node make-admin.js seedadmin@clubreaders.com` or `node seed-data.js`

**Scripts**
- Server: `npm start` (nodemon), `node make-admin.js <email>`, `node seed-data.js`
- Client: `npm start`

**License**
- Internal project. Do not distribute credentials to production systems.
