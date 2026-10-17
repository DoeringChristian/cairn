"""JSON compression preserves the ASGI protocol for every other response."""
import asyncio
import gzip

import pytest

from cairn.server.app import _JsonGZip


def compress(messages, encoding='gzip'):
    sent = []

    async def response(scope, receive, send):
        for message in messages:
            await send(message.copy())

    async def receive():
        return {'type': 'http.disconnect'}

    async def send(message):
        sent.append(message)

    asyncio.run(_JsonGZip(response)(
        {'type': 'http', 'headers': [(b'accept-encoding', encoding.encode())]}, receive, send,
    ))
    return sent


@pytest.mark.parametrize('media_type,status', [
    ('text/html; charset=utf-8', 200),
    ('application/octet-stream', 200),
    ('image/png', 200),
    ('text/event-stream', 200),
    ('application/json', 206),
])
def test_non_json_and_byte_ranges_pass_through_start_and_body(media_type, status):
    headers = [(b'content-type', media_type.encode())]
    if status == 206:
        headers.append((b'content-range', b'bytes 0-9999/12000'))
    messages = [
        {'type': 'http.response.start', 'status': status, 'headers': headers},
        {'type': 'http.response.body', 'body': b'x' * 5000, 'more_body': True},
        {'type': 'http.response.body', 'body': b'y' * 5000, 'more_body': False},
    ]
    assert compress(messages) == messages


@pytest.mark.parametrize('encoding', ['gzip', 'identity'])
def test_large_json_is_compressed_only_when_accepted(encoding):
    body = b'{"result":"' + b'x' * 10_000 + b'"}'
    messages = [
        {'type': 'http.response.start', 'status': 200, 'headers': [
            (b'content-type', b'application/json'), (b'content-length', str(len(body)).encode()),
        ]},
        {'type': 'http.response.body', 'body': body},
    ]
    sent = compress(messages, encoding)
    assert [message['type'] for message in sent] == ['http.response.start', 'http.response.body']
    headers = dict(sent[0]['headers'])
    actual = sent[1]['body']
    if encoding == 'gzip':
        assert headers[b'content-encoding'] == b'gzip'
        assert gzip.decompress(actual) == body
        assert int(headers[b'content-length']) == len(actual) < len(body)
    else:
        assert b'content-encoding' not in headers
        assert actual == body
