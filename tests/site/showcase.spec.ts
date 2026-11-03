import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const width of [1440, 390]) {
  test(`showcase works at ${width}px without third-party resources`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const origins = new Set<string>();
    const errors: string[] = [];
    page.on("request", (request) => origins.add(new URL(request.url()).origin));
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400)
        errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Every calendar. One calmer view.",
    );
    for (const name of [
      "Week",
      "Event editor",
      "Reminders",
      "Dark mode",
      "Popup",
      "Month",
    ]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(
        page.getByRole("tab", { name, exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("#screen-image")).toHaveJSProperty(
        "complete",
        true,
      );
      expect(
        await page
          .locator("#screen-image")
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      ).toBeGreaterThan(0);
    }
    await page
      .getByRole("tab", { name: "Month", exact: true })
      .press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "Week", exact: true }),
    ).toBeFocused();
    await expect(page.locator("#download-screen")).toHaveAttribute(
      "href",
      /\/assets\/screens\/week\.png$/,
    );
    await page
      .getByRole("button", { name: "Enlarge the current screenshot" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enlarge the current screenshot" }),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    await page.goto("/privacy.html");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Privacy policy",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(errors).toEqual([]);
    expect([...origins]).toEqual(["http://127.0.0.1:4174"]);
  });
}
