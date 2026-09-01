// Stock de consumibles, pensado para el móvil del almacén: buscar un artículo,
// tocar su tarjeta y teclear el recuento nuevo (dos gestos, sin formularios).
// Nace del inventario del 01-09-2026: el conteo en papel que había que pasar a
// un Excel dos veces al año pasa a mantenerse aquí en el día a día. Cada cambio
// de stock queda en el historial (trigger en la base), la lista se imprime en
// PDF con la marca y cada artículo tiene su CARTEL A4 para pegar en la
// estantería ("Stiker MI PRIMA LA FEA — 327.000 uds").
//
// Los paneles de edición son Dialog (Radix), NO Drawer (vaul): el drawer
// arrastrable se cerraba solo en el móvil al abrirse el teclado (su gesto de
// arrastre confunde el cambio de viewport con un "cerrar"), que era
// exactamente el momento de teclear el recuento. El diálogo va anclado ARRIBA
// en pantallas pequeñas para que el teclado nunca lo tape.
import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  History,
  Loader2,
  Plus,
  Printer,
  Search,
  Tags,
  TriangleAlert,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import {
  useStockConsumibles,
  useStockConsumiblesMutations,
  useStockHistorial,
} from "@/hooks/useStockConsumibles";
import {
  esPendiente,
  formatEuros,
  formatStock,
  normalizarTexto,
  ordenFamilia,
  valorItem,
  type StockConsumible,
} from "@/lib/stockConsumibles";
import { generarCartelesPdf, generarListaStockPdf } from "@/lib/stockConsumiblesPdf";
import { cn } from "@/lib/utils";

/** Clases del diálogo en móvil: pegado arriba (el teclado sale por abajo y no
 * lo tapa) y con scroll interno; en pantallas grandes, centrado normal. */
const DIALOGO_MOVIL =
  "top-3 translate-y-0 sm:top-1/2 sm:-translate-y-1/2 w-[calc(100vw-1.25rem)] sm:w-full max-h-[88dvh] overflow-y-auto rounded-2xl p-4 sm:p-6";

function fechaCorta(iso: string): string {
  const fecha = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(fecha.getDate())}/${pad(fecha.getMonth() + 1)} ${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
}

export default function StockConsumibles() {
  const { role } = useAuth();
  const esAdmin = role === "admin";
  const { data: items, isLoading } = useStockConsumibles();
  const { actualizar, crear } = useStockConsumiblesMutations();

  const [filtro, setFiltro] = useState("");
  const [familiaActiva, setFamiliaActiva] = useState<string | null>(null);
  const [soloConStock, setSoloConStock] = useState(false);
  const [editando, setEditando] = useState<StockConsumible | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [modoCarteles, setModoCarteles] = useState(false);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [generando, setGenerando] = useState(false);

  const activos = useMemo(() => (items ?? []).filter((item) => item.activo), [items]);

  const familias = useMemo(() => {
    const presentes = [...new Set(activos.map((item) => item.familia))];
    return presentes.sort((a, b) => ordenFamilia(a) - ordenFamilia(b) || a.localeCompare(b, "es"));
  }, [activos]);

  const filtrados = useMemo(() => {
    const texto = normalizarTexto(filtro.trim());
    return activos
      .filter((item) => {
        if (familiaActiva && item.familia !== familiaActiva) return false;
        if (soloConStock && item.stock <= 0) return false;
        if (texto && !normalizarTexto(`${item.nombre} ${item.familia} ${item.nota ?? ""}`).includes(texto)) return false;
        return true;
      })
      .sort(
        (a, b) =>
          ordenFamilia(a.familia) - ordenFamilia(b.familia) ||
          a.familia.localeCompare(b.familia, "es") ||
          a.nombre.localeCompare(b.nombre, "es"),
      );
  }, [activos, filtro, familiaActiva, soloConStock]);

  const grupos = useMemo(() => {
    const porFamilia = new Map<string, StockConsumible[]>();
    for (const item of filtrados) {
      const lista = porFamilia.get(item.familia) ?? [];
      lista.push(item);
      porFamilia.set(item.familia, lista);
    }
    return [...porFamilia.entries()];
  }, [filtrados]);

  const pendientes = useMemo(() => activos.filter(esPendiente).length, [activos]);
  const valorTotal = useMemo(() => activos.reduce((suma, item) => suma + (valorItem(item) ?? 0), 0), [activos]);
  const sinPrecio = useMemo(() => activos.filter((item) => item.precio_unitario === null).length, [activos]);

  const imprimirLista = async () => {
    setGenerando(true);
    try {
      const nombre = await generarListaStockPdf(filtrados, { conValor: esAdmin });
      if (nombre) toast({ title: "Lista generada", description: nombre });
    } catch (error) {
      toast({
        title: "No se pudo generar el PDF",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setGenerando(false);
    }
  };

  const imprimirCarteles = async (elegidos: StockConsumible[]) => {
    if (elegidos.length === 0) return;
    setGenerando(true);
    try {
      const nombre = await generarCartelesPdf(elegidos);
      if (nombre) {
        toast({ title: `${elegidos.length === 1 ? "Cartel generado" : `${elegidos.length} carteles generados`}`, description: nombre });
        setModoCarteles(false);
        setSeleccion(new Set());
      }
    } catch (error) {
      toast({
        title: "No se pudo generar el PDF",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setGenerando(false);
    }
  };

  const alternarSeleccion = (id: string) => {
    setSeleccion((antes) => {
      const ahora = new Set(antes);
      if (ahora.has(id)) ahora.delete(id);
      else ahora.add(id);
      return ahora;
    });
  };

  return (
    <div className={cn("mx-auto w-full max-w-3xl space-y-4 p-3 sm:p-6", modoCarteles && "pb-28")}>
      {/* Acciones principales, a tamaño de pulgar */}
      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="outline"
          onClick={() => void imprimirLista()}
          disabled={generando || filtrados.length === 0}
          className="h-12 rounded-2xl text-sm font-semibold"
        >
          {generando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Printer className="mr-1.5 h-4 w-4" />}
          Lista PDF
        </Button>
        <Button
          variant={modoCarteles ? "default" : "outline"}
          onClick={() => {
            setModoCarteles((antes) => !antes);
            setSeleccion(new Set());
          }}
          disabled={generando}
          className="h-12 rounded-2xl text-sm font-semibold"
        >
          <Tags className="mr-1.5 h-4 w-4" />
          Carteles
        </Button>
        <Button onClick={() => setNuevoAbierto(true)} className="h-12 rounded-2xl text-sm font-semibold">
          <Plus className="mr-1.5 h-4 w-4" />
          Añadir
        </Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filtro}
          onChange={(evento) => setFiltro(evento.target.value)}
          placeholder="Buscar artículo, familia o nota..."
          autoComplete="off"
          className="h-11 rounded-xl pl-9 text-base"
        />
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setFamiliaActiva(null)}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            familiaActiva === null
              ? "border-primary bg-primary text-primary-foreground"
              : "border-primary/25 bg-primary/5 text-foreground",
          )}
        >
          Todas
        </button>
        {familias.map((familia) => (
          <button
            key={familia}
            type="button"
            onClick={() => setFamiliaActiva((antes) => (antes === familia ? null : familia))}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              familiaActiva === familia
                ? "border-primary bg-primary text-primary-foreground"
                : "border-primary/25 bg-primary/5 text-foreground",
            )}
          >
            {familia}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Switch id="solo-con-stock" checked={soloConStock} onCheckedChange={setSoloConStock} />
          <Label htmlFor="solo-con-stock" className="text-sm text-muted-foreground">
            Solo con stock
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">
          {filtrados.length} de {activos.length}
          {pendientes > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-warning">
              <TriangleAlert className="h-3.5 w-3.5" />
              {pendientes} por confirmar
            </span>
          )}
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <Skeleton key={n} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && filtrados.length === 0 && (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Boxes className="h-8 w-8" />
            <p className="text-sm">
              {filtro || familiaActiva || soloConStock
                ? "Ningún consumible coincide con el filtro."
                : "Todavía no hay consumibles. Añade el primero con el botón de arriba."}
            </p>
          </CardContent>
        </Card>
      )}

      {grupos.map(([familia, lista]) => (
        <div key={familia} className="space-y-2">
          <h2 className="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {familia}
          </h2>
          {lista.map((item) => {
            const pendiente = esPendiente(item);
            return (
              <Card
                key={item.id}
                className={cn(
                  "cursor-pointer rounded-2xl transition-colors hover:border-primary/40",
                  modoCarteles && seleccion.has(item.id) && "border-primary bg-primary/5",
                )}
                onClick={() => (modoCarteles ? alternarSeleccion(item.id) : setEditando(item))}
              >
                <CardContent className="flex items-center gap-3 p-3.5">
                  {modoCarteles && (
                    <Checkbox
                      checked={seleccion.has(item.id)}
                      onCheckedChange={() => alternarSeleccion(item.id)}
                      onClick={(evento) => evento.stopPropagation()}
                      className="h-5 w-5 shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{item.nombre}</span>
                      {item.almacen === "exterior" && (
                        <Badge variant="outline" className="border-primary/40 bg-primary/10 text-[10px] text-primary">
                          exterior
                        </Badge>
                      )}
                    </div>
                    {item.nota && (
                      <p className={cn("truncate text-xs", pendiente ? "text-warning" : "text-muted-foreground")}>
                        {pendiente && <TriangleAlert className="mr-1 inline h-3 w-3" />}
                        {item.nota}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn("text-lg font-bold tabular-nums", item.stock === 0 && "text-muted-foreground")}>
                      {formatStock(item.stock)}
                    </p>
                    <p className="text-xs text-muted-foreground">{item.unidad}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ))}

      {esAdmin && !isLoading && activos.length > 0 && (
        <Card className="rounded-2xl">
          <CardContent className="flex items-center justify-between p-4 text-sm">
            <span className="text-muted-foreground">
              Valor del inventario
              {sinPrecio > 0 && <span className="block text-xs">({sinPrecio} artículos sin precio, no sumados)</span>}
            </span>
            <span className="text-lg font-bold tabular-nums">{formatEuros(valorTotal)}</span>
          </CardContent>
        </Card>
      )}

      {/* Barra de carteles: fija abajo mientras se eligen artículos */}
      {modoCarteles && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-xl"
              onClick={() => {
                setModoCarteles(false);
                setSeleccion(new Set());
              }}
            >
              <X className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              className="h-11 rounded-xl text-sm"
              onClick={() => setSeleccion(new Set(filtrados.map((item) => item.id)))}
            >
              Todos ({filtrados.length})
            </Button>
            <Button
              className="h-11 flex-1 rounded-xl text-sm font-semibold"
              disabled={seleccion.size === 0 || generando}
              onClick={() => void imprimirCarteles(filtrados.filter((item) => seleccion.has(item.id)))}
            >
              {generando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
              Imprimir {seleccion.size > 0 ? `${seleccion.size} ` : ""}cartel{seleccion.size === 1 ? "" : "es"}
            </Button>
          </div>
        </div>
      )}

      <EditarDialog
        item={editando}
        esAdmin={esAdmin}
        guardando={actualizar.isPending}
        generandoCartel={generando}
        onCerrar={() => setEditando(null)}
        onGuardar={async (cambios) => {
          if (!editando) return;
          await actualizar.mutateAsync({ id: editando.id, cambios });
          toast({ title: "Guardado", description: editando.nombre });
          setEditando(null);
        }}
        onCartel={(item) => void imprimirCarteles([item])}
      />

      <NuevoDialog
        abierto={nuevoAbierto}
        familias={familias}
        esAdmin={esAdmin}
        guardando={crear.isPending}
        onCerrar={() => setNuevoAbierto(false)}
        onCrear={async (fila) => {
          await crear.mutateAsync(fila);
          toast({ title: "Artículo añadido", description: fila.nombre });
          setNuevoAbierto(false);
        }}
      />
    </div>
  );
}

// ─── Editar un artículo: el gesto central del módulo ─────────────────────────

function EditarDialog(props: {
  item: StockConsumible | null;
  esAdmin: boolean;
  guardando: boolean;
  generandoCartel: boolean;
  onCerrar: () => void;
  onGuardar: (cambios: {
    stock: number;
    nota: string | null;
    precio_unitario?: number | null;
    activo?: boolean;
  }) => Promise<void>;
  onCartel: (item: StockConsumible) => void;
}) {
  const { item, esAdmin } = props;
  const [stockTexto, setStockTexto] = useState("");
  const [notaTexto, setNotaTexto] = useState("");
  const [precioTexto, setPrecioTexto] = useState("");
  const [verHistorial, setVerHistorial] = useState(false);
  const { data: historial } = useStockHistorial(verHistorial && item ? item.id : null);

  useEffect(() => {
    if (!item) return;
    setStockTexto(String(item.stock));
    setNotaTexto(item.nota ?? "");
    setPrecioTexto(item.precio_unitario === null ? "" : String(item.precio_unitario));
    setVerHistorial(false);
  }, [item]);

  const guardar = async () => {
    if (!item) return;
    const stock = Number(stockTexto.replace(",", "."));
    if (!Number.isFinite(stock) || stock < 0) {
      toast({ title: "Stock no válido", description: "Escribe un número igual o mayor que 0.", variant: "destructive" });
      return;
    }
    const cambios: Parameters<typeof props.onGuardar>[0] = {
      stock,
      nota: notaTexto.trim() === "" ? null : notaTexto.trim(),
    };
    if (esAdmin) {
      const precio = precioTexto.trim() === "" ? null : Number(precioTexto.replace(",", "."));
      if (precio !== null && !Number.isFinite(precio)) {
        toast({ title: "Precio no válido", variant: "destructive" });
        return;
      }
      cambios.precio_unitario = precio;
    }
    await props.onGuardar(cambios);
  };

  return (
    <Dialog open={item !== null} onOpenChange={(abierto) => !abierto && props.onCerrar()}>
      <DialogContent className={DIALOGO_MOVIL}>
        {item && (
          <div className="space-y-3">
            <DialogHeader className="space-y-1 pr-6 text-left">
              <DialogTitle className="text-base leading-snug">{item.nombre}</DialogTitle>
              <DialogDescription>
                {item.familia}
                {item.almacen === "exterior" ? " · almacén exterior" : ""} · ahora {formatStock(item.stock)} {item.unidad}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="stock-nuevo" className="text-sm">
                Recuento actual ({item.unidad})
              </Label>
              <Input
                id="stock-nuevo"
                value={stockTexto}
                onChange={(evento) => setStockTexto(evento.target.value)}
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                onFocus={(evento) => evento.target.select()}
                onKeyDown={(evento) => {
                  if (evento.key === "Enter") void guardar();
                }}
                className="h-14 rounded-xl text-center text-2xl font-bold tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nota" className="text-sm">
                Nota (avisos, "falta precio", pedidos en camino...)
              </Label>
              <Textarea
                id="nota"
                value={notaTexto}
                onChange={(evento) => setNotaTexto(evento.target.value)}
                rows={2}
                className="rounded-xl text-sm"
              />
            </div>
            {esAdmin && (
              <div className="space-y-1.5">
                <Label htmlFor="precio" className="text-sm">
                  Precio (€/{item.unidad}) — solo admin
                </Label>
                <Input
                  id="precio"
                  value={precioTexto}
                  onChange={(evento) => setPrecioTexto(evento.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="Sin precio"
                  className="h-11 rounded-xl text-base tabular-nums"
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => setVerHistorial((antes) => !antes)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-2 hover:underline"
            >
              <History className="h-4 w-4" />
              {verHistorial ? "Ocultar historial" : "Ver historial de cambios"}
            </button>
            {verHistorial && (
              <div className="space-y-1 rounded-xl border p-3 text-sm">
                {(historial ?? []).length === 0 && <p className="text-muted-foreground">Sin cambios registrados aún.</p>}
                {(historial ?? []).map((cambio) => (
                  <p key={cambio.id} className="flex justify-between gap-2 tabular-nums">
                    <span className="text-muted-foreground">{fechaCorta(cambio.created_at)}</span>
                    <span>
                      {cambio.stock_anterior === null ? "—" : formatStock(Number(cambio.stock_anterior))} →{" "}
                      <strong>{formatStock(Number(cambio.stock_nuevo))}</strong>
                    </span>
                  </p>
                ))}
              </div>
            )}

            <div className="space-y-2 pt-1">
              <Button
                onClick={() => void guardar()}
                disabled={props.guardando}
                className="h-12 w-full rounded-xl text-base font-semibold"
              >
                {props.guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar recuento
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => props.onCartel(item)}
                  disabled={props.generandoCartel}
                  className="h-11 rounded-xl text-sm"
                >
                  <Tags className="mr-1.5 h-4 w-4" />
                  Cartel A4
                </Button>
                {esAdmin ? (
                  <Button
                    variant="outline"
                    className="h-11 rounded-xl text-sm text-destructive hover:text-destructive"
                    disabled={props.guardando}
                    onClick={() =>
                      void props.onGuardar({
                        stock: item.stock,
                        nota: item.nota,
                        activo: false,
                      })
                    }
                  >
                    Dar de baja
                  </Button>
                ) : (
                  <Button variant="outline" onClick={props.onCerrar} className="h-11 rounded-xl text-sm">
                    Cancelar
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Alta de un artículo nuevo ────────────────────────────────────────────────

function NuevoDialog(props: {
  abierto: boolean;
  familias: string[];
  esAdmin: boolean;
  guardando: boolean;
  onCerrar: () => void;
  onCrear: (fila: {
    nombre: string;
    familia: string;
    unidad: string;
    stock: number;
    precio_unitario: number | null;
    almacen: string;
    nota: string | null;
  }) => Promise<void>;
}) {
  const [nombre, setNombre] = useState("");
  const [familia, setFamilia] = useState("");
  const [unidad, setUnidad] = useState("uds");
  const [stockTexto, setStockTexto] = useState("0");
  const [precioTexto, setPrecioTexto] = useState("");
  const [almacen, setAlmacen] = useState("central");

  useEffect(() => {
    if (!props.abierto) return;
    setNombre("");
    setFamilia("");
    setUnidad("uds");
    setStockTexto("0");
    setPrecioTexto("");
    setAlmacen("central");
  }, [props.abierto]);

  const crear = async () => {
    const stock = Number(stockTexto.replace(",", "."));
    if (nombre.trim() === "" || familia === "") {
      toast({ title: "Faltan datos", description: "El artículo necesita nombre y familia.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(stock) || stock < 0) {
      toast({ title: "Stock no válido", variant: "destructive" });
      return;
    }
    const precio = precioTexto.trim() === "" ? null : Number(precioTexto.replace(",", "."));
    await props.onCrear({
      nombre: nombre.trim(),
      familia,
      unidad: unidad.trim() === "" ? "uds" : unidad.trim(),
      stock,
      precio_unitario: precio !== null && Number.isFinite(precio) ? precio : null,
      almacen,
      nota: precio === null ? "Falta precio." : null,
    });
  };

  return (
    <Dialog open={props.abierto} onOpenChange={(abierto) => !abierto && props.onCerrar()}>
      <DialogContent className={DIALOGO_MOVIL}>
        <div className="space-y-3">
          <DialogHeader className="space-y-1 pr-6 text-left">
            <DialogTitle>Añadir consumible</DialogTitle>
            <DialogDescription>Un artículo nuevo del catálogo de consumibles.</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label className="text-sm">Nombre</Label>
            <Input
              value={nombre}
              onChange={(evento) => setNombre(evento.target.value)}
              placeholder='p. ej. "Caja cartón 15 Kg. MPF"'
              autoComplete="off"
              className="h-11 rounded-xl text-base"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Familia</Label>
              <Select value={familia} onValueChange={setFamilia}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue placeholder="Elegir..." />
                </SelectTrigger>
                <SelectContent>
                  {props.familias.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Unidad</Label>
              <Input
                value={unidad}
                onChange={(evento) => setUnidad(evento.target.value)}
                placeholder="uds, kg, L, m..."
                autoComplete="off"
                className="h-11 rounded-xl text-base"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Recuento actual</Label>
              <Input
                value={stockTexto}
                onChange={(evento) => setStockTexto(evento.target.value)}
                inputMode="decimal"
                autoComplete="off"
                className="h-11 rounded-xl text-base tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Almacén</Label>
              <Select value={almacen} onValueChange={setAlmacen}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="central">Central</SelectItem>
                  <SelectItem value="exterior">Exterior</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {props.esAdmin && (
            <div className="space-y-1.5">
              <Label className="text-sm">Precio (€/unidad) — solo admin</Label>
              <Input
                value={precioTexto}
                onChange={(evento) => setPrecioTexto(evento.target.value)}
                inputMode="decimal"
                autoComplete="off"
                placeholder="Sin precio (se marcará en la nota)"
                className="h-11 rounded-xl text-base tabular-nums"
              />
            </div>
          )}

          <div className="space-y-2 pt-1">
            <Button
              onClick={() => void crear()}
              disabled={props.guardando}
              className="h-12 w-full rounded-xl text-base font-semibold"
            >
              {props.guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Añadir artículo
            </Button>
            <Button variant="outline" onClick={props.onCerrar} className="h-11 w-full rounded-xl text-sm">
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
