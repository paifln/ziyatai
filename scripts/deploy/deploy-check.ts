import { deploymentChecks, type DeploymentProfile } from "./deployment-config";

const args = process.argv.slice(2);
const profile =
  args.find((arg) => arg.startsWith("--profile="))?.slice(10) ?? "backend";
if (
  !["backend", "frontend"].includes(profile) ||
  args.some(
    (arg) =>
      arg !== "--json" &&
      arg !== "--profile=backend" &&
      arg !== "--profile=frontend",
  )
) {
  console.error(
    "Usage: npm run check:deploy -- --profile=backend|frontend [--json]",
  );
  process.exitCode = 2;
} else {
  try {
    const checks = await deploymentChecks(
      process.env,
      profile as DeploymentProfile,
    );
    const blocked = checks.filter((check) => check.status === "blocked").length;
    const report = {
      profile,
      scope: "offline-configuration-only",
      blocked,
      checks,
    };
    if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(
        `ZiyatAI deployment check (${profile}). Без сети, писем, платных запросов и вывода секретов.`,
      );
      for (const check of checks)
        console.log(
          `[${check.status.toUpperCase()}] ${check.id}: ${check.message}`,
        );
      console.log(
        blocked
          ? `Нужно исправить настроек: ${blocked}.`
          : "Автоматические проверки конфигурации пройдены. Ручные проверки ещё обязательны.",
      );
    }
    process.exitCode = blocked ? 1 : 0;
  } catch {
    console.error(
      "Deployment check failed. No environment values were printed.",
    );
    process.exitCode = 1;
  }
}
