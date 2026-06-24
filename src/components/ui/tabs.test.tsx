import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

describe("TabsTrigger", () => {
  it("uses the standard button hover and active motion", () => {
    render(
      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    const trigger = screen.getByRole("tab", { name: "Dashboard" });

    expect(trigger).toHaveClass("transition-all");
    expect(trigger).toHaveClass("hover:-translate-y-0.5");
    expect(trigger).toHaveClass("hover:shadow-[var(--glass-shadow-lg),var(--glass-glow)]");
    expect(trigger).toHaveClass("active:translate-y-px");
    expect(trigger).toHaveClass("active:scale-[0.98]");
  });
});
