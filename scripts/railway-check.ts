import {
  createRailwayContext,
  project,
  RAILWAY_GRAPH_VERSION,
  validateGraph,
  type Edge,
  type ResourceNode,
} from "railway/iac";
import configuration from "../.railway/railway";
import { readFile } from "node:fs/promises";

// Offline evaluation only: no CLI login, API call, plan or apply.
try {
  const definition = await configuration(
    createRailwayContext({ environment: "production" }),
    project,
  );
  const resources = (definition.resources ?? []).flat() as ResourceNode[];
  const edges: Edge[] = [];
  const shared = new Set<string>();
  const credentials = new Set([
    "POSTGRES_PASSWORD",
    "AUTH_SECRET",
    "NETLIFY_PROXY_SECRET",
    "RENDERER_TOKEN",
    "STORAGE_ACCESS_KEY",
    "STORAGE_SECRET_KEY",
    "SMTP_PASSWORD",
    "GOOGLE_CLIENT_SECRET",
    "APPLE_CLIENT_SECRET",
    "OPENAI_API_KEY",
  ]);
  let literalCredentials = false;
  for (const resource of resources) {
    if (resource.type !== "service") continue;
    for (const [key, value] of Object.entries(resource.variables ?? {})) {
      if (value.type === "sharedReference") shared.add(value.name);
      if (credentials.has(key) && value.type === "literal" && value.value)
        literalCredentials = true;
      if (value.type === "reference")
        edges.push({
          from: resource.address,
          to: value.resource,
          type: "variable",
          key,
        });
      if (value.type === "literal" && typeof value.value === "string") {
        for (const match of value.value.matchAll(
          /\$\{\{([\w-]+)\.([\w-]+)\}\}/g,
        )) {
          if (match[1] === "shared") shared.add(match[2]);
          else
            edges.push({
              from: resource.address,
              to: `service.${match[1]}`,
              type: "variable",
              key,
            });
        }
      }
    }
    for (const [key, mount] of Object.entries(resource.volumeAttachments ?? {}))
      edges.push({
        from: resource.address,
        to: mount.volume,
        type: "mount",
        key,
      });
  }
  const graph = {
    version: RAILWAY_GRAPH_VERSION,
    project: { name: definition.name },
    environments: [{ name: "production" }],
    resources,
    edges,
  };
  const issues = validateGraph(graph);
  if (literalCredentials) issues.push("Credentials must be references.");
  const antivirus = resources.find((resource) => resource.name === "antivirus");
  if (
    antivirus?.type !== "service" ||
    !antivirus.source?.image ||
    !(await readFile("infra/compose.production.yml", "utf8")).includes(
      antivirus.source.image,
    )
  )
    issues.push("Antivirus image differs from the Compose release.");
  if (issues.length) {
    console.error(
      `Railway configuration is invalid (${issues.length} issues).`,
    );
    // Avoid echoing future literal variables or SDK error payloads.
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify(
        {
          scope: "offline-definition-only",
          sdk: "3.16.0",
          services: resources
            .filter((resource) => resource.type === "service")
            .map((resource) => resource.name),
          volumes: resources
            .filter((resource) => resource.type === "volume")
            .map((resource) => resource.name),
          valid: true,
          requiredSharedVariables: [...shared].sort(),
          cloudPlanPerformed: false,
          cloudResourcesCreated: false,
        },
        null,
        2,
      ),
    );
  }
} catch {
  console.error(
    "Railway offline check failed. Configuration values were not printed.",
  );
  process.exitCode = 1;
}
