// El dibujo de una parcela, con su contorno tal y como viene de Aerobotics.
//
// Sin librería de mapas y sin pedirle nada a nadie: es un SVG hecho con las
// coordenadas que ya están en la base. No hay foto de satélite debajo —para eso
// haría falta un proveedor de teselas— pero la FORMA es la de verdad, y es lo
// que hace que quien conoce el campo reconozca la parcela de un vistazo. Para
// verla sobre la foto está el enlace a Google Maps, que no cuesta nada.
//
// La proyección es la sencilla: longitud × coseno de la latitud para que no se
// estire en horizontal (a 37° de latitud, un grado de longitud mide un 80 % de
// lo que mide uno de latitud). A esta escala —parcelas de hectáreas— es exacta.
import { useMemo } from "react";

export interface ContornoParcelaProps {
  /** Anillos [[[lon, lat], ...], ...]. El primero es el exterior. */
  anillos: Array<Array<[number, number]>>;
  /** Alto del dibujo en píxeles. El ancho se adapta al contenedor. */
  alto?: number;
  className?: string;
  titulo?: string;
}

export default function ContornoParcela({ anillos, alto = 180, className, titulo }: ContornoParcelaProps) {
  const dibujo = useMemo(() => {
    const puntos = anillos.flat();
    if (puntos.length < 3) return null;

    const latMedia = puntos.reduce((s, p) => s + p[1], 0) / puntos.length;
    const k = Math.cos((latMedia * Math.PI) / 180);
    // x hacia el este, y hacia el sur (en SVG el eje y crece hacia abajo).
    const proyectar = ([lon, lat]: [number, number]): [number, number] => [lon * k, -lat];

    const proyectados = anillos.map((anillo) => anillo.map(proyectar));
    const todos = proyectados.flat();
    const xs = todos.map((p) => p[0]);
    const ys = todos.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const ancho = maxX - minX || 1e-9;
    const altoReal = maxY - minY || 1e-9;
    // Un 4 % de aire alrededor para que el trazo no toque el borde.
    const margen = Math.max(ancho, altoReal) * 0.04;

    return {
      viewBox: `${minX - margen} ${minY - margen} ${ancho + margen * 2} ${altoReal + margen * 2}`,
      // El grosor del trazo va en unidades del viewBox, que son grados: se
      // calcula sobre el tamaño de la parcela para que se vea igual de fino en
      // una de 0,6 ha que en una de 78.
      trazo: Math.max(ancho, altoReal) * 0.012,
      caminos: proyectados.map((anillo) => `M ${anillo.map(([x, y]) => `${x} ${y}`).join(" L ")} Z`),
    };
  }, [anillos]);

  if (!dibujo) return null;

  return (
    <svg
      viewBox={dibujo.viewBox}
      style={{ height: alto }}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={titulo ?? "Contorno de la parcela"}
    >
      {titulo && <title>{titulo}</title>}
      {dibujo.caminos.map((d, i) => (
        <path
          key={i}
          d={d}
          className="fill-primary/15 stroke-primary"
          strokeWidth={dibujo.trazo}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
