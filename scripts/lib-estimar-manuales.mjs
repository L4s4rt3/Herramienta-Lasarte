/**
 * La lógica PURA de la estimación de los manuales del parte. Aparte del runner
 * (estimar-manuales-parte.mjs) para poder probarla sin tocar nada:
 * probar-estimar-manuales.mjs.
 *
 * ENCARGO DEL USUARIO (17-08-2026, se va una semana): "si no hay información de
 * la que yo pongo manual, se haga una estimación según histórico". Sin esto los
 * partes se quedan en Borrador esperando el papel y la semana sale a medias.
 *
 * EL MÉTODO SALE DE LOS DATOS (30 partes, 5-jul a 17-ago):
 *
 *   industria ........ 22 de 30 días es 0 DE VERDAD (el camión de Cítrica no va
 *                      a diario): la mediana es 0 y estimar kilos inventaría
 *                      fruta que no salió. Se pone la mediana (normalmente 0).
 *   reciclado Z1/Z2 .. casi diario (27/30), 183-1.248 kg: mediana de los
 *                      últimos 14 partes con papel. El box y el bruto salen de
 *                      la aritmética observada — box = ⌈neto/230⌉ y
 *                      bruto = neto + 30·box — que clava 6 de 6 días reales.
 *   inventario ....... NO se estima por historial si hay fotos del ERP: la
 *                      deducción de las fotos dio 890 kg donde el papel decía
 *                      882 (13-08) y 750 donde 635 (14-08). La mediana (~2.700)
 *                      erraría por miles. Fotos primero, mediana de respaldo.
 *   podrido bolsa .... mediana (no entra en el DSJ, es informativo).
 *   podrido bateas ... NO SE ESTIMA JAMÁS: solo cuenta el día que se vacían y
 *                      eso no se puede saber a distancia. Se deja a 0 con nota.
 *
 * REGLAS DE LA CASA QUE ESTO RESPETA:
 *   - Nunca en silencio: cada campo estimado queda en campos_estimados con su
 *     valor y su método, y el correo lo cuenta.
 *   - El dato real SIEMPRE gana: si alguien teclea el campo, `pisados()` lo
 *     detecta y la estimación se retira sola.
 *   - Solo partes en Borrador con los CINCO del papel a cero (así se distingue
 *     "nadie lo metió" de "metieron un 0 real") y con un día entero de gracia.
 */

/** Los cinco del papel — mismos nombres que rehacer-parte.mjs. */
export const CINCO_DEL_PAPEL = [
  "kg_industria_manual", "kg_reciclado_malla_z1", "kg_reciclado_malla_z2",
  "kg_inventario_sin_alta", "kg_podrido_bolsa_basura",
];

const num = (v) => Number(v) || 0;

export function mediana(xs) {
  const v = xs.map(num).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** ¿Está el papel sin meter? Los CINCO a cero — un solo campo a 0 puede ser un 0 real. */
export function sinManuales(parte) {
  return CINCO_DEL_PAPEL.every((c) => num(parte[c]) === 0);
}

/**
 * ¿Le toca estimación a este parte? Borrador + producción real + papel sin
 * meter + un día entero de gracia (fecha <= límite) para que una persona pueda
 * adelantarse. Los Validado/Analizado no se tocan: alguien ya decidió.
 */
export function esCandidato(parte, limiteFecha) {
  return parte.estado === "Borrador"
    && num(parte.kg_produccion_calibrador) > 0
    && sinManuales(parte)
    && parte.date <= limiteFecha;
}

/** El box y el bruto del reciclado, con la aritmética observada (6 de 6 días reales). */
export function derivadosReciclado(neto) {
  if (!(neto > 0)) return { box: 0, bruto: 0 };
  const box = Math.ceil(neto / 230);
  return { box, bruto: Math.round(neto + 30 * box) };
}

/**
 * Estima los manuales de un parte.
 *
 * @param historico          partes ANTERIORES con papel metido (no sinManuales), de viejo a nuevo
 * @param inventarioDeducido kg de la deducción de las fotos del ERP, o null si no se pudo
 * @param ventana            cuántos partes recientes del histórico usar (14)
 */
export function estimarCampos({ historico = [], inventarioDeducido = null, ventana = 14 } = {}) {
  const base = historico.slice(-ventana);
  const med = (campo) => mediana(base.map((p) => num(p[campo])));

  const campos = {};
  const detalle = [];
  const pon = (campo, valor, metodo, etiqueta) => {
    if (valor == null) return;
    campos[campo] = Math.round(valor);
    detalle.push({ campo, valor: Math.round(valor), metodo, etiqueta });
  };

  const mIndustria = med("kg_industria_manual");
  pon("kg_industria_manual", mIndustria, "mediana-14d",
    mIndustria === 0 ? "Industria (lo habitual es que no salga camion)" : "Industria");

  for (const [zona, campo] of [["Z1", "kg_reciclado_malla_z1"], ["Z2", "kg_reciclado_malla_z2"]]) {
    const neto = med(campo);
    if (neto == null) continue;
    pon(campo, neto, "mediana-14d", `Reciclado ${zona}`);
    const { box, bruto } = derivadosReciclado(neto);
    if (bruto > 0) {
      campos[`${campo}_bruto`] = bruto;
      campos[`box_reciclaje_${zona.toLowerCase()}`] = box;
      detalle.push({ campo: `${campo}_bruto`, valor: bruto, metodo: "aritmetica-box", etiqueta: `  bruto ${zona} (${box} box)` });
    }
  }

  if (inventarioDeducido != null && inventarioDeducido >= 0) {
    pon("kg_inventario_sin_alta", inventarioDeducido, "fotos-erp", "Inventario sin alta (deducido de las fotos del ERP)");
  } else {
    pon("kg_inventario_sin_alta", med("kg_inventario_sin_alta"), "mediana-14d",
      "Inventario sin alta (mediana: ese dia no hubo fotos)");
  }

  pon("kg_podrido_bolsa_basura", med("kg_podrido_bolsa_basura"), "mediana-14d", "Podrido de bolsa");

  // El podrido de bateas NO se estima: es un evento (solo cuenta si se
  // vaciaron) y no se puede saber a distancia. Queda a 0 y se dice.
  detalle.push({ campo: "kg_podrido_bateas", valor: null, metodo: "no-se-estima",
    etiqueta: "Podrido de bateas: no se estima (solo cuenta si se vaciaron; apuntalo al volver si toco)" });

  return { campos, detalle };
}

/**
 * Estimaciones que una persona ya PISÓ con el dato real: el valor actual del
 * campo difiere del estimado. Se retiran de campos_estimados — el real gana.
 */
export function pisados(parte) {
  const marcas = parte.campos_estimados?.campos ?? {};
  return Object.keys(marcas).filter((campo) =>
    Math.abs(num(parte[campo]) - num(marcas[campo]?.valor)) > 0.5);
}
