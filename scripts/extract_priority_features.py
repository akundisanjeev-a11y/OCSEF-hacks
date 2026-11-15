"""Collect one selected area's date-matched inputs. Does not calculate a score."""
import argparse
import asyncio
from datetime import datetime,timedelta,timezone
import json
import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from dotenv import load_dotenv
from backend.priority_schemas import PriorityFeatureRequest
from backend.services.activity_forecast import ActivityForecaster
from backend.services.habitat_features import HabitatIndex
from backend.services.priority_features import collect_area_features


def local_path(value):
    path=Path(value)
    return path if path.is_absolute() else ROOT/path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for coordinate in ('west','south','east','north'):
        parser.add_argument('--'+coordinate,type=float,required=True)
    parser.add_argument('--start')
    parser.add_argument('--end')
    parser.add_argument('--forecast-period',action='store_true')
    parser.add_argument('--skip-vessel-evidence',action='store_true')
    parser.add_argument('--filters-json',default='{}')
    parser.add_argument('--output',type=Path,default=ROOT/'datasets/priority_engine/selected_area_features.json')
    args=parser.parse_args()
    load_dotenv(ROOT/'.env',override=False)
    forecaster=None
    try:
        forecaster=ActivityForecaster(
            local_path(os.getenv('ACTIVITY_FORECAST_MODEL_PATH','weights/activity_forecast/best_model.joblib')),
            local_path(os.getenv('ACTIVITY_FORECAST_DATA_DIR','datasets/activity_forecast/processed')))
    except (ValueError,OSError) as error:
        print('Forecast unavailable:',type(error).__name__)
    if args.forecast_period:
        if args.start or args.end or forecaster is None:
            parser.error('--forecast-period requires a loaded model and no explicit --start/--end')
        info=forecaster.info()
        start=datetime.fromisoformat(info['target_start']).replace(tzinfo=timezone.utc)
        end=datetime.fromisoformat(info['target_end']).replace(tzinfo=timezone.utc)+timedelta(days=1)
    else:
        if not args.start or not args.end:
            parser.error('Supply both absolute UTC --start/--end, or use --forecast-period')
        start,end=args.start,args.end
    request=PriorityFeatureRequest(area={key:getattr(args,key) for key in ('west','south','east','north')},
        start=start,end=end,filters=json.loads(args.filters_json),include_vessel_evidence=not args.skip_vessel_evidence)
    habitat=HabitatIndex(ROOT/'datasets/priority_engine/habitats/habitats.sqlite')
    result=asyncio.run(collect_area_features(request,forecaster=forecaster,habitats=habitat))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    print(json.dumps({'output':str(args.output),'start':result['start'],'end_exclusive':result['end_exclusive'],
        'scoring_input_components':list(result['scoring_inputs']),
        'source_status':{key:value['status'] for key,value in result['components'].items()},
        'excluded':result['excluded_components']},indent=2))


if __name__=='__main__':
    main()
