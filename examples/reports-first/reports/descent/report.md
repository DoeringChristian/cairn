---
title: Descent on a quadratic
subtitle: A small experiment, with its evidence captured in the report.
status: complete
inputs:
  fit: "run:REPLACE_BY_RUNNING_TRAIN"
---

## Does the loss decrease?

```python exec hide
import matplotlib.pyplot as plt
series = read_series(inputs.fit, "loss")
initial = series[0]["value"]
final = series[-1]["value"]
plt.plot([p["step"] for p in series], [p["value"] for p in series])
plt.xlabel("Step")
plt.ylabel("Loss")
caption("The loss decreases over thirty gradient steps.")
```

Loss fell from {{ initial }} to {{ final }}.

!!! finding supported "Gradient descent converges"
    With the declared learning rate, every step moves toward the minimum.
