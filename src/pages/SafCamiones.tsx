// Datos → Importación SAF: el Laadbon de cada camión y el cuadre con el ERP.
//
// POR QUÉ EXISTE (02-09-2026). El vigía de negocio cuadra cada camión SAF con
// su Laadbon (tabla saf_camiones) y pedía "registrar cajas y €/caja en la
// tabla" — cosa que solo se podía hacer con SQL. Aquí se registra el camión
// (cajas, €/caja, porte, kg neto, nº de Laadbon) y se ve al momento el €/kg
// puesto en almacén y la diferencia con lo que valoró el alta del ERP: la
// misma cuenta que hace el vigía (vigiaNegocio.ts), para que pantalla y correo
// no se contradigan.
//
// Debajo, las discrepancias ERP ↔ app que el sincronizador de las 07:10 no
// pisa (erp_correcciones): se pueden ACEPTAR como diferencia conocida (p. ej.
// la importación entra por neto y el ERP pesa bruto) para que el vigía deje
// de recordarlas cada lunes, o volver a vigilarlas.
//
// Admin por construcción: cuelga de /datos (ADMIN_ONLY_PATHS) y las políticas
// de la base solo dejan escribir a admin.
import { useMemo, useState } from "react";
import { Check, Eye, Pencil, Plus, Trash2, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatEurKg, formatEuro, formatKg, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  eurKgPuesto,
  useSafCamiones,
  useSafCamionesMutations,
  type CamionInput,
  type ErpCorreccion,
  type SafCamion,
} from "@/hooks/useSafCamiones";

/** Mismo umbral que el vigía (UMBRAL_CUADRE_SAF_EUR): por debajo no se marca. */
const UMBRAL_CUADRE_EUR = 200;

interface Formulario {
  lote: string;
  fecha: string;
  proveedor: string;
  cajas: string;
  eur_caja: string;
  porte_eur: string;
  kg_neto_laadbon: string;
  laadbon_ref: string;
  notas: string;
}

const FORM_VACIO: Formulario = {
  lote: "", fecha: "", proveedor: "SAF · Uria Export (HG)", cajas: "", eur_caja: "",
  porte_eur: "", kg_neto_laadbon: "", laadbon_ref: "", notas: "",
};

function aFormulario(c: SafCamion): Formulario {
  return {
    lote: c.lote,
    fecha: c.fecha ?? "",
    proveedor: c.proveedor,
    cajas: String(c.cajas ?? ""),
    eur_caja: String(c.eur_caja ?? ""),
    porte_eur: c.porte_eur == null ? "" : String(c.porte_eur),
    kg_neto_laadbon: c.kg_neto_laadbon == null ? "" : String(c.kg_neto_laadbon),
    laadbon_ref: c.laadbon_ref ?? "",
    notas: c.notas ?? "",
  };
}

const num = (s: string): number | null => {
  const v = Number(String(s).replace(",", "."));
  return s.trim() === "" || Number.isNaN(v) ? null : v;
};

export default function SafCamiones() {
  const { data, isLoading } = useSafCamiones();
  const { guardarCamion, borrarCamion, aceptarCorreccion } = useSafCamionesMutations();
  const [form, setForm] = useState<Formulario | null>(null);
  const [editandoLote, setEditandoLote] = useState<string | null>(null);
  const [notaPorClave, setNotaPorClave] = useState<Record<string, string>>({});

  const camiones = data?.camiones ?? [];
  const entradas = data?.entradas ?? [];
  const correcciones = data?.correcciones ?? [];
  const entradaPorLote = useMemo(() => new Map(entradas.map((e) => [e.lote, e])), [entradas]);
  const camionPorLote = useMemo(() => new Map(camiones.map((c) => [c.lote, c])), [camiones]);
  // Entradas SAF que aún no tienen Laadbon: son las que el vigía está pidiendo.
  const sinLaadbon = entradas.filter((e) => !camionPorLote.has(e.lote));

  const abrirNuevo = (lote?: string) => {
    const e = lote ? entradaPorLote.get(lote) : undefined;
    setEditandoLote(null);
    setForm({ ...FORM_VACIO, lote: lote ?? "", fecha: e?.fecha ?? "" });
  };
  const abrirEdicion = (c: SafCamion) => { setEditandoLote(c.lote); setForm(aFormulario(c)); };
  const cerrar = () => { setForm(null); setEditandoLote(null); };

  const set = (k: keyof Formulario) => (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => (f ? { ...f, [k]: ev.target.value } : f));

  const enviar = async () => {
    if (!form) return;
    const cajas = num(form.cajas);
    const eurCaja = num(form.eur_caja);
    const lote = form.lote.trim();
    if (!/^\d{8}$/.test(lote)) return alert("El lote son los 8 dígitos de la entrada (p. ej. 26082701).");
    if (!cajas || cajas <= 0 || !eurCaja || eurCaja <= 0) return alert("Cajas y €/caja son obligatorios y mayores que cero.");
    const input: CamionInput = {
      lote,
      fecha: form.fecha || null,
      proveedor: form.proveedor.trim() || FORM_VACIO.proveedor,
      cajas,
      eur_caja: eurCaja,
      porte_eur: num(form.porte_eur),
      kg_neto_laadbon: num(form.kg_neto_laadbon),
      laadbon_ref: form.laadbon_ref.trim() || null,
      notas: form.notas.trim() || null,
    };
    await guardarCamion.mutateAsync(input);
    cerrar();
  };

  const previsualizacion = form ? eurKgPuesto({
    cajas: num(form.cajas) ?? 0, eur_caja: num(form.eur_caja) ?? 0,
    porte_eur: num(form.porte_eur), kg_neto_laadbon: num(form.kg_neto_laadbon),
  }) : null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Truck className="h-6 w-6" /> Importación SAF: Laadbon y cuadre</h1>
          <p className="text-sm text-muted-foreground">
            Cada camión con su Laadbon de HG (cajas, €/caja, porte, kg netos) frente a lo que valoró el alta del ERP.
            El vigía de negocio usa exactamente estos datos.
          </p>
        </div>
        <Button onClick={() => abrirNuevo()} disabled={!!form}><Plus className="mr-1 h-4 w-4" /> Nuevo camión</Button>
      </div>

      {isLoading && <Skeleton className="h-40 w-full" />}

      {sinLaadbon.length > 0 && !form && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="flex flex-wrap items-center gap-2 p-4 text-sm">
            <span className="font-medium">{sinLaadbon.length === 1 ? "1 entrada SAF sin Laadbon:" : `${sinLaadbon.length} entradas SAF sin Laadbon:`}</span>
            {sinLaadbon.map((e) => (
              <Button key={e.lote} size="sm" variant="outline" onClick={() => abrirNuevo(e.lote)}>
                {e.lote} · {formatDate(e.fecha)} · {formatKg(e.kg_entrada)}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {form && (
        <Card>
          <CardHeader><CardTitle className="text-base">{editandoLote ? `Camión ${editandoLote}` : "Nuevo camión"}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="lote">Lote (entrada del ERP)</Label>
                <Input id="lote" list="lotes-saf" value={form.lote} onChange={set("lote")} disabled={!!editandoLote} placeholder="26082701" inputMode="numeric" />
                <datalist id="lotes-saf">
                  {entradas.map((e) => <option key={e.lote} value={e.lote}>{`${formatDate(e.fecha)} · ${formatKg(e.kg_entrada)}`}</option>)}
                </datalist>
              </div>
              <div className="space-y-1"><Label htmlFor="fecha">Fecha</Label><Input id="fecha" type="date" value={form.fecha} onChange={set("fecha")} /></div>
              <div className="space-y-1"><Label htmlFor="laadbon">Nº Laadbon</Label><Input id="laadbon" value={form.laadbon_ref} onChange={set("laadbon_ref")} placeholder="1184057" /></div>
              <div className="space-y-1"><Label htmlFor="cajas">Cajas</Label><Input id="cajas" value={form.cajas} onChange={set("cajas")} inputMode="numeric" /></div>
              <div className="space-y-1"><Label htmlFor="eur">€ / caja</Label><Input id="eur" value={form.eur_caja} onChange={set("eur_caja")} inputMode="decimal" placeholder="13,50" /></div>
              <div className="space-y-1"><Label htmlFor="porte">Porte (€)</Label><Input id="porte" value={form.porte_eur} onChange={set("porte_eur")} inputMode="decimal" /></div>
              <div className="space-y-1"><Label htmlFor="kg">Kg netos del Laadbon</Label><Input id="kg" value={form.kg_neto_laadbon} onChange={set("kg_neto_laadbon")} inputMode="numeric" /></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="prov">Proveedor</Label><Input id="prov" value={form.proveedor} onChange={set("proveedor")} /></div>
              <div className="space-y-1 sm:col-span-3"><Label htmlFor="notas">Notas</Label><Textarea id="notas" value={form.notas} onChange={set("notas")} rows={2} /></div>
            </div>
            <p className="text-sm text-muted-foreground">
              €/kg puesto en almacén: <b>{previsualizacion == null ? "— (faltan cajas, €/caja o kg netos)" : formatEurKg(previsualizacion)}</b>
            </p>
            <div className="flex gap-2">
              <Button onClick={() => void enviar()} disabled={guardarCamion.isPending}><Check className="mr-1 h-4 w-4" /> Guardar</Button>
              <Button variant="ghost" onClick={cerrar}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Camiones registrados</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lote</TableHead><TableHead>Fecha</TableHead><TableHead>Laadbon</TableHead>
                <TableHead className="text-right">Cajas</TableHead><TableHead className="text-right">€/caja</TableHead>
                <TableHead className="text-right">Porte</TableHead><TableHead className="text-right">Kg netos</TableHead>
                <TableHead className="text-right">€/kg puesto</TableHead><TableHead className="text-right">Alta ERP</TableHead>
                <TableHead className="text-right">Cuadre</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {camiones.length === 0 && !isLoading && (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground">Ningún camión registrado todavía.</TableCell></TableRow>
              )}
              {camiones.map((c) => {
                const e = entradaPorLote.get(c.lote);
                const esperado = Number(c.cajas) * Number(c.eur_caja);
                const alta = e?.importe_compra == null ? null : Number(e.importe_compra);
                const dif = alta == null ? null : alta - esperado;
                return (
                  <TableRow key={c.lote}>
                    <TableCell className="font-medium">{c.lote}{!e && <Badge variant="outline" className="ml-2 text-amber-700">sin entrada</Badge>}</TableCell>
                    <TableCell>{c.fecha ? formatDate(c.fecha) : "—"}</TableCell>
                    <TableCell>{c.laadbon_ref ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatNumber(c.cajas)}</TableCell>
                    <TableCell className="text-right">{formatEuro(c.eur_caja)}</TableCell>
                    <TableCell className="text-right">{c.porte_eur == null ? "—" : formatEuro(c.porte_eur)}</TableCell>
                    <TableCell className="text-right">{c.kg_neto_laadbon == null ? "—" : formatKg(c.kg_neto_laadbon)}</TableCell>
                    <TableCell className="text-right">{(() => { const v = eurKgPuesto(c); return v == null ? "—" : formatEurKg(v); })()}</TableCell>
                    <TableCell className="text-right">{alta == null ? "—" : formatEuro(alta)}</TableCell>
                    <TableCell className={cn("text-right font-medium", dif != null && Math.abs(dif) > UMBRAL_CUADRE_EUR && "text-red-600 dark:text-red-400")}>
                      {dif == null ? "—" : `${dif > 0 ? "+" : ""}${formatEuro(dif)}`}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => abrirEdicion(c)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label="Eliminar" onClick={() => { if (confirm(`¿Eliminar el camión ${c.lote}?`)) borrarCamion.mutate(c.lote); }}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="p-3 text-xs text-muted-foreground">
            Cuadre = alta del ERP − cajas × €/caja (sin porte), como en el vigía; en rojo por encima de {formatEuro(UMBRAL_CUADRE_EUR, 0)}.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Discrepancias ERP ↔ Herramienta</CardTitle>
          <p className="text-sm text-muted-foreground">
            Entradas donde el ERP y la Herramienta tienen dato distinto. La sincronización no pisa ninguno: hay que
            corregir donde toque, o aceptar la diferencia si es conocida (p. ej. la importación entra por neto y el ERP pesa bruto).
            Las aceptadas dejan de salir en el correo del vigía.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lote</TableHead><TableHead>Fecha</TableHead><TableHead>Campo</TableHead>
                <TableHead>Herramienta</TableHead><TableHead>ERP</TableHead><TableHead>Desde</TableHead>
                <TableHead>Estado</TableHead><TableHead>Nota</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {correcciones.length === 0 && !isLoading && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Sin discrepancias: el ERP y la Herramienta dicen lo mismo.</TableCell></TableRow>
              )}
              {correcciones.map((c: ErpCorreccion) => {
                const clave = `${c.lote}|${c.campo}`;
                const aceptada = !!c.aceptada_en;
                return (
                  <TableRow key={clave} className={cn(aceptada && "opacity-60")}>
                    <TableCell className="font-medium">{c.lote}</TableCell>
                    <TableCell>{c.fecha ? formatDate(c.fecha) : "—"}</TableCell>
                    <TableCell><code className="text-xs">{c.campo}</code></TableCell>
                    <TableCell>{c.en_la_app ?? "—"}</TableCell>
                    <TableCell>{c.en_el_erp ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(c.detectada_en)}</TableCell>
                    <TableCell>
                      {aceptada
                        ? <Badge variant="outline">aceptada{c.aceptada_por ? ` · ${c.aceptada_por}` : ""}</Badge>
                        : <Badge className="bg-amber-500/15 text-amber-800 dark:text-amber-200" variant="outline">vigilada</Badge>}
                    </TableCell>
                    <TableCell className="min-w-[12rem]">
                      {aceptada ? (c.nota ?? "—") : (
                        <Input
                          value={notaPorClave[clave] ?? ""}
                          onChange={(ev) => setNotaPorClave((n) => ({ ...n, [clave]: ev.target.value }))}
                          placeholder="Por qué se acepta (opcional)"
                          className="h-8"
                        />
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {aceptada ? (
                        <Button size="sm" variant="ghost" onClick={() => aceptarCorreccion.mutate({ lote: c.lote, campo: c.campo, nota: c.nota, aceptar: false })}>
                          <Eye className="mr-1 h-4 w-4" /> Volver a vigilar
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => aceptarCorreccion.mutate({ lote: c.lote, campo: c.campo, nota: notaPorClave[clave]?.trim() || null, aceptar: true })}>
                          <Check className="mr-1 h-4 w-4" /> Aceptar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
