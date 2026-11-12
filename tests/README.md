# Tests

Run from the repo root with Node 20+:

    node --test "tests/*.test.js"

`logic.test.js` checks the game rules. `e2e.test.js` plays the game in headless Chromium and needs Playwright; it is skipped if Playwright isn't installed.

There is deliberately no root `package.json`: this is a plain static site, and Netlify tries to install dependencies when it finds one.
