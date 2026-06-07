import { beforeEach, describe, expect, it, vi } from "vitest";
import { getInitialLanguage, localizeValidationMessage, translations, type UiCopy } from "./i18n";

function collectShape(value: unknown): unknown {
  if (typeof value === "function") return "function";
  if (!value || typeof value !== "object") return typeof value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, collectShape(nested)]));
}

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear()
    }
  });
}

describe("renderer i18n", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installLocalStorageMock();
  });

  it("keeps English and Chinese copy shapes aligned", () => {
    expect(collectShape(translations.zh)).toEqual(collectShape(translations.en));
  });

  it("uses saved language preference before navigator language", () => {
    window.localStorage.setItem("image2tools.language", "zh");
    expect(getInitialLanguage()).toBe("zh");

    window.localStorage.setItem("image2tools.language", "en");
    expect(getInitialLanguage()).toBe("en");
  });

  it("falls back to navigator language when no preference is saved", () => {
    window.localStorage.removeItem("image2tools.language");
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("zh-CN");
    expect(getInitialLanguage()).toBe("zh");

    vi.spyOn(window.navigator, "language", "get").mockReturnValue("en-US");
    expect(getInitialLanguage()).toBe("en");
  });

  it("localizes shared validation messages", () => {
    const zh: UiCopy = translations.zh;
    const en: UiCopy = translations.en;

    expect(localizeValidationMessage("请输入 prompt。", zh)).toBe("请输入提示词。");
    expect(localizeValidationMessage("请输入 prompt。", en)).toBe("Enter a prompt.");
    expect(localizeValidationMessage("Provider error", zh)).toBe("Provider error");
  });
});
