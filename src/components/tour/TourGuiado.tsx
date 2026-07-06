import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TOUR_STORAGE_KEY, type TourStep } from "@/components/tour/tourSteps";

interface TourGuiadoProps {
  steps: TourStep[];
  onFinish: () => void;
}

/** Clases Tailwind aplicadas al ítem del sidebar activo durante el tour. */
const TOUR_HIGHLIGHT_CLASSES = ["ring-2", "ring-primary", "ring-offset-2", "ring-offset-background", "animate-pulse", "rounded-xl"];

/**
 * Tarjeta flotante de onboarding que navega por las secciones principales de la
 * app y resalta el ítem correspondiente en el sidebar (cuando está visible).
 */
export function TourGuiado({ steps, onFinish }: TourGuiadoProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const navigate = useNavigate();

  const step = steps[stepIndex];
  const total = steps.length;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === total - 1;

  const finish = useCallback(() => {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, "true");
    } catch {
      // localStorage puede fallar en modo privado; no bloqueamos el cierre del tour.
    }
    onFinish();
  }, [onFinish]);

  // Navega a la ruta del paso actual cada vez que cambia.
  useEffect(() => {
    if (step) navigate(step.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  // Resalta el ítem del sidebar correspondiente al paso actual (si está visible;
  // en móvil o con el sidebar colapsado el elemento no existe y simplemente no se resalta).
  useEffect(() => {
    if (!step) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.to}"]`);
    if (!el) return;
    el.classList.add(...TOUR_HIGHLIGHT_CLASSES);
    return () => {
      el.classList.remove(...TOUR_HIGHLIGHT_CLASSES);
    };
  }, [step]);

  // Cierra el tour con Escape.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [finish]);

  const handleNext = useCallback(() => {
    if (isLast) {
      finish();
      return;
    }
    setStepIndex((i) => Math.min(i + 1, total - 1));
  }, [isLast, finish, total]);

  const handlePrev = useCallback(() => {
    setStepIndex((i) => Math.max(i - 1, 0));
  }, []);

  const Icon = step?.icon;

  const dots = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);

  if (!step) return null;

  return (
    <div
      key={step.id}
      role="dialog"
      aria-label="Tour guiado"
      className={cn(
        "fixed inset-x-3 bottom-3 z-50 animate-fade-in sm:inset-x-auto",
        "sm:bottom-6 sm:right-6 sm:max-w-md",
      )}
    >
      <div className="glass-accented rounded-xl p-4 shadow-[var(--glass-shadow-lg)] backdrop-blur-xl transition-all duration-300 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="panel-kicker">
            Paso {stepIndex + 1} de {total}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-2 -mt-2 h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={finish}
            aria-label="Cerrar tour"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-2 flex items-center gap-2.5">
          {Icon && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--glass-border-accent)] bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </div>
          )}
          <h2 className="text-base font-semibold leading-tight text-foreground sm:text-lg">
            {step.title}
          </h2>
        </div>

        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
          {step.description}
        </p>

        <div className="mt-4 flex items-center justify-center gap-1.5">
          {dots.map((i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === stepIndex ? "w-5 bg-primary" : "w-1.5 bg-[var(--glass-border)]",
              )}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={finish}>
            Saltar tour
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrev}
              disabled={isFirst}
              className="gap-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Anterior
            </Button>
            <Button size="sm" onClick={handleNext} className="gap-1">
              {isLast ? "Terminar" : "Siguiente"}
              {!isLast && <ArrowRight className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
