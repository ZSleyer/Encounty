import { describe, expect, it } from "vitest";
import { defaultGender, genderOptions } from "./GenderSelector";

describe("genderOptions", () => {
  it("maps the PokéAPI gender rates to valid choices", () => {
    expect(genderOptions(-1).map((option) => option.value)).toEqual(["", "genderless"]);
    expect(genderOptions(0).map((option) => option.value)).toEqual(["", "male"]);
    expect(genderOptions(8).map((option) => option.value)).toEqual(["", "female"]);
    expect(genderOptions(4).map((option) => option.value)).toEqual(["", "male", "female"]);
    expect(genderOptions(-2).map((option) => option.value)).toEqual(["", "male", "female", "genderless"]);
  });

  it("automatically resolves single-gender species", () => {
    expect(defaultGender(-1)).toBe("genderless");
    expect(defaultGender(0)).toBe("male");
    expect(defaultGender(8)).toBe("female");
    expect(defaultGender(4)).toBeUndefined();
  });
});
