/**
 * ChatBot — Vadim, asistente de producción Lasarte SAT.
 * Panel lateral derecho, activado desde el TopBar.
 * Diseño glassmorphism integrado con el design system.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, RotateCcw, Sparkles, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatBot } from "@/hooks/useChatBot";

// ─── Render con saltos de línea y negrita básica ──────────────────────────────

function MessageContent({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <span>
      {lines.map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <span key={i}>
            {parts.map((part, j) =>
              part.startsWith("**") && part.endsWith("**")
                ? <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>
                : <span key={j}>{part}</span>
            )}
            {i < lines.length - 1 && <br />}
          </span>
        );
      })}
    </span>
  );
}

// ─── Puntos de carga ──────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce"
          style={{ animationDelay: `${i * 0.18}s`, animationDuration: "0.9s" }}
        />
      ))}
    </div>
  );
}

// ─── Preguntas sugeridas ──────────────────────────────────────────────────────

const SUGGESTIONS = [
  "¿Cómo está el DJPMN esta semana?",
  "¿Qué productor tiene mejor T/h?",
  "Explícame la cascada de producción",
  "¿Qué secciones tiene la herramienta?",
];

// ─── ChatBot ──────────────────────────────────────────────────────────────────

export function ChatBot() {
  const {
    isOpen, open, close,
    messages, isLoading, streaming,
    sendMessage, clearHistory,
  } = useChatBot();

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Escucha el evento del TopBar para abrir/cerrar
  useEffect(() => {
    const handler = () => (isOpen ? close() : open());
    window.addEventListener("lasarte:toggle-chat", handler);
    return () => window.removeEventListener("lasarte:toggle-chat", handler);
  }, [isOpen, open, close]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming, isLoading]);

  // Focus al abrir
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 350);
  }, [isOpen]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim());
    setInput("");
  }, [input, isLoading, sendMessage]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const userHasMessages = messages.some((m) => m.role === "user");

  return (
    <>
      {/* Overlay suave detrás del panel */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/10 backdrop-blur-[1px] transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={close}
      />

      {/* Panel lateral derecho */}
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex flex-col pt-[env(safe-area-inset-top)] sm:bottom-0 sm:top-16 sm:pt-0",
          "w-full max-w-full sm:w-[420px]",
          "border-l border-[var(--glass-border-accent)]",
          "bg-[var(--glass-bg-strong)] backdrop-blur-2xl",
          "shadow-[-8px_0_32px_hsl(150_18%_14%/0.08)]",
          "transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="relative shrink-0 overflow-hidden">
          {/* Línea de acento superior */}
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4">
            <div className="flex min-w-0 items-center gap-3">
              {/* Avatar del bot */}
              <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-[var(--glass-bg-strong)]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-none text-foreground">
                  Vadim
                </p>
                <p className="mt-1 truncate text-[10px] text-muted-foreground">
                  OpenCode · Ring 2.6 · acceso a datos en vivo
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={clearHistory}
                title="Nueva conversación"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--glass-bg)] hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={close}
                title="Cerrar"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--glass-bg)] hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Separador */}
          <div className="h-px bg-[var(--glass-border)]" />
        </div>

        {/* ── Mensajes ────────────────────────────────────────────────── */}
        <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-4">
          {/* Empty state */}
          {!userHasMessages && !isLoading && messages.length <= 1 && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/8 ring-1 ring-primary/15">
                <Bot className="h-7 w-7 text-primary/70" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">¿En qué puedo ayudarte?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tengo acceso a los datos de producción de los últimos 30 días
                </p>
              </div>
            </div>
          )}

          {/* Lista de mensajes */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn("flex gap-2.5", msg.role === "user" ? "flex-row-reverse" : "flex-row")}
            >
              {/* Avatar solo para el bot */}
              {msg.role === "assistant" && (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
                  <Sparkles className="h-3 w-3 text-primary" />
                </div>
              )}

              <div
                className={cn(
                  "max-w-[86%] break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[82%]",
                  msg.role === "user"
                    ? "rounded-tr-sm bg-primary/12 border border-primary/20 text-foreground"
                    : msg.error
                    ? "rounded-tl-sm bg-destructive/8 border border-destructive/20 text-destructive"
                    : "rounded-tl-sm bg-[var(--glass-bg)] border border-[var(--glass-border)] text-foreground"
                )}
              >
                <MessageContent text={msg.content} />
              </div>
            </div>
          ))}

          {/* Respuesta en streaming */}
          {isLoading && (
            <div className="flex gap-2.5">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
                <Sparkles className="h-3 w-3 text-primary" />
              </div>
              <div className="max-w-[86%] break-words rounded-2xl rounded-tl-sm bg-[var(--glass-bg)] border border-[var(--glass-border)] px-3.5 py-2.5 text-sm leading-relaxed text-foreground sm:max-w-[82%]">
                {streaming ? <MessageContent text={streaming} /> : <TypingDots />}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Sugerencias (solo si no hay conversación) ───────────────── */}
        {!userHasMessages && !isLoading && (
          <div className="grid shrink-0 grid-cols-1 gap-2 px-3 pb-2 min-[380px]:grid-cols-2 sm:px-4">
            {SUGGESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                className={cn(
                  "rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5",
                  "text-left text-[11px] text-muted-foreground leading-snug",
                  "transition-all hover:border-[var(--glass-border-accent)] hover:bg-[var(--glass-bg-strong)] hover:text-foreground",
                  "active:scale-[0.98]"
                )}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* ── Input ───────────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-[var(--glass-border)] px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:px-4">
          <div className={cn(
            "flex items-center gap-2 rounded-xl px-3 py-2",
            "border border-[var(--glass-border-accent)] bg-[var(--glass-bg)]",
            "shadow-[var(--glass-shadow)] backdrop-blur-sm",
            "transition-shadow focus-within:shadow-[var(--glass-shadow),var(--glass-glow)]"
          )}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Pregunta sobre producción, DSJ, productores…"
              disabled={isLoading}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                "bg-primary text-primary-foreground",
                "transition-all duration-150 active:scale-95",
                "disabled:opacity-30 disabled:cursor-not-allowed",
                "hover:bg-primary/90 hover:shadow-[var(--glass-glow)]"
              )}
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
