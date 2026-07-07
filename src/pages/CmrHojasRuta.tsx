// src/pages/CmrHojasRuta.tsx
// Sección "CMR y Hojas de ruta" (rol ventas): dos pestañas.
//  - Archivo: consultar el histórico ya digitalizado en el bucket privado
//    "logistics-templates" (2.859 CMR + 176 hojas de ruta) y subir documentos
//    nuevos.
//  - Generar: crear un CMR o una hoja de ruta desde formulario y descargar
//    el PDF (o descargar + archivar en el histórico).
import { useMemo, useState } from "react";
import {
  ChevronLeft, ChevronRight, Download, FileText, Loader2, Plus, Route, Save, Search, Trash2, Truck, Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  prefijoDeTipo, useCmrDocumentos, useCmrDocumentosRegistrados, useListarArchivoCmr,
  type CmrDocumentoRow, type CmrPrefijo, type CmrTipo,
} from "@/hooks/useCmrDocumentos";
import { filtrarArchivos, parseArchivoNombre, type ArchivoListado } from "@/lib/cmrArchivo";
import { cmrPdfFilename, generarCmrPdf, generarHojaRutaPdf, hojaRutaPdfFilename, pdfToBytes, type CmrDatos, type HojaRutaDatos, type HojaRutaParada } from "@/lib/cmrPdf";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, today } from "@/lib/format";

type TopTab = "archivo" | "generar";

export default function CmrHojasRuta() {
  const [tab, setTab] = useState<TopTab>("archivo");

  return (
    <div className="page-shell">
      <Tabs value={tab} onValueChange={(v) => setTab(v as TopTab)} className="space-y-4">
        <header className="page-header">
          <div>
            <p className="panel-kicker">Comercial</p>
            <h1 className="page-title">CMR y hojas de ruta</h1>
            <p className="page-subtitle">Histórico digitalizado de cartas de porte y hojas de ruta, más generación de documentos nuevos.</p>
          </div>
        </header>

        <TabsList>
          <TabsTrigger value="archivo">Archivo</TabsTrigger>
          <TabsTrigger value="generar">Generar</TabsTrigger>
        </TabsList>

        <TabsContent value="archivo" className="space-y-4">
          <ArchivoTab />
        </TabsContent>

        <TabsContent value="generar" className="space-y-4">
          <GenerarTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Pestaña Archivo ──────────────────────────────────────────────────────

function ArchivoTab() {
  const [tipo, setTipo] = useState<CmrTipo>("cmr");
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const prefijo: CmrPrefijo = prefijoDeTipo(tipo);

  const listado = useListarArchivoCmr(prefijo, search);
  const registrados = useCmrDocumentosRegistrados(tipo);

  const archivosFiltrados = useMemo(
    () => filtrarArchivos(listado.archivos as ArchivoListado[], ""),
    [listado.archivos],
  );

  const handleTipoChange = (value: string) => {
    setTipo(value as CmrTipo);
    setSearch("");
    listado.resetPage();
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    listado.resetPage();
  };

  return (
    <div className="space-y-4">
      <div className="section-toolbar flex flex-wrap items-center gap-3">
        <Select value={tipo} onValueChange={handleTipoChange}>
          <SelectTrigger className="h-10 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cmr">CMR</SelectItem>
            <SelectItem value="hoja_ruta">Hojas de ruta</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-10 pl-9"
            placeholder="Buscar por cliente, transportista, número…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        <Button className="gap-2" onClick={() => setUploadOpen(true)}>
          <Upload className="h-4 w-4" /> Subir documento
        </Button>
      </div>

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">
            {tipo === "cmr" ? "Cartas de porte (CMR)" : "Hojas de ruta"}
          </CardTitle>
          {listado.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </CardHeader>
        <CardContent className="p-0">
          {listado.isLoading ? (
            <div className="flex flex-col items-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              Cargando archivo…
            </div>
          ) : archivosFiltrados.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              <FileText className="h-8 w-8 opacity-40" />
              <p>{search ? "Sin resultados para esta búsqueda." : "No hay documentos en esta carpeta."}</p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--glass-border)]">
              {archivosFiltrados.map((archivo) => (
                <ArchivoRow
                  key={archivo.id ?? archivo.name}
                  archivo={archivo}
                  prefijo={prefijo}
                  registro={registrados.porPath.get(`${prefijo}/${archivo.name}`)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Página {listado.page + 1} · 50 documentos por página
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={listado.prevPage} disabled={listado.page === 0}>
            <ChevronLeft className="h-3.5 w-3.5" /> Anterior
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={listado.nextPage} disabled={!listado.hasMore}>
            Siguiente <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} tipoInicial={tipo} />
    </div>
  );
}

function ArchivoRow({
  archivo, registro, prefijo,
}: {
  archivo: ArchivoListado;
  registro?: CmrDocumentoRow;
  prefijo: CmrPrefijo;
}) {
  const { urlDescarga } = useCmrDocumentos();
  const [loading, setLoading] = useState(false);
  const { numero, etiqueta } = parseArchivoNombre(archivo.name);

  const handleVer = async () => {
    setLoading(true);
    try {
      // storage.list(prefijo) devuelve nombres relativos a esa carpeta: hay que
      // recomponer el path completo del bucket salvo que ya tengamos la fila de
      // cmr_documentos (que guarda el path completo).
      const url = await urlDescarga(registro?.archivo_path ?? `${prefijo}/${archivo.name}`);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({ title: "No se pudo abrir el documento", description: errorMessage(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-[var(--glass-bg-strong)]">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{etiqueta || archivo.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {numero ? <span className="tabular-nums">Nº {numero}</span> : null}
          {registro?.cliente ? <span>· {registro.cliente}</span> : null}
          {registro?.transportista ? <span>· {registro.transportista}</span> : null}
          {registro?.fecha ? <span className="tabular-nums">· {formatDate(registro.fecha)}</span> : null}
          {registro ? (
            <Badge variant="outline" className="h-4 rounded px-1.5 text-[10px]">
              {registro.origen === "generado" ? "Generado" : "Subido"}
            </Badge>
          ) : null}
        </div>
      </div>
      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handleVer} disabled={loading}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        Ver / descargar
      </Button>
    </li>
  );
}

function UploadDialog({
  open, onOpenChange, tipoInicial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tipoInicial: CmrTipo;
}) {
  const { subirDocumento } = useCmrDocumentos();
  const [tipo, setTipo] = useState<CmrTipo>(tipoInicial);
  const [file, setFile] = useState<File | null>(null);
  const [numero, setNumero] = useState("");
  const [cliente, setCliente] = useState("");
  const [transportista, setTransportista] = useState("");
  const [matricula, setMatricula] = useState("");
  const [destino, setDestino] = useState("");
  const [fecha, setFecha] = useState("");
  const [notas, setNotas] = useState("");

  const resetForm = () => {
    setFile(null);
    setNumero("");
    setCliente("");
    setTransportista("");
    setMatricula("");
    setDestino("");
    setFecha("");
    setNotas("");
  };

  const handleSubmit = async () => {
    if (!file) {
      toast({ title: "Selecciona un archivo", variant: "destructive" });
      return;
    }
    try {
      await subirDocumento.mutateAsync({
        file,
        tipo,
        metadatos: {
          numero: numero.trim() || null,
          fecha: fecha || null,
          cliente: cliente.trim() || null,
          transportista: transportista.trim() || null,
          matricula: matricula.trim() || null,
          destino: destino.trim() || null,
          notas: notas.trim() || null,
        },
      });
      toast({ title: "Documento subido", description: file.name });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Error al subir el documento", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Subir documento</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as CmrTipo)}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cmr">CMR</SelectItem>
                  <SelectItem value="hoja_ruta">Hoja de ruta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Archivo</Label>
              <Button asChild variant="outline" className="h-10 w-full cursor-pointer justify-start gap-2 text-xs">
                <label>
                  <Input
                    className="hidden"
                    type="file"
                    accept=".pdf,.xls,.xlsx,.doc,.docx"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <Upload className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{file ? file.name : "Seleccionar archivo…"}</span>
                </label>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Número</Label>
              <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="space-y-1.5">
              <Label>Fecha</Label>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="space-y-1.5">
              <Label>Transportista</Label>
              <Input value={transportista} onChange={(e) => setTransportista(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="space-y-1.5">
              <Label>Matrícula</Label>
              <Input value={matricula} onChange={(e) => setMatricula(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="space-y-1.5">
              <Label>Destino</Label>
              <Input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Opcional" className="min-h-16" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="gap-2" onClick={handleSubmit} disabled={subirDocumento.isPending}>
            {subirDocumento.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Subir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Pestaña Generar ──────────────────────────────────────────────────────

function GenerarTab() {
  const [tipo, setTipo] = useState<CmrTipo>("cmr");

  return (
    <div className="space-y-4">
      <div className="section-toolbar flex items-center gap-3">
        <Select value={tipo} onValueChange={(v) => setTipo(v as CmrTipo)}>
          <SelectTrigger className="h-10 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cmr">
              <span className="flex items-center gap-2"><Truck className="h-3.5 w-3.5" /> Carta de porte (CMR)</span>
            </SelectItem>
            <SelectItem value="hoja_ruta">
              <span className="flex items-center gap-2"><Route className="h-3.5 w-3.5" /> Hoja de ruta</span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {tipo === "cmr" ? <GenerarCmrForm /> : <GenerarHojaRutaForm />}
    </div>
  );
}

function GenerarCmrForm() {
  const { guardarGenerado } = useCmrDocumentos();
  const [datos, setDatos] = useState<CmrDatos>({
    remitente: "LASARTE SAT",
    fecha: today(),
  });
  const [busy, setBusy] = useState<"pdf" | "archivar" | null>(null);

  const set = <K extends keyof CmrDatos>(key: K, value: CmrDatos[K]) => setDatos((prev) => ({ ...prev, [key]: value }));

  const handleDescargar = async () => {
    setBusy("pdf");
    try {
      const doc = await generarCmrPdf(datos);
      doc.save(cmrPdfFilename(datos.numero));
      toast({ title: "PDF generado" });
    } catch (error) {
      toast({ title: "No se pudo generar el PDF", description: errorMessage(error), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const handleArchivar = async () => {
    setBusy("archivar");
    try {
      const doc = await generarCmrPdf(datos);
      const nombre = cmrPdfFilename(datos.numero);
      const pdfBytes = pdfToBytes(doc);
      await guardarGenerado.mutateAsync({
        tipo: "cmr",
        datos: datos as unknown as Record<string, unknown>,
        pdfBytes,
        nombre,
        metadatos: {
          numero: datos.numero ?? null,
          fecha: datos.fecha ?? null,
          cliente: datos.consignatario ?? null,
          transportista: datos.transportista ?? null,
          matricula: datos.matricula ?? null,
          destino: datos.lugarEntrega ?? null,
          notas: datos.notas ?? null,
        },
      });
      doc.save(nombre);
      toast({ title: "CMR generado y archivado", description: nombre });
    } catch (error) {
      toast({ title: "No se pudo archivar el CMR", description: errorMessage(error), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Carta de porte internacional (CMR)</CardTitle>
        <p className="text-xs text-muted-foreground">Rellena las casillas relevantes; el resto del formato se genera automáticamente.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Nº de CMR"><Input value={datos.numero ?? ""} onChange={(e) => set("numero", e.target.value)} /></Field>
          <Field label="Fecha"><Input type="date" value={datos.fecha ?? ""} onChange={(e) => set("fecha", e.target.value)} /></Field>
          <Field label="Matrícula del vehículo"><Input value={datos.matricula ?? ""} onChange={(e) => set("matricula", e.target.value)} /></Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="1. Remitente"><Textarea className="min-h-16" value={datos.remitente ?? ""} onChange={(e) => set("remitente", e.target.value)} /></Field>
          <Field label="2. Consignatario"><Textarea className="min-h-16" value={datos.consignatario ?? ""} onChange={(e) => set("consignatario", e.target.value)} /></Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="3. Lugar previsto de entrega"><Input value={datos.lugarEntrega ?? ""} onChange={(e) => set("lugarEntrega", e.target.value)} /></Field>
          <Field label="4. Lugar y fecha de carga"><Input value={datos.lugarFechaCarga ?? ""} onChange={(e) => set("lugarFechaCarga", e.target.value)} /></Field>
        </div>

        <Field label="5. Documentos anexos"><Input value={datos.documentosAnexos ?? ""} onChange={(e) => set("documentosAnexos", e.target.value)} /></Field>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="6. Marcas y números"><Input value={datos.marcasNumeros ?? ""} onChange={(e) => set("marcasNumeros", e.target.value)} /></Field>
          <Field label="7. Nº de bultos"><Input value={datos.numeroBultos ?? ""} onChange={(e) => set("numeroBultos", e.target.value)} /></Field>
          <Field label="8. Modo de embalaje"><Input value={datos.modoEmbalaje ?? ""} onChange={(e) => set("modoEmbalaje", e.target.value)} /></Field>
          <Field label="9. Naturaleza de la mercancía"><Input value={datos.naturalezaMercancia ?? ""} onChange={(e) => set("naturalezaMercancia", e.target.value)} /></Field>
        </div>

        <Field label="11. Peso bruto (kg)"><Input value={datos.pesoBrutoKg ?? ""} onChange={(e) => set("pesoBrutoKg", e.target.value)} /></Field>

        <Field label="13. Instrucciones del remitente"><Textarea className="min-h-16" value={datos.instruccionesRemitente ?? ""} onChange={(e) => set("instruccionesRemitente", e.target.value)} /></Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="16. Transportista"><Textarea className="min-h-16" value={datos.transportista ?? ""} onChange={(e) => set("transportista", e.target.value)} /></Field>
          <Field label="17. Porteadores sucesivos"><Textarea className="min-h-16" value={datos.porteadoresSucesivos ?? ""} onChange={(e) => set("porteadoresSucesivos", e.target.value)} /></Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="21. Formalizado en (lugar)"><Input value={datos.formalizadoLugar ?? ""} onChange={(e) => set("formalizadoLugar", e.target.value)} /></Field>
          <Field label="21. Formalizado el (fecha)"><Input type="date" value={datos.formalizadoFecha ?? ""} onChange={(e) => set("formalizadoFecha", e.target.value)} /></Field>
        </div>

        <Field label="Notas"><Textarea className="min-h-16" value={datos.notas ?? ""} onChange={(e) => set("notas", e.target.value)} /></Field>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="outline" className="gap-2" onClick={handleDescargar} disabled={busy !== null}>
            {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Descargar PDF
          </Button>
          <Button className="gap-2" onClick={handleArchivar} disabled={busy !== null}>
            {busy === "archivar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Descargar y archivar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

let paradaSeq = 0;
function nuevaParada(orden: number): HojaRutaParada & { key: string } {
  paradaSeq += 1;
  return { key: `p${paradaSeq}`, orden, cliente: "", destino: "", bultos: "", kg: "", observaciones: "" };
}

function GenerarHojaRutaForm() {
  const { guardarGenerado } = useCmrDocumentos();
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState(today());
  const [transportista, setTransportista] = useState("");
  const [matricula, setMatricula] = useState("");
  const [conductor, setConductor] = useState("");
  const [notas, setNotas] = useState("");
  const [paradas, setParadas] = useState<(HojaRutaParada & { key: string })[]>(() => [nuevaParada(1)]);
  const [busy, setBusy] = useState<"pdf" | "archivar" | null>(null);

  const addParada = () => setParadas((prev) => [...prev, nuevaParada(prev.length + 1)]);
  const removeParada = (key: string) =>
    setParadas((prev) => prev.filter((p) => p.key !== key).map((p, i) => ({ ...p, orden: i + 1 })));
  const updateParada = (key: string, patch: Partial<HojaRutaParada>) =>
    setParadas((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const buildDatos = (): HojaRutaDatos => ({
    numero: numero.trim() || null,
    fecha,
    transportista,
    matricula,
    conductor,
    notas,
    paradas: paradas.map(({ key: _key, ...rest }) => rest),
  });

  const handleDescargar = async () => {
    setBusy("pdf");
    try {
      const doc = await generarHojaRutaPdf(buildDatos());
      doc.save(hojaRutaPdfFilename(numero));
      toast({ title: "PDF generado" });
    } catch (error) {
      toast({ title: "No se pudo generar el PDF", description: errorMessage(error), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const handleArchivar = async () => {
    setBusy("archivar");
    try {
      const datos = buildDatos();
      const doc = await generarHojaRutaPdf(datos);
      const nombre = hojaRutaPdfFilename(numero);
      const pdfBytes = pdfToBytes(doc);
      await guardarGenerado.mutateAsync({
        tipo: "hoja_ruta",
        datos: datos as unknown as Record<string, unknown>,
        pdfBytes,
        nombre,
        metadatos: {
          numero: datos.numero,
          fecha: datos.fecha,
          transportista: datos.transportista ?? null,
          matricula: datos.matricula ?? null,
          cliente: paradas[0]?.cliente || null,
          destino: paradas[0]?.destino || null,
          notas: datos.notas ?? null,
        },
      });
      doc.save(nombre);
      toast({ title: "Hoja de ruta generada y archivada", description: nombre });
    } catch (error) {
      toast({ title: "No se pudo archivar la hoja de ruta", description: errorMessage(error), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Hoja de ruta</CardTitle>
        <p className="text-xs text-muted-foreground">Cabecera del transporte y paradas en orden de reparto.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Nº"><Input value={numero} onChange={(e) => setNumero(e.target.value)} /></Field>
          <Field label="Fecha"><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
          <Field label="Transportista"><Input value={transportista} onChange={(e) => setTransportista(e.target.value)} /></Field>
          <Field label="Matrícula"><Input value={matricula} onChange={(e) => setMatricula(e.target.value)} /></Field>
        </div>
        <Field label="Conductor"><Input value={conductor} onChange={(e) => setConductor(e.target.value)} /></Field>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Paradas</Label>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={addParada}>
              <Plus className="h-3.5 w-3.5" /> Añadir parada
            </Button>
          </div>

          <div className="space-y-2">
            {paradas.map((parada) => (
              <div key={parada.key} className="grid grid-cols-12 items-start gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5">
                <div className="col-span-1 flex h-10 items-center justify-center text-sm font-semibold tabular-nums text-muted-foreground">
                  {parada.orden}
                </div>
                <Input className="col-span-2" placeholder="Cliente" value={parada.cliente} onChange={(e) => updateParada(parada.key, { cliente: e.target.value })} />
                <Input className="col-span-3" placeholder="Destino / dirección" value={parada.destino} onChange={(e) => updateParada(parada.key, { destino: e.target.value })} />
                <Input className="col-span-1" placeholder="Bultos" value={parada.bultos} onChange={(e) => updateParada(parada.key, { bultos: e.target.value })} />
                <Input className="col-span-1" placeholder="Kg" value={parada.kg} onChange={(e) => updateParada(parada.key, { kg: e.target.value })} />
                <Input className="col-span-3" placeholder="Observaciones" value={parada.observaciones} onChange={(e) => updateParada(parada.key, { observaciones: e.target.value })} />
                <Button
                  size="icon"
                  variant="ghost"
                  className="col-span-1 h-10 w-10 text-destructive hover:text-destructive"
                  onClick={() => removeParada(parada.key)}
                  disabled={paradas.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <Field label="Notas"><Textarea className="min-h-16" value={notas} onChange={(e) => setNotas(e.target.value)} /></Field>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="outline" className="gap-2" onClick={handleDescargar} disabled={busy !== null}>
            {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Descargar PDF
          </Button>
          <Button className="gap-2" onClick={handleArchivar} disabled={busy !== null}>
            {busy === "archivar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Descargar y archivar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
