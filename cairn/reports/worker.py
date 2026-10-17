"""One bounded report worker per repository, with a durable SQL queue.

Transactional claims and renewable leases prevent duplicate execution.
Queued jobs survive restart; an interrupted running job fails explicitly and is
never retried automatically (report code can have arbitrary side effects).
"""
from __future__ import annotations
import json
import logging
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

from cairn.backend import report_workspaces as jobs
from cairn.backend.common import utc_now
from cairn.backend.storage.datadir import DataDir
from cairn.backend.storage.blobs import BlobStore
from cairn.backend.startup import open_repo_database

log = logging.getLogger(__name__)


def execute(repo, ident):
    from cairn.backend.storage.context import StorageConfig
    storage = StorageConfig(Path(repo), os.environ.get('CAIRN_DATABASE_URL'), os.environ.get('CAIRN_BLOB_ROOT'))
    db, blobs, dd = storage.open()
    try:
        job = jobs.build_status(db, ident, include_files=True)
        if job['status'] != 'running':
            return
        project = dd.root / 'report-jobs' / ident
        source = project / 'reports' / job['slug']
        source.mkdir(parents=True)
        for name, info in job['files'].items():
            target = source / jobs._path(name)
            target.parent.mkdir(parents=True, exist_ok=True)
            data = blobs.get(info['hash'])
            if blobs.hash_bytes(data) != info['hash']:
                raise ValueError(f'source checksum mismatch: {name}')
            target.write_bytes(data)
        from .publishing import publish_report
        from .preparation import restore
        prepared = restore(db, blobs, ident, project)
        result = publish_report(job['slug'], project=project, repo=storage,
                                namespace=job['project_id'], expected_version=job['expected_version'], build_id=ident,
                                prepared=prepared)
        jobs.finish(db, ident, result=result)
    except Exception as exc:
        log.exception('report build failed')
        jobs.finish(db, ident, error=f'{type(exc).__name__}: {exc}'[:16000])
    finally:
        db.close()


class Worker:
    def __init__(self, repo, *, database_url=None, blob_root=None):
        self.repo = Path(repo).resolve()
        self.database_url = database_url
        self.blob_root = blob_root
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._run, name='cairn-report-worker', daemon=True)

    def start(self):
        self.thread.start()

    def close(self):
        self.stop.set()
        self.thread.join(timeout=10)

    def _run(self):
        import uuid
        self.owner = uuid.uuid4().hex
        dd = DataDir(self.repo)
        db = open_repo_database(dd, database_url=self.database_url)
        try:
            while not self.stop.is_set():
                with db.transaction(immediate=True):
                    db.lock_resource('report-queue', 'claim')
                    db.write("UPDATE report_builds SET status='failed', error=?, ended_at=? WHERE status='running' AND lease_until < ?",
                             ['Worker lease expired; submit a new build explicitly', utc_now().isoformat(), time.time()])
                    row = db.read_one("SELECT id FROM report_builds WHERE status='queued' ORDER BY created_at,id LIMIT 1")
                    if row:
                        db.write("UPDATE report_builds SET status='running', started_at=?, owner=?, lease_until=? WHERE id=?",
                                 [utc_now().isoformat(), self.owner, time.time()+60, row[0]])
                if not row:
                    self.stop.wait(.5)
                    continue
                self._execute(db, row[0])
        except Exception:
            log.exception('report worker stopped')
        finally:
            db.close()

    def _execute(self, db, ident):
        output = self.repo / 'report-jobs' / ident
        output.mkdir(parents=True, exist_ok=True)
        env = dict(os.environ)
        # Explicit path selects the server repository; no client auth needed.
        env.pop('CAIRN_TRACKING_URI', None)
        for name, value in (('CAIRN_DATABASE_URL', self.database_url), ('CAIRN_BLOB_ROOT', self.blob_root)):
            if value:
                env[name] = str(value)
            else:
                env.pop(name, None)
        env['PYTHONPATH'] = os.pathsep.join(sys.path)
        env['CAIRN_REPORT_CACHE'] = str(self.repo/'report-cache')
        with (output / 'worker.log').open('wb') as stream:
            process = subprocess.Popen([sys.executable, '-m', __name__, str(self.repo), ident],
                                       stdout=stream, stderr=subprocess.STDOUT, env=env,
                                       start_new_session=True)
            deadline = time.monotonic() + 1800
            renewed = time.monotonic()
            while process.poll() is None and not self.stop.wait(.2):
                if time.monotonic() > deadline:
                    break
                if time.monotonic() - renewed > 10:
                    db.write("UPDATE report_builds SET lease_until=? WHERE id=? AND status='running' AND owner=?",
                             [time.time()+60, ident, self.owner])
                    renewed = time.monotonic()
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                jobs.finish(db, ident, error='Build interrupted or exceeded the 30 minute limit; submit again explicitly')
            elif jobs.build_status(db, ident)['status'] == 'running':
                jobs.finish(db, ident, error=f'Build process exited unexpectedly ({process.returncode}); see worker.log')


if __name__ == '__main__':
    execute(sys.argv[1], sys.argv[2])
