import json
import sqlite3
from datetime import datetime,timezone

import pytest
from shapely import to_wkb
from shapely.geometry import Point,box

from backend.priority_schemas import PriorityArea
from backend.services.habitat_features import HabitatIndex,geodesic_area_km2


def test_geodesic_area_handles_whole_globe_and_points_have_no_area():
    total=geodesic_area_km2(box(-180,-90,180,90))
    assert 500_000_000<total<520_000_000
    halves=geodesic_area_km2(box(-180,-90,0,90))+geodesic_area_km2(box(0,-90,180,90))
    assert halves==pytest.approx(total,rel=1e-9)
    assert geodesic_area_km2(Point(1,1))==0


def test_habitat_clip_union_points_and_strict_date_exclusion(tmp_path):
    path=tmp_path/'habitats.sqlite'
    with sqlite3.connect(path) as db:
        db.executescript('''CREATE TABLE layers(layer_id TEXT,status TEXT,metadata TEXT);
            CREATE TABLE features(id INTEGER PRIMARY KEY,layer_id TEXT,source_record INTEGER,kind TEXT,wkb BLOB);
            CREATE VIRTUAL TABLE bounds USING rtree(id,minx,maxx,miny,maxy);''')
        db.execute('INSERT INTO layers VALUES(?,?,?)',('test','complete',json.dumps({'dataset':'coral_reefs','reference_year':2018,'valid_from':None,'valid_until':None})))
        db.execute('INSERT INTO layers VALUES(?,?,?)',('saltmarsh','building',json.dumps({'archive':'WCMC027_Saltmarsh_v6_1.zip'})))
        for i,geometry in enumerate([box(0,0,1.5,1),box(1,0,3,1),Point(.5,.5),Point(20,20)]):
            db.execute('INSERT INTO features VALUES(?,?,?,?,?)',(i,'test',i,'point' if geometry.geom_type=='Point' else 'polygon',to_wkb(geometry)))
            west,south,east,north=geometry.bounds
            db.execute('INSERT INTO bounds VALUES(?,?,?,?,?)',(i,west,east,south,north))
    result=HabitatIndex(path).query(PriorityArea(west=0,south=0,east=2,north=1),
        datetime(2025,11,5,tzinfo=timezone.utc),datetime(2025,11,12,tzinfo=timezone.utc))
    assert result['eligible_for_scoring'] is False and result['features'] is None
    assert len(result['layers'])==1  # Unselected saltmarsh cannot block or enter extraction.
    reference=result['layers'][0]['reference_only']
    assert reference['polygon_source_records_intersecting']==2
    assert reference['point_occurrences_inside']==1
    assert reference['mapped_polygon_area_km2']==pytest.approx(geodesic_area_km2(box(0,0,2,1)),rel=1e-6)


def test_missing_index_does_not_imply_zero_habitat(tmp_path):
    result=HabitatIndex(tmp_path/'missing.sqlite').query(PriorityArea(west=0,south=0,east=5,north=5),None,None)
    assert result['status']=='unavailable' and result['features'] is None
