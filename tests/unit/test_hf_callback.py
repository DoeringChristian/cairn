"""HuggingFace CairnCallback unit tests (no real training)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

pytest.importorskip("transformers")


def test_on_log_tracks_scalars():
    from cairn.integrations.huggingface import CairnCallback

    mock_run = MagicMock()
    cb = CairnCallback(run=mock_run)

    # Simulate minimal args/state/control.
    args = MagicMock()
    state = MagicMock()
    state.global_step = 100
    control = MagicMock()

    cb.on_log(
        args,
        state,
        control,
        logs={"loss": 0.5, "learning_rate": 0.001, "step": 100},
    )
    # Should have called track twice (step filtered out).
    assert mock_run.track.call_count == 2
    call_names = {call.kwargs.get("name") for call in mock_run.track.call_args_list}
    assert call_names == {"loss", "learning_rate"}


def test_on_evaluate_uses_eval_context():
    from cairn.integrations.huggingface import CairnCallback

    mock_run = MagicMock()
    cb = CairnCallback(run=mock_run)

    args = MagicMock()
    state = MagicMock()
    state.global_step = 500
    control = MagicMock()

    cb.on_evaluate(args, state, control, metrics={"eval_loss": 0.2, "eval_accuracy": 0.9})
    assert mock_run.track.call_count == 2
    for call in mock_run.track.call_args_list:
        assert call.kwargs.get("context") == {"subset": "eval"}


def test_on_train_end_finishes_owned_run():
    from cairn.integrations.huggingface import CairnCallback

    mock_run = MagicMock()
    cb = CairnCallback(run=mock_run)
    # Not owned (passed in); don't finish.
    cb.on_train_end(MagicMock(), MagicMock(), MagicMock())
    mock_run.finish.assert_not_called()


def test_on_train_end_finishes_when_owned(monkeypatch):
    from cairn.integrations import huggingface

    mock_run = MagicMock()

    def mock_run_ctor(**kw):
        return mock_run

    monkeypatch.setattr(huggingface, "Run", mock_run_ctor)
    cb = huggingface.CairnCallback(project="p", task="t")
    args = MagicMock()
    args.output_dir = "/tmp/out"
    state = MagicMock()
    control = MagicMock()
    # Emulate TrainingArguments.to_dict
    args.to_dict = lambda: {"lr": 0.1}
    cb.on_train_begin(args, state, control)
    cb.on_train_end(args, state, control)
    mock_run.finish.assert_called_once_with("completed")


def test_on_log_skips_non_numeric():
    from cairn.integrations.huggingface import CairnCallback

    mock_run = MagicMock()
    cb = CairnCallback(run=mock_run)
    args = MagicMock()
    state = MagicMock()
    state.global_step = 1
    control = MagicMock()
    cb.on_log(args, state, control, logs={"loss": 0.1, "epoch": "one"})
    # "epoch"="one" is not float-coercible → one call.
    assert mock_run.track.call_count == 1
