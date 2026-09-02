-- El empaque habitual de cada producto, para que el Informe PRODUCTO generado
-- no nazca cojo.
--
-- POR QUÉ. Desde el 11-08 el Informe PRODUCTO lo genera la máquina desde
-- calibrador_clasificacion (antes lo subía una persona desde el visor del
-- Sizer), y el calibrador no trae el formato de caja: la columna Empaque salía
-- vacía y producto_dia dejó de acumular empaques — 36/36, 40/40, 45/45 y 34/34
-- filas sin empaque los días 11 a 14. Para los productos ya vistos no duele
-- (el CMV coge el empaque con más kg del histórico), pero cada producto NUEVO
-- de la campaña que viene nacería sin empaque → sin kg/bulto → CMV incompleto.
--
-- QUÉ HACE. Devuelve, para cada nombre pedido, el empaque con MÁS KG de su
-- historial en producto_dia — el mismo criterio (y el mismo desempate) que
-- useEmpaquePorProducto en la app: kg desc, luego alfabético, para que la
-- elección sea determinista. El cruce va por la clave canónica
-- (normalizar_clave_producto), nunca por el texto tal cual.
--
-- Un producto sin historial no devuelve fila: el generador deja el Empaque
-- vacío, como hasta ahora, y el hueco se verá en el CMV — la verdad de los
-- productos nuevos tiene que venir del catálogo del Sizer (pendiente de
-- credenciales), no inventarse aquí.

create or replace function public.empaques_habituales(nombres text[])
returns table (nombre text, empaque text)
language sql stable security definer set search_path = public, pg_temp as $$
  with pedidos as (
    select distinct n as nombre, normalizar_clave_producto(n) as clave
    from unnest(nombres) as n
    where n is not null and trim(n) <> ''
  ),
  historial as (
    select normalizar_clave_producto(producto) as clave,
           trim(formato_caja) as empaque,
           sum(coalesce(kg, 0)) as kg
    from public.producto_dia
    where producto is not null
      and formato_caja is not null and trim(formato_caja) <> ''
    group by 1, 2
  ),
  ganador as (
    select distinct on (clave) clave, empaque
    from historial
    order by clave, kg desc, empaque asc
  )
  select p.nombre, g.empaque
  from pedidos p
  join ganador g on g.clave = p.clave
  where p.clave <> '';
$$;

revoke execute on function public.empaques_habituales(text[]) from public, anon;
grant execute on function public.empaques_habituales(text[]) to service_role;
grant execute on function public.empaques_habituales(text[]) to authenticated;
