"""Step-one source inventory; reads archive headers without extracting habitat data."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import struct
import subprocess
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
SHAPES = {1:'Point',5:'Polygon',8:'MultiPoint',18:'MultiPointZ'}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()


def archive_inventory(path):
    result = {'archive':path.name,'bytes':path.stat().st_size,'sha256':digest(path),
              'inspection':'Archive directory, CRS and binary headers only; full geometry validity and CRC not checked.',
              'layers':[]}
    with ZipFile(path) as archive:
        names = archive.namelist()
        result['uncompressed_bytes'] = sum(item.file_size for item in archive.infolist())
        result['license_files'] = [name for name in names if name.lower().endswith('license.txt')]
        for name in [name for name in names if name.lower().endswith('.shp')]:
            with archive.open(name) as stream:
                header = stream.read(100)
            if len(header)!=100 or struct.unpack('>i',header[:4])[0]!=9994:
                raise ValueError('Invalid shapefile header')
            base = name[:-4]
            matches = {Path(member).suffix.lower():member for member in names
                       if member[:-4].lower()==base.lower()}
            with archive.open(matches['.dbf']) as stream:
                dbf = stream.read(32)
                descriptors = stream.read(struct.unpack('<H',dbf[8:10])[0]-32)
            fields = [{'name':descriptors[i:i+11].split(b'\0')[0].decode('ascii'),
                       'type':chr(descriptors[i+11]),'width':descriptors[i+16]}
                      for i in range(0,len(descriptors)-31,32)]
            shape_type = struct.unpack('<i',header[32:36])[0]
            result['layers'].append({'file':name,'shape_type':shape_type,
                'geometry_type':SHAPES.get(shape_type,str(shape_type)),
                'dbf_records_including_unchecked_deleted_records':struct.unpack('<I',dbf[4:8])[0],
                'bounds_west_south_east_north':list(struct.unpack('<4d',header[36:68])),
                'crs_wkt':archive.read(matches['.prj']).decode('utf-8-sig'),
                'fields':fields})
    return result


def main():
    revision = subprocess.check_output(['git','rev-parse','origin/main'],cwd=ROOT,text=True).strip()
    tree = subprocess.check_output(['git','ls-tree','-r','-l',revision],cwd=ROOT,text=True)
    files = []
    for line in tree.splitlines():
        attributes,path = line.split('\t',1)
        mode,kind,blob,size = attributes.split()
        files.append({'path':path,'blob_sha1':blob,'bytes':int(size),'kind':kind})
    groups = dict(sorted(Counter(item['path'].split('/')[0] for item in files).items()))
    local_model = ROOT/'weights/activity_forecast/best_model.joblib'
    comparison = json.loads((ROOT/'weights/activity_forecast/depth4_release/paired_comparison.json').read_text())
    result = {'created_at_utc':datetime.now(timezone.utc).isoformat(),
        'main_commit':revision,'working_branch':subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip(),
        'tracked_files':files,'file_counts_by_top_level':groups,
        'permanent_local_model_sha256':digest(local_model),
        'main_model_sha256':hashlib.sha256(subprocess.check_output(['git','show',f'{revision}:weights/activity_forecast/best_model.joblib'],cwd=ROOT)).hexdigest(),
        'paired_comparison':{stage:{'previous_mae':part['models']['previous']['mae_hours'],
            'depth4_mae':part['models']['depth4']['mae_hours'],
            'reduction_percent':part['depth4_mae_reduction_vs_previous_percent'],
            'weekly_wins':part['depth4_weeks_beating_previous'],'weekly_folds':part['weekly_folds']}
            for stage,part in comparison['results'].items()},
        'habitat_archives':[archive_inventory(path) for path in sorted(ROOT.glob('WCMC*.zip'))]}
    destination = ROOT/'docs/priority-engine-step1-inventory.json'
    destination.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print('Inventoried',len(files),'main-branch files and',len(result['habitat_archives']),'habitat archives.')
    print('No habitat extraction, spatial indexing, source API call or priority calculation was performed.')


if __name__=='__main__':
    main()
