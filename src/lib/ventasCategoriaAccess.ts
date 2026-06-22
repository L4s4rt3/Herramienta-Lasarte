export type VentasCategoriaAccessRole = "admin" | "operario" | null;

export interface VentasCategoriaAccessInput {
  email: string | null | undefined;
  role: VentasCategoriaAccessRole;
  authorizedEmails: string[];
}

export function canAccessVentasCategoria(input: VentasCategoriaAccessInput): boolean {
  if (input.role === "admin") {
    return true;
  }

  const email = normalizeEmail(input.email);
  if (!email) {
    return false;
  }

  return input.authorizedEmails.some((authorizedEmail) => normalizeEmail(authorizedEmail) === email);
}

function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}
