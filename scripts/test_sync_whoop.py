#!/usr/bin/env python3

import unittest
from unittest.mock import patch

import requests

from sync_whoop import github_request, update_github_secret


def response(status: int, payload: str = "{}") -> requests.Response:
    result = requests.Response()
    result.status_code = status
    result._content = payload.encode("utf-8")
    result.headers["Content-Type"] = "application/json"
    return result


class GithubSecretRetryTests(unittest.TestCase):
    @patch("sync_whoop.time.sleep")
    @patch("sync_whoop._encrypt_secret", return_value="encrypted")
    @patch("sync_whoop.requests.request")
    def test_secret_update_retries_transient_failure(self, request_mock, _encrypt_mock, sleep_mock):
        request_mock.side_effect = [
            response(503),
            response(200, '{"key":"public-key","key_id":"key-id"}'),
            response(204),
        ]
        update_github_secret("owner/repo", "WHOOP_REFRESH_TOKEN", "rotated", "pat")
        self.assertEqual(request_mock.call_count, 3)
        self.assertEqual(request_mock.call_args_list[0].args[0], "GET")
        self.assertEqual(request_mock.call_args_list[-1].args[0], "PUT")
        sleep_mock.assert_called_once_with(1)

    @patch("sync_whoop.requests.request", return_value=response(401))
    def test_non_retryable_failure_is_immediate(self, request_mock):
        with self.assertRaises(requests.HTTPError):
            github_request("GET", "https://api.github.test", attempts=4)
        request_mock.assert_called_once()


if __name__ == "__main__":
    unittest.main()
