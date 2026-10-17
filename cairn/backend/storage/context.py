"""Explicit server-side storage configuration shared by domain clients/workers."""
from dataclasses import dataclass
from pathlib import Path

@dataclass(frozen=True)
class StorageConfig:
    root: Path
    database_url: str | None = None
    blob_root: str | None = None

    def open(self):
        from .datadir import DataDir
        from .blobs import open_blob_store
        from ..startup import open_repo_database
        directory = DataDir(Path(self.root))
        blobs = open_blob_store(self.blob_root or directory.artifacts_dir,
                                cache_dir=directory.root/'blob-cache')
        database = open_repo_database(directory, blobs, database_url=self.database_url)
        return database, blobs, directory
