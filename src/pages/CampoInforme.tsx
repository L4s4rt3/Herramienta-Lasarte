// Campo → Informe de finca (16-09-2026).
//
// LA PÁGINA QUE PEDÍA VADIM: eliges la finca, le das a un botón y sale el
// informe técnico de campo, sin tener que llamar a Luis ni a José María.
//
// LO QUE SE TECLEA AQUÍ es solo lo que nadie más sabe: el día de la visita,
// quién fue, los milímetros de cada punto y las capturas de Aeroview. Todo lo
// demás —calibre por semana, previsión, curva y su fuente, hectáreas, y lo que
// la finca entregó en almacén— ya está en la base y lo pone el informe solo.
//
// LO QUE FALTA SE DICE ANTES DE GENERAR, no después: el panel de avisos lista
// lo que no se va a poder imprimir (sin capturas no hay figuras, sin puntos no
// hay tabla de muestreo) para que se decida con la información delante.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, Loader2, Map as IconoMapa, MapPin, Plus, Sprout, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCampoParcelas } from "@/hooks/useCampoParcelas";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import {
  generarYEntregarInformeCampo, useCampoInformes, useDetalleInforme, useInformeArmado,
} from "@/hooks/useCampoInformes";
import { etiquetaSemana, OBJETIVO_MM_DEFECTO, parcelasDeFinca, type ImagenInforme, type InformeCampoRow, type PuntoMuestreo } from "@/lib/campoInforme";
import { dibujarMapaParcela } from "@/lib/campoMapaCanvas";
import type { CampoParcelaRow } from "@/lib/campoParcelas";
import { formatKg, normalizarTexto } from "@/lib/format";

/** Los tres huecos de captura que tiene el informe, en el orden en que salen. */
const HUECOS: Array<{ tipo: ImagenInforme["tipo"]; titulo: string; ayuda: string }> = [
  { tipo: "estructura", titulo: "Estructura de tamaño", ayuda: "El panel de Aeroview con el reparto de calibres (Figura 1)." },
  { tipo: "mapa", titulo: "Mapa con los puntos", ayuda: "La vista de la parcela con P1, P2… marcados (Figura 2)." },
  { tipo: "modelizacion", titulo: "Modelización de evolución", ayuda: "La curva de crecimiento de Aeroview (Figura 3)." },
];

const hoy = () => new Date().toISOString().slice(0, 10);

/** La semana ISO de hoy en el formato de Aerobotics ("2026W38"). */
function semanaDeHoyIso(): string {
  const d = new Date();
  const jueves = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  jueves.setUTCDate(jueves.getUTCDate() + 4 - (jueves.getUTCDay() || 7));
  const inicio = new Date(Date.UTC(jueves.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((jueves.getTime() - inicio.getTime()) / 86400000 + 1) / 7);
  return `${jueves.getUTCFullYear()}W${String(semana).padStart(2, "0")}`;
}

export default function CampoInforme() {
  const { fichas, isLoading: cargandoParcelas } = useCampoParcelas();
  const { entradas, isLoading: cargandoEntradas } = useEntradasBascula();
  const { informes, isLoading: cargandoInformes, crear, guardar, borrar, guardando } = useCampoInformes();

  // La finca va en la URL (?finca=Ganchal): así se puede llegar desde Campo →
  // Parcelas con un enlace y el informe de una finca tiene dirección propia.
  const [params, setParams] = useSearchParams();
  const finca = params.get("finca") ?? "";
  const setFinca = useCallback(
    (nueva: string) => setParams(nueva ? { finca: nueva } : {}, { replace: true }),
    [setParams],
  );
  const [informeId, setInformeId] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);

  // Fincas: las dibujadas en Aerobotics y las que han entregado fruta. La misma
  // finca puede estar escrita distinto en cada sitio; se muestra la de báscula.
  const fincas = useMemo(() => {
    const vistas = new Map<string, string>();
    for (const f of fichas) for (const nombre of [f.finca, f.origen_finca_nombre]) {
      const limpio = (nombre ?? "").trim();
      if (limpio) vistas.set(normalizarTexto(limpio), limpio);
    }
    for (const e of entradas) {
      const limpio = (e.finca ?? "").trim();
      if (limpio) vistas.set(normalizarTexto(limpio), limpio);
    }
    return [...vistas.values()].sort((a, b) => a.localeCompare(b, "es"));
  }, [fichas, entradas]);

  const informesDeFinca = useMemo(
    () => informes.filter((i) => normalizarTexto(i.finca) === normalizarTexto(finca)),
    [informes, finca],
  );
  const informe = useMemo(() => informes.find((i) => i.id === informeId) ?? null, [informes, informeId]);

  const { puntos, imagenes, guardarPunto, borrarPunto, subirImagen, borrarImagen, trabajando } = useDetalleInforme(informeId);
  const armado = useInformeArmado(informe, puntos, imagenes);

  // Al cambiar de finca: si ya tiene informes, se abre el último.
  useEffect(() => {
    if (!finca) { setInformeId(null); return; }
    setInformeId((actual) => {
      const sigueValiendo = actual && informesDeFinca.some((i) => i.id === actual);
      return sigueValiendo ? actual : (informesDeFinca[0]?.id ?? null);
    });
  }, [finca, informesDeFinca]);

  const crearInforme = async () => {
    if (!finca) return;
    try {
      const id = await crear({
        finca,
        fecha_visita: hoy(),
        semana_muestreo: semanaDeHoyIso(),
        objetivo_mm: OBJETIVO_MM_DEFECTO,
        apoyo_tecnico: "Aerobotics",
      });
      setInformeId(id);
      toast.success("Informe creado. Rellena la visita y los puntos.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear el informe.");
    }
  };

  const generar = async () => {
    if (!armado) return;
    setGenerando(true);
    try {
      const nombre = await generarYEntregarInformeCampo(armado, imagenes);
      if (nombre) toast.success(`Informe generado: ${nombre}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo generar el informe.");
    } finally {
      setGenerando(false);
    }
  };

  const cargando = cargandoParcelas || cargandoEntradas || cargandoInformes;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <FileText className="h-6 w-6" /> Informe de finca
        </h1>
        <p className="text-sm text-muted-foreground">
          Eliges la finca y sale el informe técnico de campo. Aquí solo se teclea lo que nadie más sabe —la
          visita, los milímetros de cada punto y las capturas de Aeroview—; el calibre, la previsión y lo que
          la finca ha dado en almacén los pone el informe solo.
        </p>
      </div>

      {cargando ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sprout className="h-4 w-4" /> 1. La finca
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="finca">Finca</Label>
                <Select value={finca} onValueChange={setFinca}>
                  <SelectTrigger id="finca"><SelectValue placeholder="Elige una finca…" /></SelectTrigger>
                  <SelectContent className="max-h-80">
                    {fincas.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {finca && (
                <div className="flex-1 space-y-1">
                  <Label htmlFor="informe">Informe</Label>
                  <div className="flex gap-2">
                    <Select value={informeId ?? ""} onValueChange={setInformeId} disabled={informesDeFinca.length === 0}>
                      <SelectTrigger id="informe" className="flex-1">
                        <SelectValue placeholder={informesDeFinca.length === 0 ? "Todavía ninguno" : "Elige…"} />
                      </SelectTrigger>
                      <SelectContent>
                        {informesDeFinca.map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.fecha_visita ?? "sin fecha"} · {etiquetaSemana(i.semana_muestreo)}
                            {i.estado === "validado" ? " · validado" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={crearInforme} disabled={guardando} variant="secondary">
                      <Plus className="mr-1 h-4 w-4" /> Nuevo
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {informe && armado && (
            <>
              <FichaVisita informe={informe} onGuardar={(cambios) => guardar({ id: informe.id, cambios })} />

              <PuntosMuestreo
                puntos={puntos}
                semanaPorDefecto={informe.semana_muestreo}
                objetivoMm={armado.objetivoMm}
                onGuardar={guardarPunto}
                onBorrar={borrarPunto}
                trabajando={trabajando}
              />

              <Capturas
                imagenes={imagenes}
                puntos={puntos}
                parcelas={parcelasDeFinca(fichas, informe.finca)}
                onSubir={subirImagen}
                onBorrar={borrarImagen}
                trabajando={trabajando}
              />

              <LoQueSaleSolo armado={armado} />

              <Card>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    {armado.faltan.length === 0 ? (
                      <p className="text-sm text-emerald-700 dark:text-emerald-300">No falta nada: el informe sale completo.</p>
                    ) : (
                      <>
                        <p className="text-sm font-medium">Sale sin esto:</p>
                        <ul className="list-inside list-disc text-sm text-muted-foreground">
                          {armado.faltan.map((f) => <li key={f}>{f}</li>)}
                        </ul>
                      </>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => { if (window.confirm(`¿Borrar el informe de ${informe.finca}?`)) void borrar(informe.id).then(() => setInformeId(null)); }}
                    >
                      <Trash2 className="mr-1 h-4 w-4" /> Borrar
                    </Button>
                    <Button onClick={generar} disabled={generando} size="lg">
                      {generando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                      Generar informe
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {finca && !informe && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Esta finca no tiene ningún informe todavía. Dale a <span className="font-medium text-foreground">Nuevo</span> y
                se crea uno con la fecha y la semana de hoy.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── La visita ───────────────────────────────────────────────────────────────

function FichaVisita({ informe, onGuardar }: { informe: InformeCampoRow; onGuardar: (cambios: Partial<InformeCampoRow>) => Promise<unknown> }) {
  // El formulario guarda al salir del campo: nadie tiene que acordarse de un botón.
  const guardarSiCambia = (campo: keyof InformeCampoRow) => (valor: string) => {
    const limpio = valor.trim();
    const actual = informe[campo];
    const nuevo = limpio === "" ? null : campo === "objetivo_mm" ? Number(limpio) : limpio;
    if (String(actual ?? "") === String(nuevo ?? "")) return;
    void onGuardar({ [campo]: nuevo } as Partial<InformeCampoRow>);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">2. La visita</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo etiqueta="Fecha de visita" tipo="date" valor={informe.fecha_visita ?? ""} onBlur={guardarSiCambia("fecha_visita")}
          ayuda="Vacío = seguimiento sin visita." />
        <Campo etiqueta="Personal de campo" valor={informe.personal ?? ""} onBlur={guardarSiCambia("personal")}
          ayuda="Quién fue. Ej.: José María y Luis Navas." />
        <Campo etiqueta="Semana del muestreo" valor={informe.semana_muestreo ?? ""} onBlur={guardarSiCambia("semana_muestreo")}
          ayuda="Formato 2026W36." />
        <Campo etiqueta="Objetivo (mm)" tipo="number" valor={String(informe.objetivo_mm ?? "")} onBlur={guardarSiCambia("objetivo_mm")}
          ayuda="El calibre que se persigue." />
        <Campo etiqueta="Para qué" valor={informe.objetivo_nota ?? ""} onBlur={guardarSiCambia("objetivo_nota")}
          ayuda="Ej.: Cítrica, Mercadona malla 3 kg." />
        <Campo etiqueta="Apoyo técnico" valor={informe.apoyo_tecnico ?? ""} onBlur={guardarSiCambia("apoyo_tecnico")}
          ayuda="Aerobotics, salvo que sea otro." />
        <TextoLargo etiqueta="Antecedentes" valor={informe.antecedentes ?? ""} onBlur={guardarSiCambia("antecedentes")}
          ayuda="Si lo dejas vacío, el informe los escribe con lo que la finca ha entregado." />
        <TextoLargo etiqueta="Objeto y contexto" valor={informe.contexto ?? ""} onBlur={guardarSiCambia("contexto")}
          ayuda="Vacío = se escribe con la visita y los puntos." />
        <TextoLargo etiqueta="Conclusión" valor={informe.conclusion ?? ""} onBlur={guardarSiCambia("conclusion")}
          ayuda="Vacío = se escribe con los calibres y la previsión." />
      </CardContent>
    </Card>
  );
}

function Campo({ etiqueta, valor, onBlur, ayuda, tipo = "text" }: { etiqueta: string; valor: string; onBlur: (v: string) => void; ayuda?: string; tipo?: string }) {
  const [texto, setTexto] = useState(valor);
  useEffect(() => setTexto(valor), [valor]);
  return (
    <div className="space-y-1">
      <Label>{etiqueta}</Label>
      <Input type={tipo} value={texto} onChange={(e) => setTexto(e.target.value)} onBlur={() => onBlur(texto)} />
      {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

function TextoLargo({ etiqueta, valor, onBlur, ayuda }: { etiqueta: string; valor: string; onBlur: (v: string) => void; ayuda?: string }) {
  const [texto, setTexto] = useState(valor);
  useEffect(() => setTexto(valor), [valor]);
  return (
    <div className="space-y-1 sm:col-span-2 lg:col-span-1">
      <Label>{etiqueta}</Label>
      <Textarea rows={4} value={texto} onChange={(e) => setTexto(e.target.value)} onBlur={() => onBlur(texto)} placeholder="Se escribe solo si lo dejas vacío" />
      {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

// ─── Los puntos de muestreo ──────────────────────────────────────────────────

function PuntosMuestreo({ puntos, semanaPorDefecto, objetivoMm, onGuardar, onBorrar, trabajando }: {
  puntos: PuntoMuestreo[];
  semanaPorDefecto: string | null;
  objetivoMm: number;
  onGuardar: (p: Omit<PuntoMuestreo, "id"> & { id?: string }) => Promise<unknown>;
  onBorrar: (id: string) => Promise<unknown>;
  trabajando: boolean;
}) {
  const [mm, setMm] = useState("");
  const [coords, setCoords] = useState("");

  const siguiente = `P${puntos.length + 1}`;

  const anadir = async () => {
    const valor = Number(mm.replace(",", "."));
    if (!Number.isFinite(valor) || valor <= 0) { toast.error("Pon los milímetros del punto."); return; }
    // Se acepta pegar "37.66587, -5.55323" tal cual sale de Aeroview.
    const [lat, lon] = coords.split(/[,;]/).map((t) => Number(t.trim().replace(",", ".")));
    await onGuardar({
      codigo: siguiente, mm: valor,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      semana: semanaPorDefecto, nota: null, orden: puntos.length + 1,
    });
    setMm(""); setCoords("");
  };

  const media = puntos.length > 0 ? puntos.reduce((s, p) => s + p.mm, 0) / puntos.length : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4" /> 3. Los puntos de muestreo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {puntos.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Punto</TableHead>
                <TableHead className="text-right">Calibre</TableHead>
                <TableHead className="text-right">Dif. vs {objetivoMm} mm</TableHead>
                <TableHead>Coordenadas</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {puntos.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.codigo}</TableCell>
                  <TableCell className="text-right">{p.mm.toFixed(1).replace(".", ",")} mm</TableCell>
                  <TableCell className={`text-right ${p.mm >= objetivoMm ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>
                    {p.mm >= objetivoMm ? "+" : "−"}{Math.abs(p.mm - objetivoMm).toFixed(1).replace(".", ",")} mm
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.lat != null && p.lon != null ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => void onBorrar(p.id)} disabled={trabajando}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {media != null && (
                <TableRow className="bg-muted/50">
                  <TableCell className="font-semibold">MEDIA</TableCell>
                  <TableCell className="text-right font-semibold">{media.toFixed(1).replace(".", ",")} mm</TableCell>
                  <TableCell className="text-right font-semibold">
                    {media >= objetivoMm ? "+" : "−"}{Math.abs(media - objetivoMm).toFixed(1).replace(".", ",")} mm
                  </TableCell>
                  <TableCell colSpan={2} className="text-xs text-muted-foreground">Media simple de los {puntos.length} puntos</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="mm">{siguiente} · calibre (mm)</Label>
            <Input id="mm" inputMode="decimal" value={mm} onChange={(e) => setMm(e.target.value)} placeholder="61,6" className="w-32" />
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor="coords">Coordenadas</Label>
            <Input id="coords" value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="37.66587, -5.55323" />
          </div>
          <Button onClick={() => void anadir()} disabled={trabajando} variant="secondary">
            <Plus className="mr-1 h-4 w-4" /> Añadir punto
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Las coordenadas se pegan tal cual salen de Aeroview. Sin puntos el informe sale igual, pero sin la
          tabla de muestreo ni las fichas fotográficas.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Las capturas de Aeroview ────────────────────────────────────────────────

function Capturas({ imagenes, puntos, parcelas, onSubir, onBorrar, trabajando }: {
  imagenes: ImagenInforme[];
  puntos: PuntoMuestreo[];
  parcelas: CampoParcelaRow[];
  onSubir: (v: { archivo: File; tipo: ImagenInforme["tipo"]; puntoId?: string | null; pie?: string | null }) => Promise<unknown>;
  onBorrar: (img: ImagenInforme) => Promise<unknown>;
  trabajando: boolean;
}) {
  const [dibujando, setDibujando] = useState(false);
  const contorno = parcelas.flatMap((p) => p.contorno ?? []);
  const conCoordenadas = puntos.filter((p) => p.lat != null && p.lon != null);
  const sePuedeDibujar = contorno.length > 0 || conCoordenadas.length > 0;

  /**
   * El mapa lo dibuja la herramienta con el contorno de la parcela, los puntos
   * y la ortofoto del PNOA del IGN, y se guarda como una imagen más: el informe
   * no tiene que enterarse de nada, y quien prefiera su captura la sube igual.
   */
  const dibujarMapa = async () => {
    setDibujando(true);
    try {
      const mapa = await dibujarMapaParcela({
        contorno,
        puntos: conCoordenadas.map((p) => ({
          lon: p.lon!, lat: p.lat!, codigo: p.codigo,
          etiqueta: `${p.codigo} · ${p.mm.toFixed(1).replace(".", ",")} mm`,
        })),
      });
      if (!mapa) { toast.error("No hay contorno ni coordenadas con las que dibujar el mapa."); return; }
      const fondo = mapa.conOrtofoto ? " sobre la ortofoto PNOA del IGN" : " (sin ortofoto: el IGN no respondió)";
      await onSubir({
        archivo: new File([mapa.blob], `mapa-${Date.now()}.jpg`, { type: "image/jpeg" }),
        tipo: "mapa",
        pie: `Figura. Mapa de los puntos de muestreo${fondo}.`,
      });
      toast.success(mapa.conOrtofoto
        ? `Mapa dibujado con la ortofoto del IGN (${mapa.teselasCargadas} de ${mapa.teselasPedidas} teselas).`
        : "Mapa dibujado sin ortofoto: el IGN no respondió, pero el contorno y los puntos están.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo dibujar el mapa.");
    } finally {
      setDibujando(false);
    }
  };
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">4. Las capturas de Aeroview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {HUECOS.map((hueco) => (
            <Hueco
              key={hueco.tipo}
              titulo={hueco.titulo}
              ayuda={hueco.tipo === "mapa" && sePuedeDibujar
                ? "Lo dibuja la herramienta con el contorno de la parcela, los puntos y la ortofoto del IGN. O sube tu captura."
                : hueco.ayuda}
              puestas={imagenes.filter((i) => i.tipo === hueco.tipo)}
              onSubir={(archivo) => onSubir({ archivo, tipo: hueco.tipo })}
              onBorrar={onBorrar}
              trabajando={trabajando}
              accion={hueco.tipo === "mapa" && sePuedeDibujar ? (
                <Button variant="default" size="sm" className="w-full" disabled={trabajando || dibujando} onClick={() => void dibujarMapa()}>
                  {dibujando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <IconoMapa className="mr-1 h-4 w-4" />} Dibujar el mapa
                </Button>
              ) : undefined}
            />
          ))}
        </div>
        {puntos.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {puntos.map((p) => (
              <Hueco
                key={p.id}
                titulo={`Foto de ${p.codigo}`}
                ayuda={`${p.mm.toFixed(1).replace(".", ",")} mm`}
                puestas={imagenes.filter((i) => i.tipo === "punto" && i.punto_id === p.id)}
                onSubir={(archivo) => onSubir({ archivo, tipo: "punto", puntoId: p.id })}
                onBorrar={onBorrar}
                trabajando={trabajando}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Hueco({ titulo, ayuda, puestas, onSubir, onBorrar, trabajando, accion }: {
  titulo: string; ayuda: string; puestas: ImagenInforme[];
  onSubir: (archivo: File) => Promise<unknown>;
  onBorrar: (img: ImagenInforme) => Promise<unknown>;
  trabajando: boolean;
  /** Botón propio del hueco (el mapa se puede dibujar en vez de subirlo). */
  accion?: React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);

  const elegir = async (archivo: File | undefined) => {
    if (!archivo) return;
    setSubiendo(true);
    try {
      await onSubir(archivo);
      toast.success(`${titulo}: imagen guardada.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo subir la imagen.");
    } finally {
      setSubiendo(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">{titulo}</p>
      <p className="mb-2 text-xs text-muted-foreground">{ayuda}</p>
      {puestas.length === 0 ? (
        <div className="space-y-1">
          {accion}
          <Button variant="secondary" size="sm" className="w-full" disabled={trabajando || subiendo} onClick={() => input.current?.click()}>
            {subiendo ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />} Subir
          </Button>
        </div>
      ) : (
        <div className="space-y-1">
          {puestas.map((img) => (
            <div key={img.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate" title={img.file_name}>{img.file_name}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => void onBorrar(img)} disabled={trabajando}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void elegir(e.target.files?.[0])} />
    </div>
  );
}

// ─── Lo que el informe pone solo ─────────────────────────────────────────────

function LoQueSaleSolo({ armado }: { armado: NonNullable<ReturnType<typeof useInformeArmado>> }) {
  const d = armado.historial.destino;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Lo que el informe pone solo</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <p className="font-medium">Calibre de Aerobotics</p>
          {armado.ultimaMedida ? (
            <p className="text-muted-foreground">
              Última medida: <span className="font-medium text-foreground">{armado.ultimaMedida.mm.toFixed(1).replace(".", ",")} mm</span>{" "}
              en {etiquetaSemana(armado.ultimaMedida.semana).toLowerCase()}.
            </p>
          ) : <p className="text-muted-foreground">Sin medidas casadas con esta finca.</p>}
          {armado.objetivo ? (
            <p className="text-muted-foreground">
              Alcanza los {armado.objetivoMm} mm en {etiquetaSemana(armado.objetivo.semana).toLowerCase()}{" "}
              <Badge variant="outline" className="ml-1">{armado.objetivo.tipo === "medida" ? "ya medido" : "previsión"}</Badge>
            </p>
          ) : <p className="text-muted-foreground">La previsión no llega a los {armado.objetivoMm} mm en el horizonte disponible.</p>}
          {armado.avisoCurva && <p className="text-amber-700 dark:text-amber-300">{armado.avisoCurva}</p>}
        </div>
        <div className="space-y-1">
          <p className="font-medium">Lo que ha dado la finca</p>
          {armado.historial.campanas.length === 0 ? (
            <p className="text-muted-foreground">Sin entregas registradas.</p>
          ) : (
            <>
              <p className="text-muted-foreground">
                {formatKg(armado.historial.kgTotal)} en {armado.historial.campanas.length}{" "}
                {armado.historial.campanas.length === 1 ? "campaña" : "campañas"}
                {armado.ficha.hectareas ? ` · ${armado.ficha.hectareas.toFixed(1).replace(".", ",")} ha` : ""}
              </p>
              {d && d.kgCalibrados > 0 && (
                <p className="text-muted-foreground">
                  Exportación {((100 * d.exportacion) / d.kgCalibrados).toFixed(1).replace(".", ",")} % ·
                  Mercadona {((100 * d.mercadona) / d.kgCalibrados).toFixed(1).replace(".", ",")} % ·
                  Industria {((100 * d.industria) / d.kgCalibrados).toFixed(1).replace(".", ",")} %
                </p>
              )}
              {armado.historial.lotesSinCalibrador > 0 && (
                <p className="text-xs text-muted-foreground">
                  {armado.historial.lotesSinCalibrador} de {armado.historial.lotesTotal} lotes sin clasificación del calibrador.
                </p>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
