#!/usr/bin/env python3
"""
Simple development server for SPA routing.
All requests are served from index.html to support client-side routing.
"""

import http.server
import socketserver
import os
from urllib.parse import urlparse

PORT = 8888

class SPAHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP request handler with SPA support."""

    def do_GET(self):
        """Handle GET requests with SPA routing."""
        # Parse the URL path
        url_path = urlparse(self.path).path

        # List of file extensions that should be served directly
        file_extensions = ['.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg',
                          '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot']

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

        # For all other requests (like /paths/iam-001), serve root index.html for SPA routing
        if not is_file:
            # Rewrite the path to index.html
            self.path = '/index.html'
            return super().do_GET()

        # Default: serve normally
        return super().do_GET()

    def end_headers(self):
        """Add headers to prevent caching during development."""
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Expires', '0')
        return super().end_headers()


def main():
    """Start the development server."""
    # Change to the website directory (where index.html is)
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    with socketserver.TCPServer(("", PORT), SPAHTTPRequestHandler) as httpd:
        print(f"🚀 Development server running at http://localhost:{PORT}")
        print(f"📂 Serving files from: {os.getcwd()}")
        print(f"⚡ SPA routing enabled - all paths will serve index.html")
        print(f"\nPress Ctrl+C to stop the server\n")

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n✋ Server stopped")


if __name__ == "__main__":
    main()
