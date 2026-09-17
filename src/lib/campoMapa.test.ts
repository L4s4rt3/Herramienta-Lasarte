import { describe, expect, it } from "vitest";
import {
  aPixel, barraDeEscala, colocarEtiquetas, contornoEnPixeles, encuadrar, latAPixel, lonAPixel,
  MAX_TESELAS, metrosPorPixel, urlTeselaPnoa, verticesDeContorno, ZOOM_MAX,
} from "./campoMapa";

// La finca Ganchal, con el contorno alrededor de los cinco puntos del informe.
const PUNTOS = [
  { codigo: "P1", etiqueta: "P1 · 61,6 mm", lon: -5.55323, lat: 37.66587 },
  { codigo: "P2", etiqueta: "P2 · 60,9 mm", lon: -5.55311, lat: 37.66568 },
  { codigo: "P3", etiqueta: "P3 · 58,3 mm", lon: -5.55322, lat: 37.66505 },
  { codigo: "P4", etiqueta: "P4 · 58,3 mm", lon: -5.55330, lat: 37.66333 },
  { codigo: "P5", etiqueta: "P5 · 59,6 mm", lon: -5.55188, lat: 37.66305 },
];
const CONTORNO: Array<Array<[number, number]>> = [[
  [-5.5545, 37.6665], [-5.5510, 37.6665], [-5.5510, 37.6625], [-5.5545, 37.6625], [-5.5545, 37.6665],
]];

/** El contorno de verdad de Ganchal, tal y como está en campo_parcelas. */
const CONTORNO_GANCHAL: Array<Array<[number, number]>> = [[
  [-5.555689, 37.664723], [-5.554758, 37.665343], [-5.553372, 37.665683], [-5.553166, 37.666275],
  [-5.554813, 37.66706], [-5.554852, 37.668674], [-5.553195, 37.668719], [-5.552656, 37.668186],
  [-5.552955, 37.667309], [-5.552335, 37.666664], [-5.552338, 37.666237], [-5.551446, 37.665675],
  [-5.550691, 37.664489], [-5.550675, 37.662879], [-5.554312, 37.662929], [-5.555689, 37.664723],
]];

describe("proyección", () => {
  it("el meridiano de Greenwich cae en el centro del mundo", () => {
    expect(lonAPixel(0, 0)).toBeCloseTo(128, 6);
    expect(lonAPixel(-180, 0)).toBeCloseTo(0, 6);
    expect(lonAPixel(180, 0)).toBeCloseTo(256, 6);
  });

  it("el ecuador cae en la mitad vertical y el norte queda arriba", () => {
    expect(latAPixel(0, 0)).toBeCloseTo(128, 6);
    expect(latAPixel(45, 0)).toBeLessThan(128);
    expect(latAPixel(-45, 0)).toBeGreaterThan(128);
  });

  it("cada zoom duplica el tamaño del mundo", () => {
    expect(lonAPixel(-5.55, 11) / lonAPixel(-5.55, 10)).toBeCloseTo(2, 6);
  });
});

describe("encuadre", () => {
  it("mete la parcela entera y todos los puntos dentro de la imagen", () => {
    const geo = [...verticesDeContorno(CONTORNO), ...PUNTOS];
    const e = encuadrar(geo, { ancho: 1000, alto: 700 })!;
    expect(e).not.toBeNull();
    for (const p of geo) {
      const px = aPixel(p, e);
      expect(px.x).toBeGreaterThanOrEqual(0);
      expect(px.x).toBeLessThanOrEqual(e.ancho);
      expect(px.y).toBeGreaterThanOrEqual(0);
      expect(px.y).toBeLessThanOrEqual(e.alto);
    }
  });

  it("un punto medido fuera del contorno dibujado NO se queda fuera del papel", () => {
    // Aerobotics a veces solo tiene dibujado un trozo de lo que la báscula
    // llama esa parcela: el punto de más lejos tiene que verse igual.
    const lejos = { codigo: "P9", etiqueta: "P9", lon: -5.5600, lat: 37.6600 };
    const e = encuadrar([...verticesDeContorno(CONTORNO), lejos], { ancho: 1000, alto: 700 })!;
    const px = aPixel(lejos, e);
    expect(px.x).toBeGreaterThanOrEqual(0);
    expect(px.x).toBeLessThanOrEqual(e.ancho);
  });

  it("nunca pide más teselas de la cuenta a un servicio público", () => {
    const e = encuadrar(verticesDeContorno(CONTORNO), { ancho: 1000, alto: 700 })!;
    expect(e.teselas.length).toBeGreaterThan(0);
    expect(e.teselas.length).toBeLessThanOrEqual(MAX_TESELAS);
    // Una finca enorme baja el zoom en vez de disparar el número de teselas.
    const enorme: Array<Array<[number, number]>> = [[[-6.2, 38.2], [-5.2, 38.2], [-5.2, 37.2], [-6.2, 37.2], [-6.2, 38.2]]];
    const e2 = encuadrar(verticesDeContorno(enorme), { ancho: 1000, alto: 700 })!;
    expect(e2.teselas.length).toBeLessThanOrEqual(MAX_TESELAS);
    expect(e2.zoom).toBeLessThan(e.zoom);
  });

  it("una parcela pequeña se dibuja al máximo detalle disponible", () => {
    // Un puñado de árboles (unos 40 m): cabe de sobra al zoom más cercano.
    const juntos = PUNTOS.map((p, i) => ({ ...p, lat: 37.6650 + i * 0.0001 }));
    expect(encuadrar(juntos, { ancho: 1000, alto: 700 })!.zoom).toBe(ZOOM_MAX);
  });

  it("una parcela larga se aleja lo justo para que quepa de norte a sur", () => {
    // Los cinco puntos de Ganchal ocupan unos 310 m: a 19 no caben en 700 px de
    // alto y el encuadre baja solo hasta que caben, sin recortar nada.
    const e = encuadrar(PUNTOS, { ancho: 1000, alto: 700 })!;
    expect(e.zoom).toBeLessThan(ZOOM_MAX);
    for (const p of PUNTOS) {
      const px = aPixel(p, e);
      expect(px.y).toBeGreaterThanOrEqual(0);
      expect(px.y).toBeLessThanOrEqual(e.alto);
    }
  });

  it("la imagen toma la forma de la parcela en vez de sobrarle medio término", () => {
    // Ganchal es alta y estrecha: con una caja apaisada fija había que alejarse
    // tanto que se veía el pueblo entero y la finca quedaba perdida en el medio.
    const geo = verticesDeContorno(CONTORNO_GANCHAL);
    const libre = encuadrar(geo)!;
    const fijo = encuadrar(geo, { ancho: 1000, alto: 700 })!;
    expect(libre.alto).toBeGreaterThan(libre.ancho);
    expect(libre.zoom).toBeGreaterThan(fijo.zoom);

    // Y la parcela llena la imagen: el aire que sobra por cada lado es el margen.
    const xs = geo.map((p) => aPixel(p, libre).x);
    const ys = geo.map((p) => aPixel(p, libre).y);
    expect(Math.min(...xs)).toBeLessThan(libre.ancho * 0.15);
    expect(Math.max(...xs)).toBeGreaterThan(libre.ancho * 0.85);
    expect(Math.min(...ys)).toBeLessThan(libre.alto * 0.15);
    expect(Math.max(...ys)).toBeGreaterThan(libre.alto * 0.85);
  });

  it("sin coordenadas no hay mapa: null, no un mapa vacío en medio del océano", () => {
    expect(encuadrar([])).toBeNull();
    expect(encuadrar([{ lon: Number.NaN, lat: 37 }])).toBeNull();
  });

  it("las teselas caen en su sitio dentro de la imagen", () => {
    const e = encuadrar(PUNTOS, { ancho: 512, alto: 512 })!;
    for (const t of e.teselas) {
      expect(t.px).toBeGreaterThan(-256);
      expect(t.py).toBeGreaterThan(-256);
      expect(t.px).toBeLessThan(e.ancho);
      expect(t.py).toBeLessThan(e.alto);
      expect(t.z).toBe(e.zoom);
    }
  });
});

describe("contorno", () => {
  it("convierte cada anillo a píxeles y descarta lo que no es un polígono", () => {
    const e = encuadrar(verticesDeContorno(CONTORNO), { ancho: 400, alto: 400 })!;
    const anillos = contornoEnPixeles([...CONTORNO, [[-5.55, 37.66]] as Array<[number, number]>], e);
    expect(anillos).toHaveLength(1);
    expect(anillos[0]).toHaveLength(5);
  });
});

describe("ortofoto del IGN", () => {
  it("la URL es la del PNOA en el esquema de teselas estándar", () => {
    const url = urlTeselaPnoa(17, 63511, 50718);
    expect(url).toContain("www.ign.es/wmts/pnoa-ma");
    expect(url).toContain("layer=OI.OrthoimageCoverage");
    expect(url).toContain("tilematrixset=GoogleMapsCompatible");
    expect(url).toContain("TileMatrix=17");
    expect(url).toContain("TileCol=63511");
    expect(url).toContain("TileRow=50718");
  });
});

describe("escala", () => {
  it("a más zoom, menos metros por píxel", () => {
    expect(metrosPorPixel(37.66, 19)).toBeLessThan(metrosPorPixel(37.66, 17));
  });

  it("elige un número redondo que quepa en la barra", () => {
    const barra = barraDeEscala(37.66, 19, 160);
    expect([10, 25, 50, 100, 250, 500, 1000, 2000]).toContain(barra.metros);
    expect(barra.pixeles).toBeLessThanOrEqual(160);
    expect(barra.etiqueta).toMatch(/^\d+(\.\d+)? (m|km)$/);
  });
});

describe("etiquetas", () => {
  it("no se salen de la imagen ni se pisan entre ellas", () => {
    const e = encuadrar([...verticesDeContorno(CONTORNO), ...PUNTOS], { ancho: 1000, alto: 700 })!;
    const puestas = colocarEtiquetas(PUNTOS, e);
    expect(puestas).toHaveLength(5);
    for (const et of puestas) {
      expect(et.caja.x).toBeGreaterThanOrEqual(0);
      expect(et.caja.y).toBeGreaterThanOrEqual(0);
      expect(et.caja.x + et.ancho).toBeLessThanOrEqual(e.ancho);
      expect(et.caja.y + et.alto).toBeLessThanOrEqual(e.alto);
    }
    for (let i = 0; i < puestas.length; i++) {
      for (let j = i + 1; j < puestas.length; j++) {
        const a = puestas[i], b = puestas[j];
        const sePisan = a.caja.x < b.caja.x + b.ancho && a.caja.x + a.ancho > b.caja.x
          && a.caja.y < b.caja.y + b.alto && a.caja.y + a.alto > b.caja.y;
        expect(sePisan).toBe(false);
      }
    }
  });

  it("el rótulo se pega a su punto", () => {
    const e = encuadrar(PUNTOS, { ancho: 1000, alto: 700 })!;
    for (const et of colocarEtiquetas(PUNTOS, e)) {
      const distancia = Math.hypot(et.caja.x - et.punto.x, et.caja.y - et.punto.y);
      expect(distancia).toBeLessThan(200);
    }
  });
});
