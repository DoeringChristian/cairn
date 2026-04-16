"""Allow ``python -m cairn`` to invoke the CLI entrypoint."""

from .cli import main

if __name__ == "__main__":
    main()
