"""Read GFW credentials locally without exposing or rewriting them."""
import os
from pathlib import Path
import re
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
KEYS = ('GFW_API_TOKEN', 'GFW_TOKEN', 'GFW_API_KEY', 'GLOBAL_FISHING_WATCH_API_KEY')


def get_gfw_token():
    for key in KEYS:
        value = os.getenv(key, '').strip()
        if value:
            return value
    for path in (ROOT/'.env', ROOT/'backend/.env'):
        if not path.is_file():
            continue
        text = path.read_text(encoding='utf-8-sig').strip()
        if re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', text):
            return text
        values = dotenv_values(path)
        for key in KEYS:
            value = values.get(key)
            if value and value.strip():
                return value.strip()
    return ''
