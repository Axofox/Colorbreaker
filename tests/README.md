# Tests

Run from the repo root with Node 20+:

    node --test "tests/*.test.js"

The `*-logic` files check each game's rules. The `*-e2e` files play the games in headless Chromium and need Playwright; they are skipped if Playwright isn't installed.

There is deliberately no root `package.json`: this is a plain static site, and Netlify tries to install dependencies when it finds one.
