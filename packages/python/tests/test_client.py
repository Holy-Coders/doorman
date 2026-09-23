import concurrent.futures
import http.server
import json
import threading
import unittest
from janitor_client import Client, JanitorError

class ClientTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.status = 200
        self.body = {"visitorId": "vis_" + "a"*48, "isReturning": True, "risk": {"automation": 1}, "debug": "private"}
        outer = self
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                outer.calls.append((self.headers, self.rfile.read(int(self.headers["Content-Length"]))))
                self.send_response(outer.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Set-Cookie", "__visitor=value; HttpOnly; Secure; Path=/")
                self.send_header("Set-Cookie", "second=value; HttpOnly; Secure; Path=/")
                self.send_header("Location", "/elsewhere")
                self.end_headers()
                self.wfile.write(json.dumps(outer.body).encode())
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1",0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.client = Client(f"http://127.0.0.1:{self.server.server_port}/api/visitor", bearer_token="server-token")
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
    def test_projects_public_response_and_preserves_separate_cookies(self):
        result = self.client.identify({}, cookie="__visitor=one", origin="https://app.example")
        self.assertEqual(set(result.public_json()), {"visitorId","isReturning"})
        self.assertEqual(len(result.set_cookies),2)
        self.assertEqual(self.calls[0][0]["Authorization"], "Bearer server-token")
        self.assertEqual(self.calls[0][0]["Origin"], "https://app.example")
    def test_concurrent_users_never_share_cookies(self):
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            list(pool.map(lambda i: self.client.identify({},cookie=f"__visitor={i}"),range(8)))
        self.client.identify({})
        self.assertEqual({call[0].get("Cookie") for call in self.calls},{None,*[f"__visitor={i}" for i in range(8)]})
    def test_redirects_are_not_followed(self):
        self.status=302
        with self.assertRaises(JanitorError): self.client.identify({})
        self.assertEqual(len(self.calls),1)
    def test_input_headers_and_size_are_bounded(self):
        for kwargs in ({"signals":{"userAgent":"a"*33000}},{"signals":{},"cookie":"x\r\nInjected: yes"},{"signals":{"x":float("nan")}}):
            with self.assertRaises(ValueError): self.client.identify(**kwargs)
        self.assertEqual(self.calls,[])
    def test_malformed_and_oversized_output_is_controlled(self):
        for body in ({"visitorId":"anything","isReturning":True},{"visitorId":"vis_"+"a"*48,"isReturning":1},[1],{"large":"x"*70000}):
            self.body=body
            with self.assertRaises(JanitorError): self.client.identify({})
    def test_insecure_external_urls_and_credentials_are_rejected(self):
        for endpoint in ("http://external.example/api", "https://user:pass@example.com/", "https://example.com/?token=x"):
            with self.assertRaises(ValueError): Client(endpoint)

if __name__ == "__main__": unittest.main()
