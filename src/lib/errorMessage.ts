export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [
      record.message,
      record.details,
      record.hint,
      record.code ? `Codigo: ${record.code}` : null,
    ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);

    if (parts.length > 0) {
      return parts.join(" ");
    }

    try {
      return JSON.stringify(error);
    } catch {
      return "Error desconocido";
    }
  }

  return "Error desconocido";
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(errorMessage(error));
}
