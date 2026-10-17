# Sharing reports

For a server-hosted report, open its page and share the URL with someone who has
the server's access token. That token grants access to the server; there is no
separate report-scoped credential or restricted share URL.

To share a page without server access, export a standalone HTML file:

```bash
cairn report export study --out study.html
```

The export carries the rendered report and figures. Plotly reports load the pinned
Plotly runtime from a CDN. To change a publication, edit its Markdown source and
publish a new version.
