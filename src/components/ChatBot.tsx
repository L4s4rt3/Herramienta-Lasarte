/**
 * ChatBot — Asistente de producción flotante con Gemini 1.5 Flash.
 * Diseño glassmorphism coherente con el resto de la aplicación.
 */
import { useState, useRef, useEffect } from "react";
import { Bot, X, Send, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatBot } from "@/hooks/useChatBot";
import { Button } from "@/components/ui/button";

// ─── Animación de typing ──────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-0.5 px-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
          style={{ animationDelay: `${i * 0.18}s`, animationDuration: "0.9s" }}
        />
      ))}
    </div>
  );
}

// ─── Burbuja de mensaje ───────────────────────────────────────────────────────

function MessageBubble({ role, content, error }: { role: "user" | "assistant"; content: string; error?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 mr-2 mt-0.5">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "rounded-tr-sm bg-primary/15 border border-primary/25 text-foreground"
            : error
            ? "rounded-tl-sm bg-destructive/10 border border-destructive/25 text-destructive"
            : "rounded-tl-sm bg-[var(--glass-bg-strong)] border border-[var(--glass-border)] text-foreground"
        )}
      >
        {content}
      </div>
    </div>
  );
}

// ─── ChatBot principal ────────────────────────────────────────────────────────

export function ChatBot() {
  const { isOpen, open, close, messages, isLoading, streaming, sendMessage, clearHistory } = useChatBot();
  const [input, setInput] = useState("");
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming, isLoading]);

  // Focus al abrir
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 250);
  }, [isOpen]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim());
    setInput("");
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <>
      {/* ── Botón flotante ─────────────────────────────────────────── */}
      <button
        onClick={open}
        aria-label="Abrir asistente de producción"
        className={cn(
          "fixed bottom-6 right-6 z-50 h-12 w-12 rounded-2xl glass-accented",
          "flex items-center justify-center",
          "shadow-[var(--glass-shadow-lg)] transition-all duration-300",
          "hover:shadow-[var(--glass-shadow-lg),var(--glass-glow)] hover:-translate-y-1",
          "active:translate-y-0 active:scale-95",
          isOpen ? "opacity-0 pointer-events-none scale-90" : "opacity-100 scale-100"
        )}
      >
        <Bot className="h-5 w-5 text-primary" />
        <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-success ring-2 ring-[var(--glass-bg)] animate-pulse" />
      </button>

      {/* ── Panel de chat ───────────────────────────────────────────── */}
      <div
        className={cn(
          "fixed bottom-6 right-6 z-50 flex w-[370px] flex-col",
          "rounded-2xl glass-lg shadow-[var(--glass-shadow-lg)]",
          "transition-all duration-300 origin-bottom-right",
          isOpen
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 translate-y-3 pointer-events-none"
        )}
        style={{ maxHeight: "min(600px, calc(100vh - 5rem))" }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--glass-border)] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">Asistente Lasarte</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Gemini 1.5 Flash · datos en vivo</p>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={clearHistory}
              title="Nueva conversación"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={close}
              title="Cerrar"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {messages.length === 0 && !isLoading && (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground py-8">
              Iniciando asistente…
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              role={msg.role}
              content={msg.content}
              error={msg.error}
            />
          ))}

          {/* Respuesta en streaming */}
          {isLoading && (
            <div className="flex justify-start">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 mr-2 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="max-w-[82%] rounded-2xl rounded-tl-sm bg-[var(--glass-bg-strong)] border border-[var(--glass-border)] px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
                {streaming ? streaming : <TypingDots />}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Suggested prompts — solo cuando no hay mensajes previos del usuario */}
        {messages.length === 1 && !isLoading && (
          <div className="shrink-0 px-3 pb-1 flex flex-wrap gap-1.5">
            {[
              "¿Cómo está el DSJ esta semana?",
              "¿Qué día fue el peor este mes?",
              "Explícame qué es el DJPMN",
            ].map((q) => (
              <button
                key={q}
                onClick={() => { sendMessage(q); }}
                className="rounded-full border border-[var(--glass-border-accent)] bg-primary/5 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="shrink-0 border-t border-[var(--glass-border)] px-3 pb-3 pt-2">
          <div className="flex items-center gap-2 rounded-xl border border-[var(--glass-border-accent)] bg-[var(--glass-bg)] px-3 py-2 shadow-[var(--glass-shadow)] backdrop-blur-sm">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Pregunta sobre producción, DSJ, T/h…"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 outline-none disabled:opacity-50"
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                "bg-primary text-primary-foreground",
                "transition-all duration-150",
                "disabled:opacity-30 disabled:cursor-not-allowed",
                "hover:bg-primary/90 active:scale-95"
              )}
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
