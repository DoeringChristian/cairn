"""Artifact handler — pickle Python objects."""

from __future__ import annotations

import pickle
from typing import Any


class ArtifactHandler:
    """Pickles any Python object.

    Triggered explicitly via the ``cairn.Artifact`` wrapper. Stores the
    pickled bytes with ``application/python-pickle`` MIME so the UI
    download yields a ``.pkl`` file.
    """

    object_type = "artifact"
    mime_type = "application/python-pickle"

    def can_handle(self, obj: Any) -> bool:
        # Only triggered via cairn.Artifact wrapper — never auto-dispatched.
        return False

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]:
        try:
            data = pickle.dumps(obj, protocol=pickle.HIGHEST_PROTOCOL)
        except (pickle.PicklingError, TypeError, AttributeError) as e:
            raise TypeError(
                f"cairn.Artifact could not pickle {type(obj).__name__}: {e}. "
                f"Pass a picklable Python object (dict, list, dataclass, "
                f"model.state_dict(), etc.)."
            ) from e

        meta: dict[str, Any] = {
            "size_bytes": len(data),
            "mime_type": self.mime_type,
            "python_type": type(obj).__name__,
            "python_module": type(obj).__module__,
        }
        # Pass through any extra kwargs as metadata.
        for k, v in kwargs.items():
            meta[k] = v

        return data, meta
