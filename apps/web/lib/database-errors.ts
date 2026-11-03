/** Only our exact trigger marker is a public quota error; never expose SQL text. */
export function resourceLimit(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: string }).code === "P0001" &&
    (error as { message?: string }).message === "RESOURCE_LIMIT"
  );
}
