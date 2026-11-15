"""Bounded asynchronous assessment jobs for the existing map frontend."""
import asyncio
from datetime import datetime,timezone
import hashlib
import json
import logging
from time import monotonic
from uuid import uuid4

from fastapi import APIRouter,HTTPException,Request,Response

from backend.priority_schemas import PriorityFeatureRequest,PriorityJob
from backend.services.priority_features import collect_area_features,GFWFeatureProvider
from backend.services.priority_score import policy,score_features

router=APIRouter(prefix='/priority',tags=['Area review priority'])
logger=logging.getLogger(__name__)


class PriorityJobs:
    def __init__(self,forecaster,habitats,client,extractor=collect_area_features):
        self.forecaster=forecaster;self.habitats=habitats;self.client=client;self.extractor=extractor
        self.jobs={};self.tasks={};self.slots=asyncio.Semaphore(1)

    def start(self,body):
        now=monotonic()
        for key in list(self.jobs):
            if now-self.jobs[key]['touched']>900 and self.jobs[key]['status'] not in ('queued','running'):
                self.jobs.pop(key);self.tasks.pop(key,None)
        model=self.forecaster.info()['model_sha256'] if self.forecaster else None
        key=hashlib.sha256(json.dumps([body.model_dump(mode='json'),model,self.habitats.cache_key()],sort_keys=True).encode()).hexdigest()
        for job in self.jobs.values():
            if job['key']==key and job['status'] not in ('failed','cancelled'):
                return job
        if sum(job['status'] in ('queued','running') for job in self.jobs.values())>=4 or len(self.jobs)>=32:
            raise HTTPException(429,'Priority assessment queue is full; retry after an active job finishes.')
        identifier=uuid4().hex
        job={'id':identifier,'status':'queued','progress':{'phase':'queued','completed':0,'total':None},
            'result':None,'error':None,'key':key,'touched':now,'request':body.model_dump(mode='json'),
            'created_at':datetime.now(timezone.utc).isoformat()}
        self.jobs[identifier]=job
        self.tasks[identifier]=asyncio.create_task(self.run(job,body))
        return job

    async def run(self,job,body):
        try:
            async with self.slots:
                job['status']='running'
                def progress(phase,completed=0,total=None):
                    job['progress']={'phase':phase,'completed':completed,'total':total}
                progress('collecting aligned sources')
                extraction=await self.extractor(body,forecaster=self.forecaster,habitats=self.habitats,
                    provider=GFWFeatureProvider(self.client),progress=progress)
                progress('calculating priority')
                job['result']=score_features(extraction);job['status']='complete'
                progress('complete',1,1)
        except asyncio.CancelledError:
            job['status']='cancelled';job['error']='Assessment cancelled; incomplete sources were not scored.'
        except Exception:
            logger.exception('Priority assessment failed')
            job['status']='failed';job['error']='Assessment failed; no priority was inferred. Check server logs and retry.'
        finally:
            job['touched']=monotonic()

    async def close(self):
        for task in self.tasks.values():
            if not task.done(): task.cancel()
        await asyncio.gather(*self.tasks.values(),return_exceptions=True)

    def view(self,identifier):
        job=self.jobs.get(identifier)
        if job is None or (monotonic()-job['touched']>900 and job['status'] not in ('queued','running')):
            raise HTTPException(404,'Assessment expired or not found; create a new assessment.')
        return {key:value for key,value in job.items() if key not in ('key','touched')}


def jobs(request):
    manager=getattr(request.app.state,'priority_jobs',None)
    if manager is None: raise HTTPException(503,'Priority service is starting or unavailable.')
    return manager


@router.get('/policy')
def get_policy():
    return policy()


@router.get('/health')
def get_health(request: Request):
    manager = jobs(request)
    return {'status': 'ready', 'forecast_ready': manager.forecaster is not None,
            'habitats': manager.habitats.availability(),
            'note': 'Assessment availability is separate from input completeness. Missing sources never become zero risk.'}


@router.post('/assessments',status_code=202,response_model=PriorityJob)
async def start_assessment(body:PriorityFeatureRequest,request:Request,response:Response):
    manager=jobs(request);job=manager.start(body)
    response.headers['Cache-Control']='no-store'
    return manager.view(job['id'])


@router.get('/assessments/{identifier}',response_model=PriorityJob)
def get_assessment(identifier:str,request:Request,response:Response):
    response.headers['Cache-Control']='no-store'
    return jobs(request).view(identifier)


@router.delete('/assessments/{identifier}',response_model=PriorityJob)
async def cancel_assessment(identifier:str,request:Request):
    manager=jobs(request);manager.view(identifier)
    task=manager.tasks[identifier]
    if not task.done():
        task.cancel();await asyncio.gather(task,return_exceptions=True)
        if manager.jobs[identifier]['status']=='queued': manager.jobs[identifier]['status']='cancelled'
    return manager.view(identifier)
