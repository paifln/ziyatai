import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { browserSupportScript } from "../packages/domain/browser-support";
describe("browser fallback before React starts", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 6.1) Chrome/109.0.0.0 Safari/537.36", true],
    ["Mozilla/5.0 Chrome/111.0.0.0 Safari/537.36", false],
    ["Mozilla/5.0 Chrome/149.0.0.0 Safari/537.36 Edg/149.0", false],
    ["Mozilla/5.0 (Windows NT 6.1) Firefox/115.0", false],
    ["Mozilla/5.0 Firefox/110.0", true],
    ["Mozilla/5.0 Version/16.3 Safari/605.1.15", true],
    ["Mozilla/5.0 Version/16.4 Safari/605.1.15", false],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) CriOS/110.0 Mobile Safari/604.1",
      true,
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) CriOS/110.0 Mobile Safari/604.1",
      false,
    ],
    ["Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko", true],
  ])("routes %s appropriately", (userAgent, old) => {
    const destinations: string[] = [];
    runInNewContext(browserSupportScript, {
      navigator: { userAgent },
      location: {
        search: "?token=example",
        replace: (url: string) => destinations.push(url),
      },
    });
    expect(destinations).toEqual(old ? ["/lite/?token=example"] : []);
  });
});
