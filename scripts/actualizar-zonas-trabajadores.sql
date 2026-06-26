create or replace function pg_temp.norm_trabajador_name(value text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    lower(translate(
      coalesce(value, ''),
      'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇáàäâéèëêíìïîóòöôúùüûñç',
      'AAAAEEEEIIIIOOOOUUUUNCaaaaeeeeiiiioooouuuunc'
    )),
    '\s+',
    ' ',
    'g'
  );
$$;

with zonas(nombre_key, zona) as (
  values
    ('raquel prisco diaz', 'Encargadas'),
    ('lidia luna rodriguez', 'Encargadas'),
    ('antonio jesus rodriguez espejo', 'Carretillero inicio linea'),
    ('enrique fernandez', 'Transpaletas mecanicas'),
    ('sandra naranjo', 'Tria podrido'),
    ('daniela areiza', 'Tria podrido'),
    ('marta ariza', 'Aereo'),
    ('pilar llamas', 'Aereo'),
    ('alejandro carmona', 'Carretillero final linea'),
    ('juan prieto', 'Carretillero final linea'),
    ('angel prisco', 'Transpaletas mecanicas'),
    ('monserrat garcia alcazar', 'Transpaletas mecanicas'),
    ('cristian prisco', 'Transpaletas mecanicas'),
    ('cristian prieto', 'Transpaletas mecanicas'),
    ('ana maria rodriguez ramos', 'Produccion'),
    ('rocio flores ancio', 'Produccion'),
    ('sara hans doblas', 'Produccion'),
    ('silvia cerro ojeda', 'Produccion'),
    ('antonio lopez galvez', 'Responsable mantenimiento'),
    ('alvaro corrales', 'Responsables mallas'),
    ('ana cristina jimenez', 'Responsables mallas'),
    ('encarni minguez', 'Responsables mallas'),
    ('cristobalina pigner garcia', 'Responsables mallas'),
    ('marina jimenez', 'Malla 1 - Tria'),
    ('araceli rivera', 'Malla 1 - Recogedoras'),
    ('miriam plaza', 'Malla 1 - Recogedoras'),
    ('maria pilar moreno', 'Malla 2 - Tria'),
    ('rocio garcia navarro', 'Malla 2 - Recogedoras'),
    ('rocio gonzalez', 'Malla 2 - Recogedoras'),
    ('sandra leon', 'Malla 3 - Tria'),
    ('lucia ferrero martinez', 'Malla 3 - Recogedoras'),
    ('libertad diaz', 'Malla 3 - Recogedoras'),
    ('ana belen rodriguez laguna', 'Malla 4 - Tria'),
    ('eli conde', 'Malla 4 - Recogedoras'),
    ('eva llamas', 'Responsables granel/RP'),
    ('irene luna', 'Responsables granel/RP'),
    ('virginia fabra', 'Triadoras granel/RP'),
    ('laura rivero rodriguez', 'Triadoras granel/RP'),
    ('sonia lebron', 'Triadoras granel/RP'),
    ('borja garrido', 'Mozos envasado'),
    ('josue prisco', 'Mozos envasado'),
    ('rafael arjona', 'Mozos envasado'),
    ('ruben chaparro', 'Mozos envasado')
),
actualizados_por_nombre as (
  update public.trabajadores trabajador
  set zona = zonas.zona
  from zonas
  where trabajador.activo = true
    and pg_temp.norm_trabajador_name(trabajador.nombre) = zonas.nombre_key
    and trabajador.zona is distinct from zonas.zona
  returning trabajador.nombre, trabajador.zona
),
actualizados_envasadoras as (
  update public.trabajadores trabajador
  set zona = 'Envasadoras'
  where trabajador.activo = true
    and not exists (
      select 1
      from zonas
      where zonas.nombre_key = pg_temp.norm_trabajador_name(trabajador.nombre)
    )
    and pg_temp.norm_trabajador_name(trabajador.zona) <> pg_temp.norm_trabajador_name('Carga y descarga')
    and trabajador.zona is distinct from 'Envasadoras'
  returning trabajador.nombre, trabajador.zona
)
select 'por_nombre' as tipo, count(*) as filas_actualizadas
from actualizados_por_nombre
union all
select 'envasadoras_fallback' as tipo, count(*) as filas_actualizadas
from actualizados_envasadoras;
