// src/components/PaginaConVistas.tsx
// Una página que aloja varias vistas en pestañas, con la vista activa en la URL.
//
// PARA QUÉ. El rediseño del 13-08-2026 fundió páginas que contestaban a la
// MISMA pregunta por ejes distintos: Costes absorbió Consumos, CMV, Coste por
// producto y Compra de fruta; Plantilla absorbió ausencias, amonestaciones,
// vacaciones y comunicaciones; Importar absorbió el histórico. En vez de
// reescribir esas páginas, cada una se monta tal cual dentro de una pestaña:
// el código de negocio no se toca y no hay ocasión de romperlo.
//
// LA VISTA VA EN LA URL (`?vista=`), no en un useState, por tres razones:
//   · las páginas absorbidas redirigen a su pestaña y el enlace sigue valiendo
//     (/economico/cmv → /economico/costes?vista=cmv, ver src/App.tsx);
//   · se puede compartir "mira esta pestaña" por chat;
//   · atrás y adelante del navegador funcionan como espera cualquiera.
//
// CADA VISTA SE MONTA SOLO CUANDO SE ABRE. Son páginas enteras con sus propios
// hooks: montarlas todas de golpe dispararía cinco cargas de datos para enseñar
// una. Radix desmonta el contenido de las pestañas inactivas por defecto, que
// es justo lo que hace falta.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface VistaPagina {
  /** Valor que va en `?vista=`. Estable: es parte de la URL pública. */
  id: string;
  label: string;
  /** Se llama solo cuando la pestaña está abierta. */
  render: () => React.ReactNode;
  /** false = la pestaña no se pinta (permisos, dato no disponible...). */
  visible?: boolean;
}

interface Props {
  vistas: VistaPagina[];
  /** Nombre del parámetro en la URL. `vista` salvo que choque con la página. */
  param?: string;
}

export function PaginaConVistas({ vistas, param = "vista" }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const visibles = useMemo(() => vistas.filter((v) => v.visible !== false), [vistas]);

  const pedida = searchParams.get(param);
  // Una vista pedida que no existe (enlace viejo, errata) cae a la primera en
  // vez de dejar la página en blanco.
  const activa = visibles.some((v) => v.id === pedida) ? (pedida as string) : visibles[0]?.id;

  if (visibles.length === 0) return null;

  return (
    <Tabs
      value={activa}
      onValueChange={(v) => {
        const siguiente = new URLSearchParams(searchParams);
        siguiente.set(param, v);
        // replace: cambiar de pestaña no debería llenar el historial de atrás.
        setSearchParams(siguiente, { replace: true });
      }}
      className="space-y-4"
    >
      <TabsList className="w-full flex-wrap justify-start sm:w-auto">
        {visibles.map((v) => (
          <TabsTrigger key={v.id} value={v.id}>{v.label}</TabsTrigger>
        ))}
      </TabsList>
      {visibles.map((v) => (
        <TabsContent key={v.id} value={v.id} className="space-y-4">
          {v.render()}
        </TabsContent>
      ))}
    </Tabs>
  );
}
