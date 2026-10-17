"""Apply durable run-record batches directly to a local repo."""
from pathlib import Path
from cairn.backend.record_apply import applied_seq, apply_records, IngestGap, IngestWait, MissingBlobs
from cairn.backend.storage.datadir import DataDir
from cairn.backend.storage.blobs import BlobStore
from cairn.backend.startup import open_repo_database
from .client import Gap, UploadError, UploadPending

class LocalIngestClient:
    def __init__(self, repo):
        self.dd = DataDir(Path(repo))
        self.blobs = BlobStore(self.dd.artifacts_dir)
        self.db = open_repo_database(self.dd, self.blobs)
        self.known_blobs = set()

    def applied_seq(self, run_id, log):
        return applied_seq(self.db, run_id, log)

    def ensure_blob(self, digest, source):
        if digest in self.known_blobs or self.blobs.exists(digest):
            self.known_blobs.add(digest)
            return True
        if not source.is_file():
            return False
        import shutil
        import tempfile
        # Stream through a private staging file; commit verifies the checksum.
        with tempfile.NamedTemporaryFile(dir=self.blobs.root, delete=False) as f:
            tmp = Path(f.name)
            with source.open('rb') as inp:
                import hashlib
                digest_read = hashlib.sha256()
                while chunk := inp.read(1 << 20):
                    f.write(chunk)
                    digest_read.update(chunk)
                f.flush()
                import os
                os.fsync(f.fileno())
        if digest_read.hexdigest() != digest:
            tmp.unlink(missing_ok=True)
            raise ValueError(f'corrupt buffered blob {digest}')
        try:
            self.blobs.commit_incoming(tmp, digest)
        finally:
            tmp.unlink(missing_ok=True)
        self.known_blobs.add(digest)
        return True

    def post_records(self, run_id, log, records):
        try:
            return apply_records(self.db, self.dd, self.blobs, run_id, log, records[0]['seq'], records)
        except MissingBlobs as exc:
            raise Gap(exc.applied_seq, exc.missing_blobs) from exc
        except IngestGap as exc:
            raise Gap(exc.applied_seq) from exc
        except IngestWait as exc:
            raise UploadPending(str(exc)) from exc

    def close(self):
        self.db.close()


def recover_journals(dd, db, blobs, *, run_dir=None):
    """Replay this repository's local journals, including after moving its root.

    The containing repository owns local journals; their recorded absolute path
    is only a routing hint. Remote buffers and directories outside ``runs/`` do
    not belong to this repository, even if their metadata happens to name it.
    """
    from ..sdk.runlog.rundir import iter_run_dirs
    from ..sdk.runlog.log import LogReader
    from ..sdk.runlog.codec import record_blobs
    for rd in ([run_dir] if run_dir is not None else iter_run_dirs(dd.root/'runs')):
        # Resolve the journal itself but keep the expected runs directory under
        # the canonical repo root: symlinks must not reach another repository.
        if rd.path.resolve().parent != dd.root/'runs':
            continue
        meta = rd.meta()
        if meta.get('endpoint') != 'local':
            continue
        for ref in rd.logs():
            if ref.live():
                continue
            import json
            try:
                seal = json.loads((ref.owner / 'SEALED').read_text())
            except (FileNotFoundError, ValueError):
                seal = None
            if seal is not None and applied_seq(db, rd.run_id, ref.name) == seal['seq']:
                continue
            reader = LogReader(ref.log_dir)
            while True:
                seq = applied_seq(db, rd.run_id, ref.name)
                records = reader.read(seq, max_bytes=6 << 20)
                if not records:
                    if reader.error:
                        raise ValueError(f'corrupt local journal {ref.log_dir}: {reader.error}')
                    from ..sdk.runlog.rundir import write_atomic
                    write_atomic(ref.owner / 'SEALED', json.dumps({'seq': seq}).encode())
                    break
                for rec in records:
                    for digest in record_blobs(rec):
                        if not blobs.exists(digest):
                            path = rd.blobs_dir/digest
                            from ..sdk.runlog.blobs import verify_blob
                            if not verify_blob(path, digest):
                                raise ValueError(f'missing or corrupt local blob {digest}')
                            blobs.put(path.read_bytes())
                try:
                    ack = apply_records(db, dd, blobs, rd.run_id, ref.name, records[0]['seq'], records)
                except IngestWait:
                    break  # A worker may be discovered before its primary.
                ref.set_acked(ack)

        state = db.read_one('SELECT status FROM runs WHERE id=?', [rd.run_id])
        if state and state[0] == 'running' and not rd.live():
            db.write("UPDATE runs SET status = 'crashed' WHERE id = ? AND status = 'running'", [rd.run_id])
        if not rd.live() and meta.get('repo') != str(dd.root):
            # Subsequent explicit sync must continue at the moved repository,
            # rather than recreate the historical path recorded by the writer.
            rd.update_meta(repo=str(dd.root))
