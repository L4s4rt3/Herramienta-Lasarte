/**
 * CamarasExternasCard — fruta físicamente en cámaras EXTERNAS (Guadex /
 * Zamexfruit), dentro de la pestaña "Stock en cámara" de /entradas.
 *
 * Esa fruta YA cuenta como stock (la báscula la registra en la fecha de
 * origen): esta carta añade el DÓNDE. El estado de cada camión se deriva en
 * cada render (src/lib/camarasExternas.ts) de señales que ya fluyen a diario
 * —pasadas de calibrador, salidas del Excel de mermas, el propio registro—
 * así que la sección se mantiene sola: importar el registro cuando la cámara
 * lo manda es lo único manual.
 */
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { Loader2, Snowflake, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { useCamarasExternas } from "@/hooks/useCamarasExternas";
import { agregarCamaraExterna, kgEnCamaraDeEstado, parseRegistroCamaraExternaRows, type SenalesRecepcion } from "@/lib/camarasExternas";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKgCompact as formatKg, today } from "@/lib/format";

interface Props {
  senales: SenalesRecepcion;
}

export function CamarasExternasCard({ senales }: Props) {
  const { camiones, isLoading, importar } = useCamarasExternas();
  const inputRef = useRef<HTMLInputElement>(null);
  const [importando, setImportando] = useState(false);

  const agregado = useMemo(() => agregarCamaraExterna(camiones, senales, today()), [camiones, senales]);

  const handleImportar = async (file: File | null) => {
    if (!file) return;
    setImportando(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      // El registro de Guadex trae la hoja "Entradas total" (Stock es una
      // vista parcial del mismo dato); si no existe, vale la primera hoja.
      const sheetName = wb.SheetNames.find((n) => n.toLowerCase().includes("entradas")) ?? wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null }) as unknown[][];
      const { registros, procedencia, descartadas } = parseRegistroCamaraExternaRows(rows);
      if (registros.length === 0) {
        toast({ title: "Archivo no reconocido", description: "No parece un registro de cámara externa (S/Ref / Nt/Ref / Kg.).", variant: "destructive" });
        return;
      }
      const { importados } = await importar.mutateAsync(registros);
      toast({
        title: `Registro de ${procedencia ?? "cámara externa"} importado`,
        description: `${importados} camión(es) (reimportar actualiza, no duplica)${descartadas.length ? `, ${descartadas.length} fila(s) descartada(s)` : ""}.`,
      });
    } catch (e) {
      toast({ title: "No se pudo importar", description: errorMessage(e), variant: "destructive" });
    } finally {
      setImportando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (isLoading) return null;

  return (
    <Card className="glass-accented">
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-7 w-1 shrink-0 rounded-full bg-info" />
            <div>
              <p className="panel-kicker">Cámaras externas</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Fruta ya comprada (cuenta en el stock) que sigue físicamente en la cámara del proveedor.
                El estado se actualiza solo con los partes diarios y el Excel de mermas.
              </p>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => handleImportar(e.target.files?.[0] ?? null)}
          />
          <Button variant="outline" size="sm" disabled={importando} onClick={() => inputRef.current?.click()}>
            {importando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            Importar registro de cámara
          </Button>
        </div>

        {camiones.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Sin registros todavía. Importa el Excel que lleva la cámara (p. ej. "Registro_Control_Guadex" o "Control entradas"):
            una fila por camión con su S/Ref y su Nt/Ref (el lote de báscula).
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                <Snowflake className="h-3.5 w-3.5 text-info" />
                {formatKg(agregado.kgEnCamara)} en cámara externa · {agregado.enCamara.length} camión(es)
              </span>
              {agregado.porProcedencia.map((p) => (
                <span key={p.procedencia} className="tabular-nums text-muted-foreground">
                  {p.procedencia}: {formatKg(p.kg)} ({p.camiones})
                </span>
              ))}
              {agregado.kgEnCamara > 0 && (
                <span className="tabular-nums text-muted-foreground">
                  merma esperada ≈ {formatKg(Math.round(agregado.mermaEsperadaKg))}
                  {agregado.diasMediosPonderados != null && ` · ${Math.round(agregado.diasMediosPonderados)} días de media`}
                </span>
              )}
              <span className="tabular-nums text-muted-foreground">{agregado.recibidos} ya recibidos</span>
            </div>

            {agregado.ventasDirectas.length > 0 && (
              <p className="text-[11px] text-warning">
                {agregado.ventasDirectas.length} camión(es) con venta directa según el registro (
                {agregado.ventasDirectas.map((v) => v.camion.lote ?? v.camion.s_ref).join(", ")}
                ): no llegarán a la central — si su lote sigue activo, ciérralo como "sin registro" para que no cuente como merma.
              </p>
            )}

            {agregado.enCamara.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-[var(--glass-border)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cámara</TableHead>
                      <TableHead>S/Ref</TableHead>
                      <TableHead>Lote</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead>Finca</TableHead>
                      <TableHead>Variedad</TableHead>
                      <TableHead className="whitespace-nowrap">Almacenado</TableHead>
                      <TableHead className="text-right">Días</TableHead>
                      <TableHead className="text-right">Kg</TableHead>
                      <TableHead className="whitespace-nowrap text-right">Merma esp.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agregado.enCamara.map(({ camion, estado }) => {
                      const enCam = estado.estado === "en_camara" || estado.estado === "parcial" ? estado : null;
                      return (
                        <TableRow key={`${camion.procedencia}::${camion.s_ref}`}>
                          <TableCell>
                            <Badge variant="outline" className="border-info/40 bg-info/10 text-[10px] text-info">{camion.procedencia}</Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {camion.s_ref}
                            {estado.estado === "parcial" && (
                              <Badge variant="outline" className="ml-1.5 border-warning/40 bg-warning/10 text-[10px] text-warning">
                                parcial {estado.envasesRecibidos}/{estado.envasesTotal} env.
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-medium">
                            {camion.lote ? (
                              <Link
                                to={`/trazabilidad?lote=${encodeURIComponent(camion.lote)}`}
                                className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                              >
                                {camion.lote}
                              </Link>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="max-w-[140px] truncate">{camion.proveedor ?? "—"}</TableCell>
                          <TableCell className="max-w-[140px] truncate text-muted-foreground">{camion.finca ?? "—"}</TableCell>
                          <TableCell className="max-w-[120px] truncate text-muted-foreground">{camion.variedad ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(camion.fecha_almacenamiento)}</TableCell>
                          <TableCell className={`text-right tabular-nums ${enCam && enCam.dias > 60 ? "font-semibold text-warning" : ""}`}>
                            {enCam ? enCam.dias : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {formatKg(Math.round(kgEnCamaraDeEstado(camion, estado)))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {enCam ? formatKg(Math.round(enCam.mermaEsperadaKg)) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={8}>Total en cámara externa ({agregado.enCamara.length})</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKg(agregado.kgEnCamara)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKg(Math.round(agregado.mermaEsperadaKg))}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
