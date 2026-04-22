import { listTokens, substitute } from "./templateSubstitute";

describe("templateSubstitute.substitute", () => {
  it("replaces simple tokens", () => {
    expect(substitute("Hi {{name}}!", { name: "Saurav" })).toBe("Hi Saurav!");
  });
  it("tolerates whitespace inside braces", () => {
    expect(substitute("{{ name }} / {{  id  }}", { name: "X", id: 42 })).toBe(
      "X / 42"
    );
  });
  it("leaves unknown tokens intact — admin preview aid", () => {
    expect(substitute("{{greeting}} {{name}}", { name: "S" })).toBe(
      "{{greeting}} S"
    );
  });
  it("leaves tokens intact for null / undefined values", () => {
    expect(substitute("{{a}}-{{b}}", { a: null, b: undefined })).toBe(
      "{{a}}-{{b}}"
    );
  });
  it("handles empty template", () => {
    expect(substitute("", { a: 1 })).toBe("");
  });
  it("coerces numbers / booleans", () => {
    expect(substitute("{{n}}/{{b}}", { n: 3.5, b: true })).toBe("3.5/true");
  });
  it("does not match malformed braces", () => {
    expect(substitute("{name} and {{!bad}} and {{9bad}}", {})).toBe(
      "{name} and {{!bad}} and {{9bad}}"
    );
  });
});

describe("templateSubstitute.listTokens", () => {
  it("returns unique token names in declaration order", () => {
    expect(listTokens("{{a}} {{b}} {{a}} {{ c }}")).toEqual(["a", "b", "c"]);
  });
  it("handles empty template", () => {
    expect(listTokens("")).toEqual([]);
  });
});
