import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("applies the standard interactive motion classes", () => {
    render(<Button>Guardar</Button>);

    const button = screen.getByRole("button", { name: "Guardar" });

    expect(button).toHaveClass("transition-all");
    expect(button).toHaveClass("hover:-translate-y-0.5");
    expect(button).toHaveClass("hover:shadow-[var(--glass-shadow-lg),var(--glass-glow)]");
    expect(button).toHaveClass("active:translate-y-px");
    expect(button).toHaveClass("active:scale-[0.98]");
  });
});
