# Lite source

`parts.json` lists the source fragments in execution order. `npm run build:lite`
concatenates them into one private ES5 closure at `public/lite/lite.js`.
That public file is generated and remains committed for static hosting.

The fragments share lexical bindings and are not standalone modules. Keep their
order: startup statements run in sequence even though function declarations are
hoisted. This deliberately preserves the existing school-browser runtime without
introducing imports, a loader, polyfills or additional requests.

- `bootstrap`: browser capabilities, state and draft coordination.
- `translations`, `dom`, `transport`: text, DOM controls and bounded API requests.
- `navigation`, `auth`, `collections`: account navigation, forms and lists.
- `uploads`, `source`, `plan`: import, source access and plan editing.
- `generate`, `generation`, `task`: generation settings and document editing.
- `startup`: approval, session events and initial profile load.

Edit fragments, then run `npm run build:lite`, `npm run lint`, `npm test` and
`npm run test:browser`. ESLint checks the assembled closure because unused bindings
cannot be checked independently across fragments. Acorn checks ES5 syntax during
generation; `node scripts/build/build-lite.mjs --check` rejects stale assets and
unlisted fragments in CI.
