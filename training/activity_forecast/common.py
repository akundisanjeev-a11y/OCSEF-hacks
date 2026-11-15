import os
from pathlib import Path
import re

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "datasets" / "activity_forecast"
FEATURES = ["recent_week_daily_mean", "previous_week_daily_mean", "previous_month_daily_mean"]


def read_token() -> str:
    """Read locally; accept the user's existing bare JWT without rewriting .env."""
    token = os.getenv("GFW_TOKEN", "").strip()
    if token:
        return token
    for path in (ROOT / ".env", ROOT / "backend" / ".env"):
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8-sig").strip()
        if re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", text):
            return text
        values = dotenv_values(path)
        for key in ("GFW_TOKEN", "GFW_API_KEY", "GLOBAL_FISHING_WATCH_API_KEY"):
            if values.get(key):
                return values[key].strip()
    raise ValueError("Add GFW_TOKEN to .env or backend/.env; do not put it in source code")
