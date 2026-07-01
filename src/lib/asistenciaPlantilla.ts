export interface PlantillaPuesto {
  zona: string;
  trabajadores: number;
  personas?: string[];
}

export interface PlantillaBloque {
  id: "arranque" | "mallas" | "granelRp" | "mesas" | "cargaDescarga";
  nombre: string;
  total: number;
  puestos: PlantillaPuesto[];
}

export interface CoberturaPlantillaZona {
  zona: string;
  objetivo: number;
  actual: number;
  diferencia: number;
}

export interface CoberturaPlantilla {
  totalObjetivo: number;
  totalActual: number;
  diferencia: number;
  zonas: CoberturaPlantillaZona[];
}

export type ZonaProductivaAlmacenId = "mallas" | "granelRp" | "mesas" | "industria";

export interface RendimientoZonaAlmacen {
  id: ZonaProductivaAlmacenId;
  nombre: string;
  objetivo: number;
  activos: number;
  presentes: number;
  kg: number;
  kgPersonaPresentes: number;
  kgPersonaObjetivo: number;
  diferenciaDotacion: number;
}

export interface RendimientoLineaComun {
  objetivo: number;
  activos: number;
  presentes: number;
}

export interface RendimientoZonasAlmacen {
  lineaComun: RendimientoLineaComun;
  zonas: RendimientoZonaAlmacen[];
}

const TOTAL_TRABAJADORES_OBJETIVO = 58;

const ARRANQUE_PUESTOS: PlantillaPuesto[] = [
  { zona: "Encargadas", trabajadores: 2, personas: ["Raquel Prisco Diaz", "Lidia Luna Rodriguez"] },
  { zona: "Carretillero inicio linea", trabajadores: 1, personas: ["Antonio Jesus Rodriguez Espejo", "Enrique Fernandez"] },
  { zona: "Tria podrido", trabajadores: 2, personas: ["Sandra Naranjo", "Daniela Areiza"] },
  { zona: "Aereo", trabajadores: 2, personas: ["Marta Ariza", "Pilar Llamas"] },
  { zona: "Carretillero final linea", trabajadores: 1, personas: ["Alejandro Carmona", "Juan Prieto"] },
  { zona: "Transpaletas mecanicas", trabajadores: 3, personas: ["Angel Prisco", "Monserrat Garcia Alcazar", "Cristian Prieto", "Enrique Fernandez"] },
  { zona: "Produccion", trabajadores: 3, personas: ["Ana Maria Rodriguez Ramos", "Rocio Flores Ancio", "Sara Hans Doblas", "Silvia Cerro Ojeda"] },
  { zona: "Responsable mantenimiento", trabajadores: 1, personas: ["Antonio Lopez Galvez"] },
];

const MALLAS_PUESTOS: PlantillaPuesto[] = [
  { zona: "Responsables mallas", trabajadores: 3, personas: ["Alvaro Corrales", "Ana Cristina Jimenez", "Encarni Minguez", "Cristobalina Pigner Garcia"] },
  { zona: "Malla 1 - Tria", trabajadores: 1, personas: ["Marina Jimenez"] },
  { zona: "Malla 1 - Recogedoras", trabajadores: 2, personas: ["Araceli Rivera", "Miriam Plaza"] },
  { zona: "Malla 2 - Tria", trabajadores: 1, personas: ["Maria Pilar Moreno"] },
  { zona: "Malla 2 - Recogedoras", trabajadores: 2, personas: ["Rocio Garcia Navarro", "Rocio Gonzalez"] },
  { zona: "Malla 3 - Tria", trabajadores: 1, personas: ["Sandra Leon"] },
  { zona: "Malla 3 - Recogedoras", trabajadores: 2, personas: ["Lucia Ferrero Martinez", "Libertad Diaz"] },
  { zona: "Malla 4 - Tria", trabajadores: 1, personas: ["Ana Belen Rodriguez Laguna"] },
  { zona: "Malla 4 - Recogedoras", trabajadores: 1, personas: ["Eli Conde"] },
];

const GRANEL_RP_PUESTOS: PlantillaPuesto[] = [
  { zona: "Responsables granel/RP", trabajadores: 2, personas: ["Eva Llamas", "Irene Luna"] },
  { zona: "Triadoras granel/RP", trabajadores: 3, personas: ["Virginia Fabra", "Laura Rivero Rodriguez", "Sonia Lebron"] },
  { zona: "Rapid Pack", trabajadores: 2 },
];

const mesasBase = [
  { zona: "Mozos envasado", trabajadores: 4, personas: ["Borja Garrido", "Josue Prisco", "Rafael Arjona", "Ruben Chaparro"] },
] satisfies PlantillaPuesto[];

const MESAS_PUESTOS: PlantillaPuesto[] = [
  ...mesasBase,
  { zona: "Envasadoras", trabajadores: 14 },
];

const CARGA_DESCARGA_PUESTOS: PlantillaPuesto[] = [
  { zona: "Carga y descarga", trabajadores: 4 },
];

export const ASISTENCIA_PLANTILLA_OPERATIVA = {
  arranque: {
    id: "arranque",
    nombre: "Arranque linea",
    total: totalPuestos(ARRANQUE_PUESTOS),
    puestos: ARRANQUE_PUESTOS,
  },
  mallas: {
    id: "mallas",
    nombre: "Grupo de mallas",
    total: totalPuestos(MALLAS_PUESTOS),
    puestos: MALLAS_PUESTOS,
  },
  granelRp: {
    id: "granelRp",
    nombre: "Graneleras",
    total: totalPuestos(GRANEL_RP_PUESTOS),
    puestos: GRANEL_RP_PUESTOS,
  },
  mesas: {
    id: "mesas",
    nombre: "Mesas",
    total: totalPuestos(MESAS_PUESTOS),
    puestos: MESAS_PUESTOS,
  },
  cargaDescarga: {
    id: "cargaDescarga",
    nombre: "Carga y descarga",
    total: totalPuestos(CARGA_DESCARGA_PUESTOS),
    puestos: CARGA_DESCARGA_PUESTOS,
  },
} satisfies Record<string, PlantillaBloque>;

export const ASISTENCIA_PLANTILLA_BLOQUES = Object.values(ASISTENCIA_PLANTILLA_OPERATIVA);
export const ASISTENCIA_ZONAS_PRODUCTIVAS = [
  ASISTENCIA_PLANTILLA_OPERATIVA.mallas,
  ASISTENCIA_PLANTILLA_OPERATIVA.granelRp,
  ASISTENCIA_PLANTILLA_OPERATIVA.mesas,
] as const;

export const ASISTENCIA_PLANTILLA_ZONAS = ASISTENCIA_PLANTILLA_BLOQUES.flatMap((bloque) =>
  bloque.puestos.map((puesto) => puesto.zona),
);

export function totalPlantillaOperativa() {
  return ASISTENCIA_PLANTILLA_BLOQUES.reduce((sum, bloque) => sum + bloque.total, 0);
}

export function calcularCoberturaPlantilla(
  trabajadores: readonly { zona?: string | null; activo: boolean }[],
): CoberturaPlantilla {
  const activosPorZona = trabajadores.reduce<Map<string, number>>((map, trabajador) => {
    if (!trabajador.activo || !trabajador.zona) return map;
    map.set(trabajador.zona, (map.get(trabajador.zona) ?? 0) + 1);
    return map;
  }, new Map<string, number>());

  const zonas = ASISTENCIA_PLANTILLA_BLOQUES.flatMap((bloque) =>
    bloque.puestos.map((puesto) => {
      const actual = activosPorZona.get(puesto.zona) ?? 0;
      return {
        zona: puesto.zona,
        objetivo: puesto.trabajadores,
        actual,
        diferencia: actual - puesto.trabajadores,
      };
    }),
  );

  const totalObjetivo = totalPlantillaOperativa();
  const totalActual = zonas.reduce((sum, zona) => sum + zona.actual, 0);

  return {
    totalObjetivo,
    totalActual,
    diferencia: totalActual - totalObjetivo,
    zonas,
  };
}

export function calcularRendimientoZonasAlmacen({
  trabajadores,
  asistencia,
  kgPorZona,
}: {
  trabajadores: readonly { id: string; nombre?: string | null; zona?: string | null; activo: boolean }[];
  asistencia: Record<string, boolean>;
  kgPorZona: Record<ZonaProductivaAlmacenId, number>;
}): RendimientoZonasAlmacen {
  const trabajadoresActivos = trabajadores.filter((trabajador) => trabajador.activo);
  const trabajadoresPorNombre = new Map(
    trabajadoresActivos
      .filter((trabajador) => trabajador.nombre)
      .map((trabajador) => [normalizarClavePersona(trabajador.nombre), trabajador]),
  );
  const estaPresente = (trabajador: { id: string }) => asistencia[trabajador.id] === true;
  const esCargaDescarga = (trabajador: { zona?: string | null }) =>
    normalizarClavePersona(trabajador.zona) === normalizarClavePersona("Carga y descarga");
  const esEnvasadoFlexible = (trabajador: { zona?: string | null }) => {
    const zona = normalizarClavePersona(trabajador.zona);
    return zona === normalizarClavePersona("Envasadoras") ||
      zona === normalizarClavePersona("Empaquetadoras mesas") ||
      zona === normalizarClavePersona("Mesas") ||
      zona === normalizarClavePersona("Envasado");
  };

  const countForPuestos = (
    puestos: readonly PlantillaPuesto[],
    usedPresentes = new Set<string>(),
    allowZonaFallback = true,
  ) => {
    const zonasConFallback = new Set(puestos.filter((puesto) => !puesto.personas?.length).map((puesto) => puesto.zona));
    let activos = 0;
    let presentes = 0;
    const usados = new Set(usedPresentes);
    // Dedup de "activos": un trabajador que aparece en varios puestos cuenta una sola vez.
    const usadosActivos = new Set<string>();

    for (const puesto of puestos) {
      if (puesto.personas?.length) {
        const candidatos = puesto.personas
          .map((persona) => trabajadoresPorNombre.get(normalizarClavePersona(persona)))
          .filter((trabajador): trabajador is NonNullable<typeof trabajador> => Boolean(trabajador));
        let nuevosActivos = 0;
        for (const candidato of candidatos) {
          if (nuevosActivos >= puesto.trabajadores) break;
          if (usadosActivos.has(candidato.id)) continue;
          usadosActivos.add(candidato.id);
          nuevosActivos += 1;
        }
        activos += nuevosActivos;

        let cubiertos = 0;
        for (const candidato of candidatos) {
          if (cubiertos >= puesto.trabajadores) break;
          if (usados.has(candidato.id) || !estaPresente(candidato)) continue;
          usados.add(candidato.id);
          cubiertos += 1;
        }
        presentes += cubiertos;
        continue;
      }

      if (!allowZonaFallback) continue;
      const candidatos = trabajadoresActivos.filter((trabajador) =>
        trabajador.zona &&
        zonasConFallback.has(trabajador.zona) &&
        !usados.has(trabajador.id)
      );
      let nuevosActivos = 0;
      for (const candidato of candidatos) {
        if (nuevosActivos >= puesto.trabajadores) break;
        if (usadosActivos.has(candidato.id)) continue;
        usadosActivos.add(candidato.id);
        nuevosActivos += 1;
      }
      activos += nuevosActivos;
      const presentesPuesto = candidatos.filter(estaPresente).slice(0, puesto.trabajadores);
      for (const trabajador of presentesPuesto) usados.add(trabajador.id);
      presentes += presentesPuesto.length;
    }

    return {
      activos,
      presentes,
      usadosPresentes: usados,
    };
  };

  const linea = countForPuestos(ASISTENCIA_PLANTILLA_OPERATIVA.arranque.puestos);
  const envasadoDisponibleParaSustituir = (usados: Set<string>) =>
    trabajadoresActivos.filter((trabajador) =>
      !usados.has(trabajador.id) &&
      !esCargaDescarga(trabajador) &&
      esEnvasadoFlexible(trabajador) &&
      estaPresente(trabajador)
    ).length;

  const buildZona = (bloque: (typeof ASISTENCIA_ZONAS_PRODUCTIVAS)[number], kg: number) => {
    const counts = countForPuestos(bloque.puestos, linea.usadosPresentes);
    const deficitZona = Math.max(0, bloque.total - counts.presentes);
    const sustituciones = Math.min(deficitZona, envasadoDisponibleParaSustituir(counts.usadosPresentes));
    const presentesZona = counts.presentes + sustituciones;
    const objetivo = ASISTENCIA_PLANTILLA_OPERATIVA.arranque.total + bloque.total;
    const presentes = Math.min(objetivo, linea.presentes + presentesZona);

    return {
      id: bloque.id as ZonaProductivaAlmacenId,
      nombre: bloque.nombre,
      objetivo,
      activos: linea.activos + counts.activos,
      presentes,
      kg,
      kgPersonaPresentes: presentes > 0 ? kg / presentes : 0,
      kgPersonaObjetivo: objetivo > 0 ? kg / objetivo : 0,
      diferenciaDotacion: presentes - objetivo,
    };
  };

  const zonas = ASISTENCIA_ZONAS_PRODUCTIVAS.map((bloque) => {
    const id = bloque.id as ZonaProductivaAlmacenId;
    return buildZona(bloque, kgPorZona[id] ?? 0);
  });
  const kgIndustria = kgPorZona.industria ?? 0;
  zonas.push({
    id: "industria",
    nombre: "Industria",
    objetivo: ASISTENCIA_PLANTILLA_OPERATIVA.arranque.total,
    activos: linea.activos,
    presentes: Math.min(ASISTENCIA_PLANTILLA_OPERATIVA.arranque.total, linea.presentes),
    kg: kgIndustria,
    kgPersonaPresentes: linea.presentes > 0 ? kgIndustria / linea.presentes : 0,
    kgPersonaObjetivo: ASISTENCIA_PLANTILLA_OPERATIVA.arranque.total > 0
      ? kgIndustria / ASISTENCIA_PLANTILLA_OPERATIVA.arranque.total
      : 0,
    diferenciaDotacion: linea.presentes - ASISTENCIA_PLANTILLA_OPERATIVA.arranque.total,
  });

  return {
    lineaComun: {
      objetivo: ASISTENCIA_PLANTILLA_OPERATIVA.arranque.total,
      activos: linea.activos,
      presentes: linea.presentes,
    },
    zonas,
  };
}

function totalPuestos(puestos: readonly PlantillaPuesto[]) {
  return puestos.reduce((sum, puesto) => sum + puesto.trabajadores, 0);
}

function normalizarClavePersona(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim()
    .replace(/\s+/g, " ");
}
