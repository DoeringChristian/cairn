# Server and authentication

Start the server explicitly:

```bash
CAIRN_TOKEN=your-secret cairn server --repo /srv/cairn --host 0.0.0.0
```

Authentication is enabled by default, including Python `create_app()`. If
`CAIRN_TOKEN` is unset, the server atomically creates a private `<repo>/token` file
and prints its path. Use `--token-file PATH` or `CAIRN_TOKEN_FILE` to choose another
file. Existing credentials persist across restarts; generated files have mode 0600.
Clients can also read a credential through `CAIRN_TOKEN_FILE`.

Clients discover a copied token automatically in `.cairn/token` in the nearest
project directory, or in `~/.config/cairn/token` (`$XDG_CONFIG_HOME/cairn/token`
when configured). No environment variable is needed. `CAIRN_DIR` selects another
client buffer directory and its `token` file. Explicit credentials and environment
overrides take precedence; a project token takes precedence over a saved per-server
login, which takes precedence over the user-wide token.

An authenticated server with its UI enabled prints a browser login link at startup.
The browser exchanges the token from the link for the same HttpOnly cookie used by
manual login, then removes it from the address bar. The link grants the same access
as the token file.

One configured token grants access. SDK clients use `CAIRN_TOKEN` or
`cairn login URL`; browsers paste the same token into the login page. Cookies are
HttpOnly and scoped by the repo identity. Replacing the configured token and
restarting invalidates old browser and SDK credentials.

There are no roles, token databases, token-minting commands, OTPs, SSH authentication,
or restricted report-share credentials. `--no-auth` explicitly disables authentication.
Local database operations need no credentials. `cairn ui` serves a local repo on
loopback; it does not change how local SDK processes access that repo.

A remote client creates an upload buffer, not a local replica. Metadata and artifact
files are authoritative on the server. Reports can build on the authoring machine
or execute from a draft in the server UI. Both publish immutable captured evidence
and source files to the selected repository.

See [Storage architecture and migration](storage-architecture.md) for moving an
existing local repository to a server, supported upgrades, and backup requirements.
