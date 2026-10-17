"""Live config/summary views, retaining callable updates for existing clients."""
from collections.abc import Mapping
from copy import deepcopy


class RunDocument(Mapping):
    def __init__(self, run, kind):
        self._run = run
        self._kind = kind

    def __getitem__(self, key):
        # Explicit reassignment is required for nested edits.
        return deepcopy(self._run._docs[self._kind][key])

    def __iter__(self):
        return iter(self._run._docs[self._kind])

    def __len__(self):
        return len(self._run._docs[self._kind])

    def __setitem__(self, key, value):
        self.update({key: value})

    def update(self, values=None, **kwargs):
        if values is not None and not isinstance(values, Mapping):
            raise TypeError('update expects a mapping')
        getattr(self._run, '_update_' + self._kind)(dict(values or {}), **kwargs)

    def __call__(self, *args, **kwargs):
        getattr(self._run, '_update_' + self._kind)(*args, **kwargs)

    def __repr__(self):
        return repr(dict(self))
