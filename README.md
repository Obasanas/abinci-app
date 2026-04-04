# abinci.food

Home food delivery platform for Northern Nigeria, starting with Kano.

## Project structure

```
abinci-app/
├── customer-app/     # Customer web app
├── driver-app/       # Driver web app (KYC + deliveries)
├── admin-app/        # Admin dashboard
├── api/              # Node.js REST API
│   ├── .env          # ← secrets live HERE (copy from ../.env.example)
│   └── src/
├── shared/           # Shared CSS + JS utils
├── supabase/         # DB schema
└── .env.example      # template — copy to api/.env
```

## Quickstart

### 1. API

```bash
cd api
cp ../.env.example .env
# Open api/.env and fill in SUPABASE_SERVICE_ROLE_KEY
# Get it: Supabase Dashboard → Settings → API → service_role key

npm install
node src/index.js
# ✓ abinci API on port 3000
```

### 2. Apps (new terminals)

```bash
npx serve customer-app -p 3001   # http://localhost:3001
npx serve driver-app -p 3002     # http://localhost:3002
npx serve admin-app -p 3003      # http://localhost:3003
```

Or all at once:
```bash
npm install && npm run dev
```

### 3. Database

Paste `supabase/schema.sql` into Supabase Dashboard → SQL Editor → Run.

## Push to GitHub

```bash
git init && git add -A
git commit -m "feat: initial commit"
git branch -m master main
git remote add origin https://github.com/obasanas/abinci-app.git
git push -u origin main
```

## Deploy

- **Apps** → Vercel (drag & drop each folder)
- **API** → Railway (root: `api/`, add env vars from `api/.env`)
