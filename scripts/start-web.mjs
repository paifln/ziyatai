import { access } from "node:fs/promises";
await access(".next/standalone/public/brand-owl.png");
process.env.HOSTNAME ||= "127.0.0.1";
await import("../.next/standalone/server.js");
