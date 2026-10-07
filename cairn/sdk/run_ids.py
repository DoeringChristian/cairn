"""Run ids and process labels (stdlib only: ``cairn.new_run_id()`` is called
from launch scripts, before anything else is imported).

A run id names the run's log files (``.cairn/wals/<run_id>.wal.jsonl``) and a
labelled process's log adds ``~<label>`` to it; a label also names that
process's system metrics (``system.<label>.*``). Both are therefore kept to
characters that are safe in a file name and contain no ``.`` or ``~``.
"""

from __future__ import annotations

import os
import re
import secrets

#: The environment variable every process of a shared run reads its id from.
RUN_ID_ENV = "CAIRN_RUN_ID"

_RUN_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
_LABEL = re.compile(r"[A-Za-z0-9_-]{1,64}")


def new_run_id() -> str:
    """A fresh run id in cairn's format: 32 lowercase hex characters.

    Generate it once and give it to every process of a shared run:

        export CAIRN_RUN_ID=$(python -c "import cairn; print(cairn.new_run_id())")
    """
    return secrets.token_hex(16)


def check_run_id(run_id: str) -> str:
    """``run_id`` if it is a valid id (1-64 of ``A-Z a-z 0-9 _ -``)."""
    if not isinstance(run_id, str) or not _RUN_ID.fullmatch(run_id):
        raise ValueError(
            f"run id must be 1-64 characters of A-Z, a-z, 0-9, '_' and '-', got {run_id!r}"
        )
    return run_id


def check_label(label: str) -> str:
    """``label`` if it is a valid process label (1-64 of ``A-Z a-z 0-9 _ -``)."""
    if not isinstance(label, str) or not _LABEL.fullmatch(label):
        raise ValueError(
            f"label must be 1-64 characters of A-Z, a-z, 0-9, '_' and '-', got {label!r}"
        )
    return label


def env_run_id() -> str | None:
    """``CAIRN_RUN_ID``, if set and not empty."""
    return os.environ.get(RUN_ID_ENV) or None


#: Where ``label="auto"`` reads the process's rank, first set one wins:
#: torchrun / accelerate / deepspeed, SLURM, SkyPilot, Open MPI, MPICH/PMI.
RANK_ENV_VARS = ("RANK", "SLURM_PROCID", "SKYPILOT_NODE_RANK", "OMPI_COMM_WORLD_RANK", "PMI_RANK")


def auto_label() -> tuple[str | None, bool]:
    """``label="auto"``: ``(label, primary)`` from the launcher's rank.

    Rank 0 is the primary labelled ``"rank0"``, rank N a worker labelled
    ``"rankN"``; with no rank variable set, a primary without a label.

    Raises:
        ValueError: The first rank variable set is not a non-negative integer.
    """
    for var in RANK_ENV_VARS:
        value = os.environ.get(var)
        if value is None or value == "":
            continue
        try:
            rank = int(value)
        except ValueError:
            rank = -1
        if rank < 0:
            raise ValueError(f"label='auto': {var}={value!r} is not a rank")
        return f"rank{rank}", rank == 0
    return None, True
