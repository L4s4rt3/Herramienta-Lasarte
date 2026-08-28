// Lienzo de firma para el control de calidad de importación: la evaluadora
// firma con el dedo en el móvil y la firma va como PNG al informe Word.
import { useEffect, useRef, useState } from "react";
import { Eraser, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";

// Tamaño interno del lienzo (el CSS lo estira al ancho disponible). 600x240
// da trazo suficiente para incrustarla a ~5 cm en el informe.
const ANCHO = 600;
const ALTO = 240;

interface FirmaPadProps {
  /** Se llama al pulsar "Guardar firma" con el PNG dibujado. */
  onGuardar: (blob: Blob) => void;
  guardando?: boolean;
}

export function FirmaPad({ onGuardar, guardando = false }: FirmaPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dibujandoRef = useRef(false);
  const [hayTrazo, setHayTrazo] = useState(false);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1d2c5e";
  }, []);

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
      if (blob) onGuardar(blob);
    }, "image/png");
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={ANCHO}
        height={ALTO}
        onPointerDown={empezar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerCancel={terminar}
        className="w-full touch-none rounded-xl border-2 border-dashed border-primary/30 bg-white dark:bg-white"
        aria-label="Zona para dibujar la firma"
      />
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={limpiar} disabled={!hayTrazo || guardando}>
          <Eraser className="mr-1.5 h-4 w-4" />
          Limpiar
        </Button>
        <Button type="button" size="sm" onClick={guardar} disabled={!hayTrazo || guardando}>
          <PenLine className="mr-1.5 h-4 w-4" />
          {guardando ? "Guardando..." : "Guardar firma"}
        </Button>
      </div>
    </div>
  );
}
