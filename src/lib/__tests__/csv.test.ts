import { describe, expect, it } from "vitest";
import { csvCell } from "../csv";

describe("csvCell", () => {
  it("quotes separators, quotes and line breaks", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("a\rb")).toBe('"a\rb"');
    expect(csvCell(null)).toBe("");
  });

  it("defuses spreadsheet formulas in text but leaves numbers alone", () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1 MERCHANT")).toBe("'+1 MERCHANT");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-42.5)).toBe("-42.5");
  });
});
