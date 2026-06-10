# MG Community Hub

A social hub for **Magic Garden / Magic Circle**, right inside the game. Add friends and see what they're up to, chat with them in DMs or groups, browse public rooms to find people to play with, climb the leaderboards and show off your profile. It also works in the Discord Activity.

It's the standalone version of the Community Hub from [Arie's Mod](https://github.com/Ariedam64/MG-AriesMod). You can run it alone or alongside Arie's Mod, both play nice together. If you used the hub inside Arie's Mod before, your Discord login and settings carry over automatically.

## Install

1. Get [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
2. Click here: **[mg-community-hub.user.js](https://github.com/Ariedam64/MG-CommunityHub/raw/refs/heads/main/dist/mg-community-hub.user.js)**
3. Open the game and look for the new button in the toolbar. That's it!

## For devs

```bash
npm install
cp .env.example .env
npm run watch
```

This builds two scripts: the public one (`dist/mg-community-hub.user.js`) and a dev one with extra tooling (`dist/mg-community-hub.dev.user.js`, needs `BUILD_DEV=1` in your `.env`). Load the dev one with a `@require file://...` userscript while working.
