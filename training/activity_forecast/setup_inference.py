"""Restore the bundled historical inference data; no API key or network required."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]


def setup(archive=None, destination=None):
    archive = Path(archive or ROOT/'datasets/activity_forecast/inference_history.zip')
    destination = Path(destination or ROOT/'datasets/activity_forecast/processed').resolve()
    with ZipFile(archive) as zipped:
        manifest = json.loads(zipped.read('manifest.json'))
        allowed = {str(Path(block)/name).replace('\\', '/')
                   for block in ('', 'fresh_test', 'seasonal_history', 'inference_reference')
                   for name in ('daily_world.csv', 'metadata.json')}
        if set(manifest) != allowed or set(zipped.namelist()) != allowed | {'manifest.json'}:
            raise ValueError('Unexpected inference archive contents')
        # Verify everything before writing; never overwrite different local history.
        contents = {}
        for name, checksum in manifest.items():
            target = (destination/name).resolve()
            if not target.is_relative_to(destination):
                raise ValueError('Unsafe inference archive path')
            payload = zipped.read(name)
            if hashlib.sha256(payload).hexdigest() != checksum:
                raise ValueError('Inference archive checksum mismatch')
            if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() != checksum:
                raise ValueError(f'Local history differs: {name}; preserve it and choose another destination')
            contents[target] = payload
        for target, payload in contents.items():
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                target.write_bytes(payload)
    return destination


def setup_bundled(archive=None, cache_root=None):
    """Restore a release into its own cache; never replace local training history."""
    archive = Path(archive or ROOT/'datasets/activity_forecast/inference_history.zip')
    with archive.open('rb') as stream:
        version = hashlib.file_digest(stream, 'sha256').hexdigest()
    cache_root = Path(cache_root or ROOT/'datasets/activity_forecast/inference_cache')
    return setup(archive=archive, destination=cache_root/version)


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination',type=Path)
    args=parser.parse_args()
    restored = setup(destination=args.destination) if args.destination is not None else setup_bundled()
    print('Historical inference data ready:', restored)
