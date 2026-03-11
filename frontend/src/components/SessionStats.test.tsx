import { describe, it, expect } from "vitest";
import { render, screen } from "../test-utils";
import { SessionStats } from "./SessionStats";
import { makeAppState } from "../test-utils";

describe("SessionStats", () => {
  it("renders total encounter count", () => {
    const state = makeAppState();
    const total = state.pokemon.reduce((s, p) => s + p.encounters, 0);
    render(<SessionStats appState={state} sessionStart={new Date()} />);
    expect(screen.getByText(String(total))).toBeInTheDocument();
  });

  it("renders elapsed time in HH:MM:SS format", () => {
    render(
      <SessionStats appState={makeAppState()} sessionStart={new Date()} />,
    );
    expect(screen.getByText("00:00:00")).toBeInTheDocument();
  });
});
