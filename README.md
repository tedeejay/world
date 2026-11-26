# Jay & Dee 💞

A private two-person web app: lock screen, memories, live chat with voice notes, letters, birthdays and countdowns.
Plain HTML + CSS + JavaScript (ES modules), Firebase Firestore for realtime data. No build step.

## What's new in this version

- **Split into files** — `css/` and `js/` modules instead of one 1,800-line page.
- **New layout** — sidebar on desktop, bottom tab bar on mobile, full-height chat.
- **Chat** — reactions (tap ❤️ or double-click), "typing…" and "Active now", edited marker, link detection, emoji picker, jump-to-latest, unread divider, Enter-to-send on desktop, drafts that survive a refresh.
- **Voice notes** — cancel while recording, size guard, audio no longer restarts when new messages arrive.
- **Letters** — newest first, collapsible composer, "NEW" ribbon, drafts saved.
- **Home** — next-milestone card (100 days, 200 days…), confetti on birthdays/anniversaries/milestones, floating hearts.
- **Memories** — swipe, keyboard arrows, captions and counter in the viewer; admin page included.
- **Security** — passcodes are stored as salted SHA-256 hashes (not plain text), 5 wrong tries trigger a lockout, the remembered unlock expires after 6 hours, and the app locks if left in the background for 5 minutes.
- **Offline** — installable PWA with an offline shell; Firestore offline cache queues messages sent without signal.
- **Accessibility** — focus outlines, ARIA labels, reduced-motion support, real `<dialog>` confirmations.

## Project layout

```
index.html            main app
admin.html            memories admin (long-press the logo for 2s as Jay)
manifest.webmanifest  PWA manifest
sw.js                 service worker (bump VERSION on each deploy)
firestore.rules       suggested security rules
css/                  base · lock · app · chat · admin
js/
  config.js           ← all personal settings live here
  main.js             bootstrap, tabs
  auth.js             lock screen + sessions
  home.js             hero, countdowns, birthdays
  memories.js         gallery + lightbox
  chat.js             messages, letters, presence
  recorder.js · notify.js · fx.js · utils.js · state.js · firebase.js · admin.js
```

## Run locally

ES modules need a web server (opening the file directly won't work):

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Jay & Dee v2"
git branch -M main
git remote add origin https://github.com/tedeejay/Jay-Dee.git
git push -u origin main --force      # replaces the old single-file version
```

Then **Settings → Pages → Deploy from branch → main / (root)**.
Each time you change files, bump `VERSION` in `sw.js` so phones pick up the update.

## Change the passcodes

Codes are looked up by hash. To make a new one, run this in any terminal (use your own 6 digits):

```bash
printf 'olw-jaydee-v2:123456' | sha256sum
```

Paste the result as a key in `rooms` inside `js/config.js`. If you change `passSalt`, regenerate both hashes.

## Firebase setup

1. Firebase console → **Firestore Database** → **Rules** → paste `firestore.rules` → **Publish**.
2. Collections used: `messages`, `presence`, `memories` (created automatically).

## Please read: security limits

- **A 6-digit code is a lock screen, not strong security.** Anyone who can read the repo can see the hashes and brute-force a 6-digit code in under a second. The hashing and lockout only stop casual snooping, not a determined person.
- **The Firestore data is protected only by the rules.** Firebase web keys are public by design, so anyone who knows your project ID could read or write your data unless the rules block them. The included rules validate the data shape but still allow public reads. For real privacy, add **Firebase Authentication** (anonymous or email sign-in for the two of you) and change the rules to `request.auth != null`, ideally with App Check.
- **Phone numbers in `config.js` are public** if the repo is public. Use a private repo with GitHub Pages (paid plans) or move the numbers out if that matters to you.
- **Alerts only work while the app is open** (or backgrounded). Notifications when the app is fully closed need Firebase Cloud Messaging and a small server function.
- Voice notes are stored inside Firestore documents (limit 1 MiB), so they're capped at about 45 seconds. For longer clips, move them to Firebase Storage.
