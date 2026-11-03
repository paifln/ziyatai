import type { PoolConfig } from "pg";

export function databaseConnection(values: {
  DATABASE_URL: string;
  DATABASE_SSL_CA?: string;
}): Pick<PoolConfig, "connectionString" | "ssl"> {
  if (!values.DATABASE_SSL_CA) return { connectionString: values.DATABASE_URL };
  const url = new URL(values.DATABASE_URL);
  // pg connection-string SSL options replace the explicit ssl object. Remove
  // them so the configured trust anchor and hostname verification stay active.
  for (const name of [
    "ssl",
    "sslmode",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "uselibpqcompat",
  ])
    url.searchParams.delete(name);
  return {
    connectionString: url.toString(),
    ssl: {
      ca: values.DATABASE_SSL_CA.replaceAll("\\n", "\n"),
      rejectUnauthorized: true,
    },
  };
}
