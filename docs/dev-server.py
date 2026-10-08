#!/usr/bin/env python3
"""
Simple development server for SPA routing.
All requests are served from index.html to support client-side routing.
"""

import argparse
import http.server
import socketserver
import os
import re
from urllib.parse import urlparse

DEFAULT_PORT = 8888

class SPAHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP request handler with SPA support."""

    # Ensure media types Python's mimetypes module may not know are served with
    # the right Content-Type (so <video> can decode them instead of receiving
    # text/html). Merge onto the base class map.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.webm': 'video/webm',
        '.mp4': 'video/mp4',
    }

    def do_GET(self):
        """Handle GET requests with SPA routing."""
        # Parse the URL path
        url_path = urlparse(self.path).path

        # List of file extensions that should be served directly
        file_extensions = ['.html', '.css', '.js', '.json', '.md', '.png', '.jpg', '.jpeg',
                          '.gif', '.webm', '.mp4', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.txt']

        # Check if the request is for a static file
        is_file = any(url_path.endswith(ext) for ext in file_extensions)

        # Check if the file exists
        file_path = self.translate_path(self.path)
        file_exists = os.path.isfile(file_path)

        # If it's a file request and the file exists, serve it normally
        if is_file and file_exists:
            return super().do_GET()

        # If it's a file request but the file doesn't exist, return 404
        if is_file and not file_exists:
            return super().do_GET()

        # Check if it's a directory request (like /paths/)
        if url_path.endswith('/'):
            # Try to serve index.html from that directory
            index_path = url_path + 'index.html'
            index_file_path = self.translate_path(index_path)
            if os.path.isfile(index_file_path):
                self.path = index_path
                return super().do_GET()

        # For all other requests, serve the appropriate index.html for SPA routing
        if not is_file:
            # Check if path/index.html exists on disk (e.g. /labs/getting-started)
            dir_index_path = url_path.rstrip('/') + '/index.html'
            dir_index_file = self.translate_path(dir_index_path)
            if os.path.isfile(dir_index_file):
                self.path = dir_index_path
                return super().do_GET()

            # If URL starts with /paths/, serve /paths/index.html
            if url_path.startswith('/paths/'):
                self.path = '/paths/index.html'
            elif url_path.startswith('/labs/'):
                self.path = '/labs/index.html'
            elif url_path.startswith('/pathrunner/'):
                self.path = '/pathrunner/index.html'
            else:
                # Otherwise serve root index.html
                self.path = '/index.html'
            return super().do_GET()

        # Default: serve normally
        return super().do_GET()

    def send_head(self):
        """Serve a file, honoring HTTP Range requests.

        Python's stock SimpleHTTPRequestHandler ignores the `Range` header and
        always replies `200 OK` with the full body. Browsers require a
        `206 Partial Content` response to seek within a <video>/<audio>
        element, so without this, scrubbing the progress bar on the demo WebM
        videos silently does nothing on the dev server. GitHub Pages (prod)
        already supports Range; this makes local behavior match.

        For requests without a Range header we defer entirely to the base
        class.
        """
        range_header = self.headers.get('Range')
        if not range_header:
            return super().send_head()

        path = self.translate_path(self.path)
        # Directories and missing files: let the base class handle its own
        # redirect/index/404 logic (no partial-content semantics apply).
        if os.path.isdir(path) or not os.path.isfile(path):
            return super().send_head()

        # Only byte ranges are supported; anything else falls back to a full
        # 200 response, which is a valid answer to any Range request.
        match = re.match(r'^bytes=(\d*)-(\d*)$', range_header.strip())
        if not match:
            return super().send_head()

        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(404, "File not found")
            return None

        try:
            file_size = os.fstat(f.fileno()).st_size
            start_group, end_group = match.group(1), match.group(2)

            if start_group == '':
                # Suffix range: last N bytes (e.g. "bytes=-500").
                if end_group == '':
                    f.close()
                    return super().send_head()
                length = min(int(end_group), file_size)
                start = file_size - length
                end = file_size - 1
            else:
                start = int(start_group)
                end = int(end_group) if end_group != '' else file_size - 1
                end = min(end, file_size - 1)

            # Unsatisfiable range (start past EOF or inverted).
            if start >= file_size or start > end:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{file_size}')
                self.end_headers()
                f.close()
                return None

            length = end - start + 1
            f.seek(start)

            self.send_response(206)
            self.send_header('Content-type', self.guess_type(path))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
            self.send_header('Content-Length', str(length))
            self.send_header('Last-Modified', self.date_time_string(os.fstat(f.fileno()).st_mtime))
            self.end_headers()

            # Hand the caller a file positioned at `start`; cap how much
            # copyfile() will read so it stops at the end of the range.
            self._range_remaining = length
            return f
        except Exception:
            f.close()
            raise

    def copyfile(self, source, outputfile):
        """Copy at most `_range_remaining` bytes for a 206 response.

        The base class copies the whole file; for a partial response we must
        stop at the end of the requested range. A one-shot flag keeps normal
        (non-range) responses on the default full-copy path.
        """
        remaining = getattr(self, '_range_remaining', None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        self._range_remaining = None  # reset for subsequent requests on this handler

        chunk_size = 64 * 1024
        while remaining > 0:
            chunk = source.read(min(chunk_size, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

    def end_headers(self):
        """Add headers to prevent caching during development."""
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Expires', '0')
        return super().end_headers()


def main():
    """Start the development server."""
    parser = argparse.ArgumentParser(description="SPA development server")
    parser.add_argument("port", nargs="?", type=int, default=DEFAULT_PORT,
                        help=f"Port to listen on (default: {DEFAULT_PORT})")
    parser.add_argument("--port", dest="port_flag", type=int, default=None,
                        help=f"Port to listen on (default: {DEFAULT_PORT})")
    args = parser.parse_args()
    port = args.port_flag if args.port_flag is not None else args.port

    # Change to the website directory (where index.html is)
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    # Allow address reuse to prevent "Address already in use" errors
    socketserver.TCPServer.allow_reuse_address = True

    with socketserver.TCPServer(("", port), SPAHTTPRequestHandler) as httpd:
        print(f"🚀 Development server running at http://localhost:{port}")
        print(f"📂 Serving files from: {os.getcwd()}")
        print(f"⚡ SPA routing enabled - all paths will serve index.html")
        print(f"\nPress Ctrl+C to stop the server\n")

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n✋ Server stopped")


if __name__ == "__main__":
    main()
