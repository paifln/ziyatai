import { createNetlifyRouting } from "../../scripts/build/prepare-netlify.mjs";
export function onPreBuild({ netlifyConfig }) {
  const { apiRedirect } = createNetlifyRouting(
    process.env.ZIYATAI_API_ORIGIN,
    process.env.UPLOAD_ORIGIN,
  );
  netlifyConfig.redirects = [
    apiRedirect,
    ...(netlifyConfig.redirects || []).filter((rule) => rule.from !== "/api/*"),
  ];
  // Only the secret variable NAME enters routing; Netlify signs at runtime.
}
