"""Indexed local habitat context. Historical static layers are never score inputs."""
import json
import math
from pathlib import Path
import sqlite3

from pyproj import Geod
from shapely import from_wkb, orient_polygons
from shapely.geometry import box
from shapely.ops import unary_union

GEOD=Geod(ellps='WGS84')
REFERENCE_QUERY_BYTE_BUDGET=128_000_000


def geodesic_area_km2(geometry):
    """Split into small longitude/latitude tiles to avoid Geod's half-globe limit."""
    if geometry.is_empty or geometry.geom_type not in ('Polygon','MultiPolygon','GeometryCollection'):
        return 0.
    if geometry.geom_type=='GeometryCollection':
        return sum(geodesic_area_km2(part) for part in geometry.geoms)
    west,south,east,north=geometry.bounds
    total=0.
    for x in range(math.floor(west/10)*10,math.ceil(east/10)*10,10):
        for y in range(math.floor(south/10)*10,math.ceil(north/10)*10,10):
            clipped=geometry.intersection(box(x,y,min(x+10,180),min(y+10,90)))
            polygons=list(clipped.geoms) if clipped.geom_type.startswith('Multi') or clipped.geom_type=='GeometryCollection' else [clipped]
            for polygon in polygons:
                if polygon.geom_type=='Polygon' and not polygon.is_empty:
                    # Densify parallels so the rectangular selection's edges are
                    # not approximated by a single long great-circle chord.
                    polygon=orient_polygons(polygon.segmentize(.1))
                    total+=abs(GEOD.geometry_area_perimeter(polygon)[0])/1e6
    return total


class HabitatIndex:
    def __init__(self,path):
        self.path=Path(path)

    def cache_key(self):
        try:
            stat = self.path.stat()
            return [str(self.path.resolve()), stat.st_size, stat.st_mtime_ns]
        except OSError:
            return None

    def availability(self):
        """Inspect readiness without creating a database or returning geometries."""
        if not self.path.is_file():
            return {'ready': False, 'status': 'missing', 'layers': 0,
                    'message': 'Marine habitat reference data is not installed on this backend.'}
        try:
            with sqlite3.connect(f'{self.path.resolve().as_uri()}?mode=ro',uri=True) as connection:
                tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if not {'layers', 'features', 'bounds'} <= tables:
                    raise ValueError('Missing index tables')
                layers = 0
                for status, raw in connection.execute('SELECT status,metadata FROM layers'):
                    metadata = json.loads(raw)
                    if status in ('complete', 'partial') and (metadata.get('dataset') in ('coral_reefs', 'seagrass') or metadata.get('archive', '').startswith(('WCMC008','WCMC013-014'))):
                        layers += 1
            return {'ready': bool(layers), 'status': 'reference_only' if layers else 'empty', 'layers': layers,
                    'message': 'Historical marine references are available; they are not date-matched scoring inputs.' if layers else 'The index contains no prepared coral or seagrass reference layers.'}
        except (OSError, ValueError, TypeError, AttributeError, sqlite3.Error):
            return {'ready': False, 'status': 'invalid', 'layers': 0,
                    'message': 'The marine reference index is unreadable or incomplete; prepare it again from the original sources.'}

    def query(self,area,start,end):
        if not self.path.is_file():
            return {'status':'unavailable','eligible_for_scoring':False,
                'reason':'habitat_index_not_prepared','features':None,'layers':[]}
        readiness = self.availability()
        if not readiness['ready']:
            return {'status':'unavailable','eligible_for_scoring':False,
                    'reason':'habitat_index_'+readiness['status'],'features':None,'layers':[]}
        selection=box(area.west,area.south,area.east,area.north)
        layers=[]
        with sqlite3.connect(f'{self.path.resolve().as_uri()}?mode=ro',uri=True) as connection:
            connection.row_factory=sqlite3.Row
            for layer in connection.execute('SELECT * FROM layers ORDER BY layer_id'):
                metadata=json.loads(layer['metadata'])
                archive=metadata.get('archive','')
                dataset=metadata.get('dataset')
                if not (archive.startswith(('WCMC008','WCMC013-014')) or dataset in ('coral_reefs','seagrass')):
                    continue
                if layer['status'] not in ('complete','partial'):
                    layers.append({'source':metadata,'status':'unavailable','reason':'index_build_incomplete'})
                    continue
                candidate_bytes=connection.execute('''SELECT coalesce(sum(length(f.wkb)),0) FROM bounds b
                    JOIN features f ON f.id=b.id WHERE f.layer_id=?
                    AND b.maxx>=? AND b.minx<=? AND b.maxy>=? AND b.miny<=?''',
                    (layer['layer_id'],area.west,area.east,area.south,area.north)).fetchone()[0]
                if candidate_bytes>REFERENCE_QUERY_BYTE_BUDGET:
                    layers.append({'source':metadata,'status':'unavailable','eligible_for_scoring':False,
                        'reason':'Reference geometry exceeds synchronous memory budget; needs batched/background processing. No shapes were sampled.',
                        'reference_only':None})
                    continue
                rows=connection.execute('''SELECT f.source_record,f.kind,f.wkb FROM bounds b
                    JOIN features f ON f.id=b.id WHERE f.layer_id=?
                    AND b.maxx>=? AND b.minx<=? AND b.maxy>=? AND b.miny<=?''',
                    (layer['layer_id'],area.west,area.east,area.south,area.north))
                polygons=[]
                point_records=set()
                polygon_records=set()
                point_occurrences=0
                for record in rows:
                    geometry=from_wkb(record['wkb'])
                    if not geometry.intersects(selection):
                        continue
                    if record['kind']=='point':
                        point_occurrences+=1
                        point_records.add(record['source_record'])
                    else:
                        clipped=geometry.intersection(selection)
                        if not clipped.is_empty and clipped.area>0:
                            polygons.append(clipped)
                            polygon_records.add(record['source_record'])
                footprint=unary_union(polygons) if polygons else None
                layers.append({'source':metadata,'status':layer['status'],
                    'eligible_for_scoring':False,'temporal_alignment':'static_reference_not_date_matched',
                    'reason':'No documented validity interval matching the requested dates; excluded per user instruction.',
                    'reference_only':{'polygon_source_records_intersecting':len(polygon_records),
                        'point_source_records_inside':len(point_records),'point_occurrences_inside':point_occurrences,
                        'mapped_polygon_area_km2':geodesic_area_km2(footprint) if footprint is not None else 0.}})
        return {'status':'reference_only','eligible_for_scoring':False,
            'temporal_alignment':'static_reference_not_date_matched','features':None,'layers':layers,
            'note':'Dated reference occurrences and mapped footprints only. Empty results do not establish habitat absence. No geometries are redistributed.'}
