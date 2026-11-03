# Global cascade

`app/globals.css` is the single ordered import entry. These files retain the
original rule order; they do not introduce isolated scopes or rename selectors.
`theme.css`, `landing.css` and `review.css` still load afterward in `app/layout.tsx`.

Keep responsive rules after the base rules they override. Move a selector into
a CSS Module only alongside its component and after checking all dynamic classes.
The audit's unconfirmed unused selectors are intentionally retained.

Browser component fixtures use `tests/browser/styles.ts` to expand the same local
imports. Validate production output with `npm run build` as well as browser tests;
Next.js can combine CSS differently between development and production.
