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

export interface RendimientoSinZona {
  presentes: number;
  personas: string[];
}

/** Presentes con horas fuera de línea ese día (p. ej. limpiando box). */
export interface RendimientoFueraLinea {
  presentes: number;
  personas: string[];
}

export interface RendimientoZonasAlmacen {
  lineaComun: RendimientoLineaComun;
  zonas: RendimientoZonaAlmacen[];
  sinZona: RendimientoSinZona;
  /**
   * Presentes con horas apuntadas en limpieza de box. Informativo: quien
   * limpia unas horas sigue contando como presente entero en su zona; solo
   * quien pasa la JORNADA COMPLETA limpiando queda fuera del reparto.
   */
  fueraLinea: RendimientoFueraLinea;
  /**
   * Presentes reconocidos cuyo puesto ya estaba cubierto: refuerzan Envasado
   * (mesas) en el reparto — cuando vienen todos los candidatos de un puesto,
   * el que sobra va a mesas (decisión del dueño).
   */
  refuerzoMesas: RendimientoFueraLinea;
}

const ARRANQUE_PUESTOS: PlantillaPuesto[] = [
  { zona: "Encargadas", trabajadores: 2, personas: ["Raquel Prisco Diaz", "Lidia Luna Rodriguez"] },
  { zona: "Carretillero inicio linea", trabajadores: 1, personas: ["Antonio Jesus Rodriguez Espejo", "Enrique Fernandez"] },
  { zona: "Tria podrido", trabajadores: 2, personas: ["Sandra Naranjo", "Daniela Areiza"] },
  { zona: "Aereo", trabajadores: 2, personas: ["Marta Ariza", "Pilar Llamas"] },
  { zona: "Carretillero final linea", trabajadores: 1, personas: ["Alejandro Carmona", "Juan Prieto"] },
  { zona: "Transpaletas mecanicas", trabajadores: 3, personas: ["Angel Prisco", "Monserrat Garcia Alcazar", "Cristian Prisco", "Enrique Fernandez"] },
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
  jornadaFueraLinea,
}: {
  trabajadores: readonly { id: string; nombre?: string | null; zona?: string | null; activo: boolean }[];
  asistencia: Record<string, boolean>;
  kgPorZona: Record<ZonaProductivaAlmacenId, number>;
  /**
   * Fracción de jornada (0..1) que cada trabajador pasó FUERA de la línea ese
   * día (p. ej. horas de limpieza de box / jornada de 8h). Las personas no se
   * parten: quien limpió unas horas sigue contando como presente ENTERO en su
   * zona (y sale listado en `fueraLinea` a título informativo); solo quien
   * llega a la jornada completa (fracción 1) queda fuera del reparto — ese
   * día no estuvo en ninguna zona. Sin entrada = jornada completa en línea.
   */
  jornadaFueraLinea?: Record<string, number>;
}): RendimientoZonasAlmacen {
  const trabajadoresActivos = trabajadores.filter((trabajador) => trabajador.activo);
  const trabajadoresPorNombre = new Map(
    trabajadoresActivos
      .filter((trabajador) => trabajador.nombre)
      .map((trabajador) => [normalizarClavePersona(trabajador.nombre), trabajador]),
  );
  const estaPresente = (trabajador: { id: string }) => asistencia[trabajador.id] === true;
  const fraccionFuera = (id: string) => {
    const f = Number(jornadaFueraLinea?.[id]);
    return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
  };
  /** Presente Y con algo de jornada en línea (no pasó el día entero fuera). */
  const cuentaEnLinea = (trabajador: { id: string }) =>
    estaPresente(trabajador) && fraccionFuera(trabajador.id) < 1;
  const esCargaDescarga = (trabajador: { zona?: string | null }) =>
    normalizarClavePersona(trabajador.zona) === normalizarClavePersona("Carga y descarga");
  const esEnvasadoFlexible = (trabajador: { zona?: string | null }) => {
    const zona = normalizarClavePersona(trabajador.zona);
    return zona === normalizarClavePersona("Envasadoras") ||
      zona === normalizarClavePersona("Empaquetadoras mesas") ||
      zona === normalizarClavePersona("Mesas") ||
      zona === normalizarClavePersona("Envasado");
  };

  // Cuenta la gente de un bloque de puestos cubriendo sus plazas y detectando
  // el EXCEDENTE: si un puesto lista más candidatos que plazas (sustitutos) y
  // ese día vienen todos, el sobrante no se queda en el bloque — refuerza
  // Envasado (mesas), que es a donde va esa gente en la práctica (decisión
  // del dueño). El excedente se recoge DESPUÉS de cubrir todas las plazas del
  // bloque, para que un candidato compartido entre puestos (p. ej. el
  // sustituto de carretillero que también es transpaleta) ocupe su otra plaza
  // antes de darlo por sobrante.
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
    // Todos los candidatos del bloque, para detectar el excedente al final.
    const candidatosBloque = new Map<string, (typeof trabajadoresActivos)[number]>();

    for (const puesto of puestos) {
      let candidatos: typeof trabajadoresActivos;
      if (puesto.personas?.length) {
        candidatos = puesto.personas
          .map((persona) => trabajadoresPorNombre.get(normalizarClavePersona(persona)))
          .filter((trabajador): trabajador is NonNullable<typeof trabajador> => Boolean(trabajador));
      } else {
        if (!allowZonaFallback) continue;
        candidatos = trabajadoresActivos.filter((trabajador) =>
          trabajador.zona &&
          zonasConFallback.has(trabajador.zona) &&
          !usedPresentes.has(trabajador.id)
        );
      }

      for (const candidato of candidatos) {
        if (!usadosActivos.has(candidato.id)) {
          usadosActivos.add(candidato.id);
          activos += 1;
        }
        candidatosBloque.set(candidato.id, candidato);
      }

      let cubiertos = 0;
      for (const candidato of candidatos) {
        if (cubiertos >= puesto.trabajadores) break;
        // Quien pasa el día entero fuera de línea no ocupa plaza: la deja
        // libre para el sustituto (y no cae a "Sin zona": ya sabemos dónde está).
        if (usados.has(candidato.id) || !cuentaEnLinea(candidato)) continue;
        usados.add(candidato.id);
        presentes += 1;
        cubiertos += 1;
      }
    }

    // Excedente: presentes reconocidos del bloque cuyas plazas ya estaban
    // cubiertas. Se marcan como usados (no son "Sin zona") y se listan como
    // sobrantes para el refuerzo de mesas.
    const sobrantes: Array<{ id: string; nombre?: string | null }> = [];
    for (const candidato of candidatosBloque.values()) {
      if (usados.has(candidato.id) || !cuentaEnLinea(candidato)) continue;
      usados.add(candidato.id);
      sobrantes.push(candidato);
    }

    return {
      activos,
      presentes,
      usadosPresentes: usados,
      sobrantes,
    };
  };

  const linea = countForPuestos(ASISTENCIA_PLANTILLA_OPERATIVA.arranque.puestos);
  const envasadoDisponibleParaSustituir = (usados: Set<string>) =>
    trabajadoresActivos.filter((trabajador) =>
      !usados.has(trabajador.id) &&
      !esCargaDescarga(trabajador) &&
      esEnvasadoFlexible(trabajador) &&
      cuentaEnLinea(trabajador)
    ).length;

  const buildZona = (
    bloque: (typeof ASISTENCIA_ZONAS_PRODUCTIVAS)[number],
    kg: number,
    counts: ReturnType<typeof countForPuestos>,
    refuerzo = 0,
  ) => {
    const deficitZona = Math.max(0, bloque.total - counts.presentes);
    const sustituciones = Math.min(deficitZona, envasadoDisponibleParaSustituir(counts.usadosPresentes));
    const presentesZona = counts.presentes + sustituciones + refuerzo;
    const objetivo = ASISTENCIA_PLANTILLA_OPERATIVA.arranque.total + bloque.total;
    // Sin tope por objetivo: si vino más gente de la dotación, el kg/persona
    // se reparte entre los que realmente estuvieron.
    const presentes = linea.presentes + presentesZona;

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

  // Acumula, a través de todos los bloques (arranque + cada zona productiva),
  // qué presentes ya quedaron asignados a un puesto — para poder detectar al
  // final quién se queda fuera y no perderlo en silencio.
  const usadosGlobal = new Set(linea.usadosPresentes);

  // Carga y descarga se cuenta ANTES de las zonas (sus candidatos —zona
  // exacta "Carga y descarga"— no compiten con ningún otro bloque): no forma
  // parte del reparto por zonas ni de la línea, pero sus presentes cuentan
  // como "asignados" para no acabar en "Sin zona". Su excedente NO refuerza
  // mesas: carga y descarga ya está fuera del kg/persona.
  const cargaDescarga = countForPuestos(ASISTENCIA_PLANTILLA_OPERATIVA.cargaDescarga.puestos, usadosGlobal);
  for (const trabajadorId of cargaDescarga.usadosPresentes) usadosGlobal.add(trabajadorId);

  // El excedente reconocido (línea y zonas) va acumulándose y desemboca en
  // mesas, la última zona productiva del array.
  const refuerzoMesasPersonas = [...linea.sobrantes];
  const zonas = ASISTENCIA_ZONAS_PRODUCTIVAS.map((bloque) => {
    const zonaId = bloque.id as ZonaProductivaAlmacenId;
    const counts = countForPuestos(bloque.puestos, usadosGlobal);
    for (const trabajadorId of counts.usadosPresentes) usadosGlobal.add(trabajadorId);
    refuerzoMesasPersonas.push(...counts.sobrantes);
    return buildZona(bloque, kgPorZona[zonaId] ?? 0, counts, bloque.id === "mesas" ? refuerzoMesasPersonas.length : 0);
  });
  const kgIndustria = kgPorZona.industria ?? 0;
  zonas.push({
    id: "industria",
    nombre: "Industria",
    objetivo: ASISTENCIA_PLANTILLA_OPERATIVA.arranque.total,
    activos: linea.activos,
    presentes: linea.presentes,
    kg: kgIndustria,
    kgPersonaPresentes: linea.presentes > 0 ? kgIndustria / linea.presentes : 0,
    kgPersonaObjetivo: ASISTENCIA_PLANTILLA_OPERATIVA.arranque.total > 0
      ? kgIndustria / ASISTENCIA_PLANTILLA_OPERATIVA.arranque.total
      : 0,
    diferenciaDotacion: linea.presentes - ASISTENCIA_PLANTILLA_OPERATIVA.arranque.total,
  });

  // Cualquier persona presente ese día que no haya quedado asignada a ningún
  // puesto conocido (ni por nombre, ni por zona-fallback, ni carga y
  // descarga) se agrupa en "Sin zona" en vez de desaparecer del recuento.
  // Quien pasó la jornada COMPLETA fuera de línea (fracción 1, p. ej. todo el
  // día limpiando box) no es "sin zona": ya sabemos dónde estuvo.
  const presentesSinZona = trabajadoresActivos.filter(
    (trabajador) =>
      estaPresente(trabajador) && !usadosGlobal.has(trabajador.id) && fraccionFuera(trabajador.id) < 1,
  );
  const sinZona: RendimientoSinZona = {
    presentes: presentesSinZona.length,
    personas: presentesSinZona.map((trabajador) => trabajador.nombre ?? trabajador.id),
  };

  const presentesFueraLinea = trabajadoresActivos.filter(
    (trabajador) => estaPresente(trabajador) && fraccionFuera(trabajador.id) > 0,
  );
  const fueraLinea: RendimientoFueraLinea = {
    presentes: presentesFueraLinea.length,
    personas: presentesFueraLinea.map((trabajador) => trabajador.nombre ?? trabajador.id),
  };

  const refuerzoMesas: RendimientoFueraLinea = {
    presentes: refuerzoMesasPersonas.length,
    personas: refuerzoMesasPersonas.map((trabajador) => trabajador.nombre ?? trabajador.id),
  };

  return {
    lineaComun: {
      objetivo: ASISTENCIA_PLANTILLA_OPERATIVA.arranque.total,
      activos: linea.activos,
      presentes: linea.presentes,
    },
    zonas,
    sinZona,
    fueraLinea,
    refuerzoMesas,
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
