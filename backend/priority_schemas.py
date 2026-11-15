"""Strict geographic/time contract for feature extraction, before scoring."""
from datetime import timezone
from typing import Literal,Any

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class PriorityArea(BaseModel):
    model_config = ConfigDict(extra='forbid',allow_inf_nan=False)
    west: float = Field(ge=-180,le=180)
    south: float = Field(ge=-90,le=90)
    east: float = Field(ge=-180,le=180)
    north: float = Field(ge=-90,le=90)

    @model_validator(mode='after')
    def ordered(self):
        if self.west>=self.east or self.south>=self.north:
            raise ValueError('Use an increasing rectangle; split date-line crossings')
        return self


class PriorityFilters(BaseModel):
    model_config = ConfigDict(extra='forbid')
    flag: list[str] = Field(default_factory=list,max_length=10)
    geartype: list[str] = Field(default_factory=list,max_length=10)
    vessel_id: str | None = None
    vessel_type: str | None = None
    shiptype: str | None = None
    speed: Literal['<2','2-4','4-6','6-10','10-15','15-25','>25'] | None = None
    distance_from_port_km: Literal[0,1,2,3,4,5] | None = None

    def active(self):
        return {key:value for key,value in self.model_dump().items() if value is not None and value!=[]}


class PriorityFeatureRequest(BaseModel):
    model_config = ConfigDict(extra='forbid',allow_inf_nan=False)
    area: PriorityArea
    start: AwareDatetime
    end: AwareDatetime
    filters: PriorityFilters = Field(default_factory=PriorityFilters)
    include_vessel_evidence: bool = True

    @model_validator(mode='after')
    def valid_period_and_filters(self):
        self.start=self.start.astimezone(timezone.utc)
        self.end=self.end.astimezone(timezone.utc)
        if not 0<(self.end-self.start).total_seconds()<=168*3600:
            raise ValueError('Use an absolute UTC interval of at most seven days, [start,end)')
        import re
        for value in self.filters.flag:
            if not re.fullmatch(r'[A-Z]{3}',value):
                raise ValueError('Flag must be a three-letter uppercase code')
        for value in [*self.filters.geartype,self.filters.vessel_type,self.filters.shiptype]:
            if value is not None and not re.fullmatch(r'[a-z][a-z0-9_]{0,45}',value):
                raise ValueError('Invalid type/gear filter')
        if self.filters.vessel_id is not None and not re.fullmatch(r'[A-Za-z0-9_-]{1,200}',self.filters.vessel_id):
            raise ValueError('Invalid vessel ID')
        return self


class PriorityFactor(BaseModel):
    model_config=ConfigDict(allow_inf_nan=False)
    code:str
    label:str
    weight:int=Field(ge=0,le=100)
    available:bool
    normalized_value:float|None=Field(ge=0,le=1)
    contribution_points:float|None=Field(ge=0,le=100)
    reason:str
    sources:list[str]


class PriorityAssessment(BaseModel):
    model_config=ConfigDict(allow_inf_nan=False)
    policy_version:str
    status:Literal['complete','partial','unavailable']
    priority_score:float|None=Field(ge=0,le=100)
    priority_category:Literal['Minimal','Low','Medium','High','Critical']|None
    score_kind:Literal['minimum_supported_review_priority']
    score_range:tuple[float,float]
    coverage_percent:int=Field(ge=0,le=100)
    factors:list[PriorityFactor]
    adjustments:list[dict[str,Any]]
    review_triggers:list[str]
    area:PriorityArea
    start:AwareDatetime
    end_exclusive:AwareDatetime
    filters:PriorityFilters
    selection_key:str
    components:dict[str,dict[str,Any]]
    excluded_components:dict[str,str|None]
    limitations:list[str]


class PriorityProgress(BaseModel):
    phase:str
    completed:int=Field(ge=0)
    total:int|None=Field(default=None,ge=0)


class PriorityJob(BaseModel):
    id:str=Field(pattern=r'^[a-f0-9]{32}$')
    status:Literal['queued','running','complete','failed','cancelled']
    progress:PriorityProgress
    result:PriorityAssessment|None
    error:str|None
    request:PriorityFeatureRequest
    created_at:AwareDatetime
