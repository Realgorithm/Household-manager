# Household Goods

A shared pantry stock + budget tracker for a household, built with React + Vite,
backed by Supabase for real, multi-device data.

## What's inside

- `src/App.jsx` — the whole app (pantry, budget, household, login)
- `src/storagePolyfill.js` — bridges the app's storage calls to Supabase (shared
  data) and `localStorage` (your device's login session)
- `src/supabaseClient.js` — connects to your Supabase project using the env vars below

## 1. Local setup

```bash
npm install
npm run dev
```

This project already includes a `.env` file with the Supabase project keys you
gave me, so it should work immediately. It opens at `http://localhost:5173`.

The first person to open it becomes the admin (sets a username/password). After
that, the admin adds housemates and assigns each one a username/password from
the Household tab.

## 2. Push to GitHub

```bash
git init
git add .
git commit -m "Household tracker"
git branch -M main
git remote add origin <your-empty-github-repo-url>
git push -u origin main
```

`.env` is git-ignored on purpose — your Supabase keys won't be committed. You'll
set them again as environment variables on your hosting platform (next step).

## 3. Deploy (Netlify or Vercel)

Either works the same way:

1. Sign in with GitHub, "Import project," pick this repo
2. Build command: `npm run build`   ·   Output directory: `dist`
3. Add two environment variables in the site's settings, same values as your
   local `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy

That's it — you'll get a live URL you can share with your housemates. Every
device that opens it talks to the same Supabase database, so stock and budget
data stays in sync in real time (no refresh needed).

## Notes on security

- Logins are a simple username/password system stored in your Supabase table —
  good for keeping casual housemates from poking around, not bank-grade
  security. Don't reuse a sensitive password here.
- The Supabase table currently allows any request with your public anon key to
  read/write it (needed since there's no real per-user Supabase auth here).
  That's fine for a small trusted household app but wouldn't be appropriate for
  anything sensitive.
