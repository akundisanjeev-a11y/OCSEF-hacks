# Fictional authorization evidence

All identifiers, permits, rules, activity reports and zone assertions here are
invented demo data. They do not describe real vessels or Ghana fishing law.

`static_cases.json` remains the step-1 API seed. Its authorization states remain
unknown. `investigation_inputs.json` supplies inputs for the step-3 decision
service; `expected_status` is a test expectation, never decision evidence.
The API evaluates these four additional inputs on startup, for six total cases.

`permits.json` indexes permits by MMSI or IMO. An IMO lookup requires an explicit
identity source linking it to the observation. Each permit records an ID, validity,
zone, activity and source. Validity uses UTC, including the start and excluding the
end. The register is deliberately incomplete: an absent entry cannot establish a
violation. Lookup returns candidate permits without applying scope or time rules.

| Observation | Expected step-3 result | Evidence |
| --- | --- | --- |
| `permit-valid-0` | `authorized` | Confirmed fishing, known zone and time; DEMO-PERMIT-001 covers all three. |
| `documented-conflict-0` | `potential_violation` | Confirmed fishing inside zone B conflicts with the explicit DEMO-RULE-B prohibition. The IMO-sourced permit covers transit only. |
| `ambiguous-identity-0` | `unknown` | Identity is ambiguous and fishing is only a sourced imagery hint; no MMSI is assigned. |
| `missing-evidence-0` | `unknown` | Activity, zone membership, rules and permit evidence are absent. |

Activity evidence is separate from radar confidence and AIS identity. Zone
membership is a sourced fictional scene assertion, not a point-in-polygon result;
the zone IDs do not imply a real legal boundary. Rule evidence supplies zone,
activity, time interval, condition and source for a documented conflict.

`imagery_context` optionally supplies tentative vessel type, a fishing-activity
hint and sourced area usage. Each annotation must refer to the observation's
capture time; area context requires coordinates and an area source. The API
returns these assessments and their sources separately from authorization.
All supplied imagery annotations are fictional: no vessel classifier, real image
analysis or spatial overlay computation is implemented by this service.

Load validated inputs from Python with:

```python
from backend.services.permit_evidence import load_permits, load_investigation_inputs

registry = load_permits()
scene = load_investigation_inputs().cases[0]
permits = registry.lookup(mmsi=scene.observation.mmsi, sourced_imo=scene.sourced_imo)
```
