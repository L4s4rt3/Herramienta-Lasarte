export type TipoMalla = "3kg" | "5kg";

export type EmpaqueComponente =
  | "etiqueta"
  | "caja_logifruit"
  | "palet_doble"
  | "malla_roja"
  | "banda"
  | "fleje"
  | "asa";

export const COMPONENTES_EMPAQUE: EmpaqueComponente[] = [
  "etiqueta", "caja_logifruit", "palet_doble", "malla_roja",
  "banda", "fleje", "asa",
];

export const COMPONENTE_LABEL: Record<EmpaqueComponente, string> = {
  etiqueta: "Etiqueta",
  caja_logifruit: "Caja Logifruit",
  palet_doble: "Doble Palet Logifruit",
  malla_roja: "Malla Roja",
  banda: "Banda",
  fleje: "Fleje",
  asa: "Asa",
};

export const TIPO_MALLA_LABEL: Record<TipoMalla, string> = {
  "3kg": "Malla 3 kg",
  "5kg": "Malla 5 kg",
};

export interface EmpaquePrecioInput {
  tipo_malla: TipoMalla;
  componente: EmpaqueComponente;
  precio_malla: number;
  vigente_desde: string;
}

export function precioVigenteEmpaque<T extends EmpaquePrecioInput>(
  precios: T[],
  tipoMalla: TipoMalla,
  componente: EmpaqueComponente,
  fecha: string,
): T | null {
  let mejor: T | null = null;
  for (const p of precios) {
    if (p.tipo_malla !== tipoMalla) continue;
    if (p.componente !== componente) continue;
    if (p.vigente_desde > fecha) continue;
    if (!mejor || p.vigente_desde > mejor.vigente_desde) {
      mejor = p;
    }
  }
  return mejor;
}

export interface CosteEmpaqueTipoMalla {
  tipoMalla: TipoMalla;
  desglose: { componente: EmpaqueComponente; precioMalla: number }[];
  totalPorMalla: number;
  incompleto: boolean;
}

export function agregarCosteEmpaque<T extends EmpaquePrecioInput>(
  precios: T[],
  fecha: string,
): CosteEmpaqueTipoMalla[] {
  const tipos: TipoMalla[] = ["3kg", "5kg"];
  return tipos.map((tipoMalla) => {
    const desglose = COMPONENTES_EMPAQUE.map((componente) => {
      const vigente = precioVigenteEmpaque(precios, tipoMalla, componente, fecha);
      return {
        componente,
        precioMalla: vigente?.precio_malla ?? 0,
      };
    });
    const total = desglose.reduce((sum, c) => sum + c.precioMalla, 0);
    return {
      tipoMalla,
      desglose,
      totalPorMalla: total,
      incompleto: desglose.some((c) => c.precioMalla === 0),
    };
  });
}
