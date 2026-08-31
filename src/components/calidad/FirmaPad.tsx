// Lienzo de firma para el control de calidad de importación: la evaluadora
// firma con el dedo en el móvil y la firma va como PNG al informe Word.
//
// La firma se dibuja dentro de un diálogo modal a propósito: el modal bloquea
// el scroll de la página (Radix), y el canvas anula además el gesto táctil
// (touch-action + preventDefault no pasivo), así el trazo no mueve la pantalla
// — el "que no se baile la casilla" del feedback de la evaluadora.
import { useEffect, useRef, useState } from "react";
import { Eraser, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Tamaño interno del lienzo (el CSS lo estira al ancho disponible). 600x240
// da trazo suficiente para incrustarla a ~5 cm en el informe.
const ANCHO = 600;
const ALTO = 240;

interface FirmaPadProps {
  /** Se llama al pulsar "Guardar firma" con el PNG dibujado. */
  onGuardar: (blob: Blob) => void;
  guardando?: boolean;
  /** Texto del botón que abre el diálogo. */
  etiqueta?: string;
  disabled?: boolean;
}

export function FirmaPad({ onGuardar, guardando = false, etiqueta = "Firmar", disabled = false }: FirmaPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dibujandoRef = useRef(false);
  const [abierto, setAbierto] = useState(false);
  const [hayTrazo, setHayTrazo] = useState(false);

  // El gesto táctil sobre el lienzo no debe desplazar NADA: además de
  // touch-action none, se anula touchmove con un listener no pasivo (React
  // registra los suyos como pasivos y ahí preventDefault no surte efecto).
  useEffect(() => {
    if (!abierto) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1d2c5e";
    }
    const bloquear = (evento: TouchEvent) => evento.preventDefault();
    canvas.addEventListener("touchstart", bloquear, { passive: false });
    canvas.addEventListener("touchmove", bloquear, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", bloquear);
      canvas.removeEventListener("touchmove", bloquear);
    };
  }, [abierto]);

  const posicion = (evento: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((evento.clientX - rect.left) / rect.width) * ANCHO,
      y: ((evento.clientY - rect.top) / rect.height) * ALTO,
    };
  };

  const empezar = (evento: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    evento.currentTarget.setPointerCapture(evento.pointerId);
    dibujandoRef.current = true;
    const { x, y } = posicion(evento);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // Un punto visible aunque solo se toque sin arrastrar.
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    setHayTrazo(true);
  };

  const mover = (evento: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dibujandoRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = posicion(evento);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const terminar = () => {
    dibujandoRef.current = false;
  };

  const limpiar = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, ANCHO, ALTO);
    setHayTrazo(false);
  };

  const guardar = () => {
    canvasRef.current?.toBlob((blob) => {
      if (blob) {
        onGuardar(blob);
        setAbierto(false);
        setHayTrazo(false);
      }
    }, "image/png");
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full rounded-xl"
        disabled={disabled || guardando}
        onClick={() => setAbierto(true)}
      >
        <PenLine className="mr-2 h-5 w-5" />
        {guardando ? "Guardando firma..." : etiqueta}
      </Button>

      <Dialog open={abierto} onOpenChange={(abre) => { setAbierto(abre); if (!abre) setHayTrazo(false); }}>
        <DialogContent className="max-w-lg gap-3 rounded-2xl p-4">
          <DialogHeader>
            <DialogTitle className="text-base">Firma con el dedo dentro del recuadro</DialogTitle>
          </DialogHeader>
          <canvas
            ref={canvasRef}
            width={ANCHO}
            height={ALTO}
            onPointerDown={empezar}
            onPointerMove={mover}
            onPointerUp={terminar}
            onPointerCancel={terminar}
            className="w-full touch-none select-none overscroll-none rounded-xl border-2 border-dashed border-primary/30 bg-white dark:bg-white"
            style={{ touchAction: "none" }}
            aria-label="Zona para dibujar la firma"
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11 flex-1 rounded-xl" onClick={limpiar} disabled={!hayTrazo}>
              <Eraser className="mr-1.5 h-4 w-4" />
              Limpiar
            </Button>
            <Button type="button" className="h-11 flex-1 rounded-xl" onClick={guardar} disabled={!hayTrazo}>
              <PenLine className="mr-1.5 h-4 w-4" />
              Guardar firma
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
