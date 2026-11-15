import asyncio
from time import sleep

from fastapi.testclient import TestClient

from backend.main import create_app
from test_priority_score import extraction

BODY={'area':{'west':0,'south':0,'east':5,'north':5},'start':'2025-11-05T00:00:00Z','end':'2025-11-12T00:00:00Z'}


def test_background_api_contract_alias_dedup_and_no_client_scores():
    app=create_app(seed_fixtures=False,load_forecast=False)
    calls=[]
    async def collect(body,**kwargs):
        calls.append(body)
        kwargs['progress']('testing sources',1,1)
        return extraction()
    with TestClient(app) as client:
        app.state.priority_jobs.extractor=collect
        first=client.post('/priority/assessments',json=BODY)
        assert first.status_code==202
        identifier=first.json()['id']
        for _ in range(100):
            result=client.get('/api/priority/assessments/'+identifier)
            if result.json()['status']=='complete': break
            sleep(.01)
        assert result.json()['result']['priority_category']=='Minimal'
        assert client.post('/api/priority/assessments',json=BODY).json()['id']==identifier
        assert len(calls)==1
        assert client.post('/priority/assessments',json={**BODY,'priority_score':100}).status_code==422
        assert client.get('/priority/assessments/missing').status_code==404
        assert client.get('/priority/policy').json()['weights']['local_review']==35


def test_cancellation_and_shutdown_do_not_leave_running_assessments():
    app=create_app(seed_fixtures=False,load_forecast=False)
    async def collect(*args,**kwargs):
        await asyncio.Event().wait()
    with TestClient(app) as client:
        app.state.priority_jobs.extractor=collect
        identifier=client.post('/priority/assessments',json=BODY).json()['id']
        response=client.delete('/priority/assessments/'+identifier)
        assert response.json()['status']=='cancelled'
        assert response.json()['result'] is None


def test_failure_is_not_a_zero_score():
    app=create_app(seed_fixtures=False,load_forecast=False)
    async def collect(*args,**kwargs):
        raise RuntimeError('Source failure')
    with TestClient(app) as client:
        app.state.priority_jobs.extractor=collect
        identifier=client.post('/priority/assessments',json=BODY).json()['id']
        for _ in range(100):
            response=client.get('/priority/assessments/'+identifier)
            if response.json()['status']=='failed': break
            sleep(.01)
        assert response.json()['status']=='failed' and response.json()['result'] is None
