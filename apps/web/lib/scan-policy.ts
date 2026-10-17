type ScanPolicy = { APP_ENV: string; SCAN_REQUIRED: string };

export function trustedScan(status: string, policy: ScanPolicy) {
  return (
    status === "clean" ||
    (status === "unscanned-development" &&
      policy.APP_ENV === "local" &&
      policy.SCAN_REQUIRED === "false")
  );
}
