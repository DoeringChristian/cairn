"""Small structured-record tour: optional coordinates and media metadata.

Run with: python examples/showcase/records.py --repo /path/to/repository
Then open the run's Records tab and plot /validation/loss against /epoch.
"""
import argparse
import math
import cairn


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--project', default='cairn-showcase')
    args = parser.parse_args()
    with cairn.init(args.project, repo=args.repo, name='Structured observations',
                    capture_source=False, capture_system_metrics=False,
                    capture_stdout=False, capture_env=False) as run:
        for epoch in range(12):
            cairn.log({'epoch': epoch, 'training': {'loss': math.exp(-epoch/3)},
                       'validation': {'loss': math.exp(-epoch/4)+.05},
                       'split': 'validation', 'accepted': epoch > 2})
        cairn.log({'step': 5, 'loss': .2, 'attempt': 1})
        cairn.log({'step': 5, 'loss': .15, 'attempt': 2})
        cairn.track(cairn.Text('A captured sample with searchable metadata.'),
                    {'split': 'test', 'sample': {'id': 'example-1', 'quality': .95}})
        run.summary['description'] = 'Nested fields, repeated steps, no required step, and media metadata.'
    print(run.id)


if __name__ == '__main__':
    main()
