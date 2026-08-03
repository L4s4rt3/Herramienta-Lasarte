// src/pages/ImportarBandeja.tsx
// "Bandeja de importación" (/importar, solo admin): el admin suelta un montón
// de archivos mezclados y la página los clasifica (src/lib/importBandeja.ts,
// función pura ya existente, NO se toca) y los agrupa en tres zonas:
//   A. "Se importan solos": arranca automáticamente al terminar la
//      clasificación, en secuencia (ver src/components/importar/ZonaAutomatica.tsx).
//   B. "Con confirmación": una tarjeta-resumen por grupo con su botón
//      "Importar" (ver src/components/importar/Card*.tsx).
//   C. "Sin clasificar": lista de no-soportado/desconocido con su motivo.
// Cada Excel se lee UNA sola vez (src/lib/importBandejaLectura.ts) y el mismo
// grid alimenta la clasificación y el payload de cada parser.
import { useMemo, useRef, useState, type DragEvent } from "react";
import { FileQuestion, ShieldAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthProvider";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import { clasificarArchivoBandeja, type ArchivoClasificado, type TipoArchivoBandeja } from "@/lib/importBandeja";
import { leerArchivosBandeja } from "@/lib/importBandejaLectura";
import { errorMessage } from "@/lib/errorMessage";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ZonaAutomatica } from "@/components/importar/ZonaAutomatica";
import { CardVentasMensual } from "@/components/importar/CardVentasMensual";
import { CardMercadonaSemanal } from "@/components/importar/CardMercadonaSemanal";
import { CardBasculaEntradas } from "@/components/importar/CardBasculaEntradas";
import { CardStockLotes } from "@/components/importar/CardStockLotes";
import { CardMermaCamara } from "@/components/importar/CardMermaCamara";

const TIPOS_ZONA_A: TipoArchivoBandeja[] = [
  "informe-lote", "informe-produccion", "palets-campana", "camaras-externas", "informe-productor",
];
const TIPOS_ZONA_B: TipoArchivoBandeja[] = [
  "ventas-lineas", "ventas-metodos-catalogo", "ventas-metodo",
  "mercadona-semanal", "bascula-entradas", "stock-lotes", "merma-camara",
];

export default function ImportarBandeja() {
  const { role } = useAuth();

  if (role !== "admin") {
    return (
      <div className="page-shell">
        <header className="page-header">
          <div>
            <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Dirección</p>
            <h1 className="page-title">Bandeja de importación</h1>
            <p className="page-subtitle">Clasifica e importa de golpe los archivos mezclados de la campaña.</p>
          </div>
        </header>
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ShieldAlert className="h-10 w-10 text-warning" />
            <div>
              <h2 className="text-xl font-semibold">Acceso restringido</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">Solo administración puede usar la bandeja de importación.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <ImportarBandejaAdmin />;
}

function ImportarBandejaAdmin() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState<{ leidos: number; total: number } | null>(null);
  const [clasificados, setClasificados] = useState<ArchivoClasificado[] | null>(null);
  const [batchId, setBatchId] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  // true mientras la zona automática de la ÚLTIMA tanda sigue importando:
  // se bloquea la entrada de otra tanda (remontar ZonaAutomatica con imports
  // en vuelo podría solapar mutaciones de dedup).
  const [zonaAOcupada, setZonaAOcupada] = useState(false);

  // Instancia ÚNICA de useEntradasBascula (hook "pesado": pagina
  // entradas_bascula/lotes_dia completos) compartida por las 3 tarjetas que
  // la necesitan (báscula, stock, merma de cámara) en vez de suscribirla tres
  // veces — mismo espíritu que useCmvCostesMensuales en EconomicoCmv.tsx.
  const entradasBascula = useEntradasBascula();

  const bloqueado = Boolean(leyendo) || zonaAOcupada;

  const handleFiles = async (fileList: FileList | File[] | null) => {
    if (zonaAOcupada) return;
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    setClasificados(null);
    setLeyendo({ leidos: 0, total: files.length });
    try {
      const anio = new Date().getFullYear();
      const entradas = await leerArchivosBandeja(files, anio, (leidos, total) => setLeyendo({ leidos, total }));
      setClasificados(entradas.map(clasificarArchivoBandeja));
      setBatchId((n) => n + 1);
    } catch (e) {
      toast({ title: "No se pudieron leer los archivos", description: errorMessage(e), variant: "destructive" });
    } finally {
      setLeyendo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const porTipo = useMemo(() => {
    const map = new Map<TipoArchivoBandeja, ArchivoClasificado[]>();
    for (const c of clasificados ?? []) {
      const arr = map.get(c.tipo) ?? [];
      arr.push(c);
      map.set(c.tipo, arr);
    }
    return map;
  }, [clasificados]);

  const sinClasificar = useMemo(
    () => (clasificados ?? []).filter((c) => c.tipo === "no-soportado" || c.tipo === "desconocido"),
    [clasificados],
  );

  const hayZonaA = TIPOS_ZONA_A.some((t) => (porTipo.get(t)?.length ?? 0) > 0);
  const hayZonaB = TIPOS_ZONA_B.some((t) => (porTipo.get(t)?.length ?? 0) > 0);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (bloqueado) return;
    void handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Dirección</p>
          <h1 className="page-title">Bandeja de importación</h1>
          <p className="page-subtitle">
            Suelta de golpe los archivos mezclados de la campaña: se clasifican solos y se reparten entre los que se importan
            automáticamente y los que piden confirmación.
          </p>
        </div>
        <Button className="glass glass-hover gap-1.5" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={bloqueado}>
          <Upload className="h-4 w-4" /> Seleccionar archivos
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </header>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!bloqueado) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !bloqueado && fileInputRef.current?.click()}
        className={cn(
          "flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground transition-colors",
          bloqueado ? "cursor-not-allowed opacity-60" : "cursor-pointer",
          dragOver ? "border-primary/60 bg-primary/5" : "border-[var(--glass-border)] bg-[var(--glass-bg)]",
        )}
      >
        <Upload className="h-8 w-8 opacity-50" />
        {zonaAOcupada
          ? "Espera: la zona automática sigue importando la tanda anterior…"
          : "Arrastra aquí todos los archivos del día/semana/mes, o haz clic para seleccionarlos."}
      </div>

      {leyendo ? (
        <Card className="glass-accented border-info/30">
          <CardContent className="space-y-1 p-4">
            <Progress value={leyendo.total > 0 ? (leyendo.leidos / leyendo.total) * 100 : 0} />
            <p className="text-xs text-muted-foreground">Leyendo archivo {Math.min(leyendo.leidos + 1, leyendo.total)} de {leyendo.total}…</p>
          </CardContent>
        </Card>
      ) : null}

      {clasificados ? (
        <>
          <section className="space-y-2">
            <p className="panel-kicker">Se importan solos</p>
            {hayZonaA ? (
              <ZonaAutomatica key={batchId} clasificados={clasificados} onOcupadaChange={setZonaAOcupada} />
            ) : (
              <p className="text-sm text-muted-foreground">Ningún archivo de este tipo en esta tanda.</p>
            )}
          </section>

          <section className="space-y-3">
            <p className="panel-kicker">Con confirmación</p>
            {hayZonaB ? (
              <div className="space-y-3">
                <CardVentasMensual
                  key={`ventas-${batchId}`}
                  lineasArchivos={porTipo.get("ventas-lineas") ?? []}
                  catalogoArchivos={porTipo.get("ventas-metodos-catalogo") ?? []}
                  metodoArchivosClasificados={porTipo.get("ventas-metodo") ?? []}
                />
                <CardMercadonaSemanal key={`mercadona-${batchId}`} archivos={porTipo.get("mercadona-semanal") ?? []} />
                <CardBasculaEntradas key={`bascula-${batchId}`} archivos={porTipo.get("bascula-entradas") ?? []} entradasBascula={entradasBascula} />
                <CardStockLotes key={`stock-${batchId}`} archivos={porTipo.get("stock-lotes") ?? []} entradasBascula={entradasBascula} />
                <CardMermaCamara key={`merma-${batchId}`} archivos={porTipo.get("merma-camara") ?? []} entradasBascula={entradasBascula} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Ningún archivo de este tipo en esta tanda.</p>
            )}
          </section>

          <section className="space-y-2">
            <p className="panel-kicker">Sin clasificar</p>
            {sinClasificar.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todos los archivos de esta tanda se reconocieron.</p>
            ) : (
              <Card className="glass-accented overflow-hidden">
                <CardContent className="divide-y divide-[var(--glass-border)] p-0">
                  {sinClasificar.map((c, i) => (
                    <div key={`${c.fileName}-${i}`} className="flex items-start gap-2 p-3 text-sm">
                      <FileQuestion className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{c.fileName}</p>
                        <p className="text-xs text-muted-foreground">{c.motivo}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
