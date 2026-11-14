"""Process-local case storage. Restarting the server clears the store."""

from threading import RLock

from backend.schemas import Case, DataMode


class CaseService:
    def __init__(self) -> None:
        self._cases: dict[str, Case] = {}
        self._lock = RLock()

    def upsert(self, case: Case) -> Case:
        """Replace an existing case with the same observation ID, or insert it."""
        with self._lock:
            self._cases[case.observation.observation_id] = case.model_copy(deep=True)
            return case.model_copy(deep=True)

    def list(self, data_mode: DataMode | None = None) -> list[Case]:
        with self._lock:
            return [
                case.model_copy(deep=True)
                for _, case in sorted(self._cases.items())
                if data_mode is None or case.observation.data_mode == data_mode
            ]

    def get(self, observation_id: str) -> Case | None:
        with self._lock:
            case = self._cases.get(observation_id)
            return case.model_copy(deep=True) if case is not None else None
