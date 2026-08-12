# Cómo escribir el lote en el calibrador

Para pegar junto a la máquina.

## La regla, que es una sola

> **Cada código lleva sus box detrás.**

```
26013107 40 BOX + 26012608 25 BOX
```

Con eso, la herramienta reparte los kilos sola: 40 box de uno y 25 del otro son
61% y 39%, y cada productor se lleva lo suyo. Sin los box no hay forma de saber
cuánto era de cada uno, y **la pasada entera se le apunta al primero** — que es
lo que pasa hoy con casi 2 millones de kilos de la campaña.

## Da igual cómo lo escribas

Todo esto vale exactamente igual (comprobado contra el programa):

```
26013107 40 BOX + 26012608 25 BOX
26013107 40B + 26012608 25B
26013107 40BOX+26012608 25BOX
26013107 40 + 26012608 25
26013107-40 BOX-26012608-25 BOX
26013107 40 BOX, 26012608 25 BOX
26013107 40 box + 26012608 25 box
```

Mayúsculas o minúsculas, con `+`, con `-`, con coma o con un espacio. Lo único
que importa es que **detrás de cada código vaya su número de box**.

Y valen tres o más:

```
26013107 20 BOX + 26012608 15 BOX + 26012207 10 BOX
```

## El reciclaje, igual que ahora

```
26060204 45 BOX + 3 BOX DE RECICLAJE
```

Lo único que cambia es que **el lote también lleve sus box**. Hoy se escribe
`26060204+3 BOX DE RECICLAJE`, y al faltar los 45 no se puede repartir.

Los kilos del reciclaje no se le apuntan a ningún productor — eso ya está bien y
no hay que hacer nada. Igual con DESCARTE, DESMONTAJE y EGIPTO.

## El precalibrado: con su código, no con la fecha

Esto es lo que más se falla.

| No sirve | Sí sirve |
| --- | --- |
| `26050402 30 BOX + 6 BOX PREC DIA 23/06` | `26050402 30 BOX + 26062301 6 BOX` |
| `26051106+PREC` | `26051106 30 BOX + 26073101 8 BOX` |

Poner solo la fecha (`PREC DIA 23/06`) obliga a que alguien mire después de qué
re-entrada era, porque puede haber varias del mismo día en PREC 1 y PREC 2. **El
precalibrado tiene su propio código de lote de 8 dígitos** — ese es el que hay
que escribir, como si fuera un lote más.

## Lo que se escribe hoy y cómo quedaría

| Hoy | Debería ser |
| --- | --- |
| `26013107+26012608` | `26013107 40 BOX + 26012608 25 BOX` |
| `26012402+26012207` | `26012402 30 BOX + 26012207 12 BOX` |
| `26060204+3 BOX DE RECICLAJE` | `26060204 45 BOX + 3 BOX DE RECICLAJE` |
| `26052803- 26052807 PREC` | `26052803 20 BOX + 26052807 8 BOX` |
| `26051106+PREC` | `26051106 30 BOX + 26073101 8 BOX` |

## Dos cosas que NO hacen falta

**No escribas el tamaño del box.** `5 BOX GRANDE` no se lee: el programa da por
hecho que son grandes, que es lo normal. Escribirlo no estorba, pero no cambia
nada.

**No hace falta que los box sean exactos al kilo.** Solo sirven para repartir en
proporción: el total que se reparte es siempre el peso real que pesó la máquina,
ni un kilo más ni uno menos. Con que sean los box de verdad que se echaron, basta.

## Por qué merece la pena

Son unos segundos al teclear el lote. A cambio, el aprovechamiento por productor
deja de estar mal en 8,9% de los kilos de la campaña — y eso es lo que se mira
para decidir con qué fincas compensa trabajar.
