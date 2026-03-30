# Creating Connections — Connections Matrix

Compatibility matrix app for postgraduate design studio group formation.

**Domain**: https://creatingconnections.site/

## Requirements

- **Node.js 22+** (uses built-in `node:sqlite`)

## Deploy to Railway

### 1. Push to GitHub

```bash
cd connections-matrix
git init
git add .
git commit -m "Initial commit"
```

Create a new repo on GitHub, then:
```bash
git remote add origin https://github.com/YOUR-USERNAME/connections-matrix.git
git push -u origin main
```

### 2. Connect Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. **New Project** → **Deploy from GitHub Repo** → select `connections-matrix`
3. Railway auto-detects Node.js and runs `npm start`

### 3. Set environment variables

In the Railway dashboard, go to your service → **Variables** and add:

| Variable | Value |
|----------|-------|
| `ADMIN_PASSWORD` | your chosen password |

(`PORT` is set automatically by Railway.)

### 4. Custom domain

1. In Railway: **Settings** → **Networking** → **Custom Domain** → add `creatingconnections.site`
2. Railway gives you a CNAME target (e.g. `xxx.up.railway.app`)
3. In DreamHost DNS panel: add a **CNAME** record for `creatingconnections.site` pointing to that Railway hostname

Railway handles HTTPS automatically.

## Updating

Push to GitHub and Railway redeploys automatically:
```bash
git add .
git commit -m "Update"
git push
```

## Local Development

```bash
npm install
node server.js
# Open http://localhost:3000
```

## Configuration

- **Pair IDs**: Edit `config.js` to change defaults, or use Dashboard > Settings to create a new session with different pair counts.
- **Admin password**: Set `ADMIN_PASSWORD` environment variable (defaults to `changeme`).
- **Matrix criteria**: Editable from Dashboard > Settings.

## Data

SQLite database stored in `data.db`. Delete this file to reset all data.

## URLs

| Page | URL |
|------|-----|
| Student compatibility form | https://creatingconnections.site/ |
| Final ranking | https://creatingconnections.site/ranking |
| Facilitator dashboard | https://creatingconnections.site/dashboard |
