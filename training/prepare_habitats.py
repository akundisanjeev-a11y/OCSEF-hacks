"""Verify/extract local habitat shapefiles once and build a persistent SQLite RTree."""
import argparse
from datetime import datetime,timezone
import hashlib
import json
import logging
from pathlib import Path
import shutil
import sqlite3

import numpy as np
import shapefile
from shapely import force_2d, make_valid, to_wkb
from shapely.geometry import shape
from shapely.ops import transform

ROOT=Path(__file__).resolve().parents[1]
DEFAULT=ROOT/'datasets/priority_engine/habitats'
DATASET_ARCHIVES={'coral_reefs':'WCMC008','seagrass':'WCMC013-014'}
logging.getLogger('shapefile').setLevel(logging.ERROR)


def parts(geometry):
    if geometry.geom_type.startswith('Multi') or geometry.geom_type=='GeometryCollection':
        for child in geometry.geoms:
            yield from parts(child)
    else:
        yield geometry


def prepare(destination=DEFAULT,datasets=('coral_reefs','seagrass')):
    destination=Path(destination).resolve()
    destination.mkdir(parents=True,exist_ok=True)
    inventory=json.loads((ROOT/'docs/priority-engine-step1-inventory.json').read_text())
    database=destination/'habitats.sqlite'
    with sqlite3.connect(database) as connection:
        connection.executescript('''PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS layers(layer_id TEXT PRIMARY KEY,status TEXT,metadata TEXT);
            CREATE TABLE IF NOT EXISTS features(id INTEGER PRIMARY KEY,layer_id TEXT,source_record INTEGER,
                kind TEXT,wkb BLOB,properties TEXT);
            CREATE INDEX IF NOT EXISTS feature_layer ON features(layer_id);
            CREATE VIRTUAL TABLE IF NOT EXISTS bounds USING rtree(id,minx,maxx,miny,maxy);
        ''')
        for source in inventory['habitat_archives']:
            if not any(source['archive'].startswith(DATASET_ARCHIVES[name]) for name in datasets):
                continue
            archive_path=ROOT/source['archive']
            with archive_path.open('rb') as stream:
                if hashlib.file_digest(stream,'sha256').hexdigest()!=source['sha256']:
                    raise ValueError('Habitat archive changed since its audited inventory')
            from zipfile import ZipFile
            with ZipFile(archive_path) as archive:
                for layer in source['layers']:
                    layer_id=Path(layer['file']).stem
                    previous=connection.execute('SELECT status,metadata FROM layers WHERE layer_id=?',(layer_id,)).fetchone()
                    if previous and previous[0] in ('complete','partial'):
                        if json.loads(previous[1])['archive_sha256']!=source['sha256']:
                            raise ValueError('Prepared habitat source hash differs')
                        print('Reusing indexed',layer_id,flush=True)
                        continue
                    files={}
                    for member in archive.namelist():
                        if member[:-4].lower()!=layer['file'][:-4].lower() or Path(member).suffix.lower() not in ('.shp','.shx','.dbf','.prj','.cpg'):
                            continue
                        target=(destination/'sources'/archive_path.stem/Path(member).name).resolve()
                        if not target.is_relative_to(destination):
                            raise ValueError('Unsafe archive path')
                        target.parent.mkdir(parents=True,exist_ok=True)
                        if not target.exists() or target.stat().st_size!=archive.getinfo(member).file_size:
                            with archive.open(member) as incoming,target.open('wb') as outgoing:
                                shutil.copyfileobj(incoming,outgoing,1024*1024)
                        files[Path(member).suffix.lower()]=target
                    if 'GCS_WGS_1984' not in files['.prj'].read_text():
                        raise ValueError('Unexpected habitat coordinate reference system')
                    metadata={'archive':source['archive'],'archive_sha256':source['sha256'],
                        'layer':layer_id,'geometry_type':layer['geometry_type'],
                        'reference_year':2021 if 'Seagrass' in source['archive'] else 2018 if 'CoralReefs2018' in source['archive'] else 2017,
                        'valid_from':None,'valid_until':None,'crs':'WGS84',
                        'licence':'Included UNEP-WCMC general data licence; local reference use, no raw redistribution.',
                        'audited_dbf_records':layer['dbf_records_including_unchecked_deleted_records']}
                    connection.execute('INSERT OR REPLACE INTO layers VALUES(?,?,?)',(layer_id,'building',json.dumps(metadata)))
                    connection.commit()
                    skipped=[]; repaired=0; indexed=0; records=0; nulls=0
                    encoding=files.get('.cpg')
                    encoding=encoding.read_text().strip() if encoding else 'utf-8'
                    if encoding in ('1252','65001'):
                        encoding={'1252':'cp1252','65001':'utf-8'}[encoding]
                    with shapefile.Reader(shp=str(files['.shp']),shx=str(files['.shx']),dbf=str(files['.dbf']),encoding=encoding,encodingErrors='replace') as reader:
                        for record in reader.iterShapeRecords():
                            records+=1
                            if record.shape.shapeType==0:
                                nulls+=1
                                continue
                            try:
                                geometry=force_2d(shape(record.shape.__geo_interface__))
                                if geometry.is_empty:
                                    nulls+=1
                                    continue
                                west,south,east,north=geometry.bounds
                                if not np.isfinite(geometry.bounds).all() or west < -180-1e-8 or east>180+1e-8 or south < -90-1e-8 or north>90+1e-8:
                                    raise ValueError('Invalid WGS84 bounds')
                                if west < -180 or east>180 or south < -90 or north>90:
                                    geometry=transform(lambda x,y,z=None:(np.clip(x,-180,180),np.clip(y,-90,90)),geometry)
                                if not geometry.is_valid:
                                    geometry=make_valid(geometry)
                                    repaired+=1
                                properties=json.dumps(record.record.as_dict(),default=str)
                                for part in parts(geometry):
                                    if part.is_empty or part.geom_type not in ('Point','Polygon'):
                                        continue
                                    a,b,c,d=part.bounds
                                    cursor=connection.execute('INSERT INTO features(layer_id,source_record,kind,wkb,properties) VALUES(?,?,?,?,?)',
                                        (layer_id,record.record.oid,'point' if part.geom_type=='Point' else 'polygon',to_wkb(part),properties))
                                    connection.execute('INSERT INTO bounds VALUES(?,?,?,?,?)',(cursor.lastrowid,a,c,b,d))
                                    indexed+=1
                            except (ValueError,TypeError,shapefile.ShapefileException) as error:
                                skipped.append({'record':record.record.oid,'error':type(error).__name__})
                            if records%10000==0:
                                print(layer_id,'records',records,'parts',indexed,flush=True)
                    metadata.update(records_read=records,indexed_parts=indexed,repaired_records=repaired,
                        null_records=nulls,skipped_records=len(skipped),first_skipped=skipped[:10],
                        prepared_at_utc=datetime.now(timezone.utc).isoformat())
                    connection.execute('UPDATE layers SET status=?,metadata=? WHERE layer_id=?',
                        ('partial' if skipped else 'complete',json.dumps(metadata),layer_id))
                    connection.commit()
                    print('Indexed',layer_id,json.dumps({k:metadata[k] for k in ('records_read','indexed_parts','repaired_records','skipped_records')}),flush=True)
        connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    print('Habitat reference index ready:',database,flush=True)
    return database


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=DEFAULT)
    parser.add_argument('--datasets',nargs='+',choices=tuple(DATASET_ARCHIVES),default=list(DATASET_ARCHIVES))
    args=parser.parse_args()
    prepare(args.output,args.datasets)
