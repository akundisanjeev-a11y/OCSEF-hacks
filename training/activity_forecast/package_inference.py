"""Package only compact inference histories, never training labels or raw exports."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED

import pandas as pd

ROOT=Path(__file__).resolve().parents[2]


def package(source,archive):
    source,archive=Path(source),Path(archive)
    payloads={}
    for annual in (False,True):
        folder=source/'seasonal_history' if annual else source
        metadata=json.loads((folder/'metadata.json').read_text())
        if metadata['availability_lag_days']!=4 or metadata['grid_degrees']!=5:
            raise ValueError('Inference history must match the permanent four-day, five-degree checkpoint')
        data=pd.read_csv(folder/'daily_world.csv',parse_dates=['date'])
        cutoff=pd.Timestamp('2024-08-01' if annual else '2025-07-01')
        for extension in (False,True):
            block=('inference_reference' if extension else 'seasonal_history') if annual else ('fresh_test' if extension else '')
            selected=data.loc[data.date>=cutoff if extension else data.date<cutoff].sort_values(['cell_id','date'])
            if selected.empty or selected.duplicated(['cell_id','date']).any():
                raise ValueError('Invalid inference history block')
            prefix=block+'/' if block else ''
            payloads[prefix+'daily_world.csv']=selected.to_csv(index=False,date_format='%Y-%m-%d',float_format='%.8f',lineterminator='\n').encode()
            details={**metadata,'start':str(selected.date.min().date()),
                'end_exclusive':str((selected.date.max()+pd.Timedelta(days=1)).date()),
                'daily_rows':len(selected),'training_rows':0,'trainable_cells':0,'inference_only':True}
            payloads[prefix+'metadata.json']=(json.dumps(details,indent=2)+'\n').encode()
    manifest={name:hashlib.sha256(content).hexdigest() for name,content in payloads.items()}
    archive.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(archive,'w',compression=ZIP_DEFLATED,compresslevel=6) as zipped:
        for name,content in payloads.items(): zipped.writestr(name,content)
        zipped.writestr('manifest.json',json.dumps(manifest,indent=2)+'\n')
    print('Packaged',len(payloads),'inference files:',round(archive.stat().st_size/1e6,2),'MB')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--archive',type=Path,default=ROOT/'datasets/activity_forecast/inference_history.zip')
    args=parser.parse_args();package(args.source,args.archive)
