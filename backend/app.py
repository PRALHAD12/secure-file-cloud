"""Flask application factory.  Run with:  python -m backend.app"""
import logging
import sys

from flask import Flask, Response, abort, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from . import activity
from .api import OCTET, OVERHEAD, bp
from .config import MB, Settings
from .storage import StorageError, make_storage

log = logging.getLogger("sfs")


def create_app(settings=None):
    cfg = settings or Settings()
    app = Flask(__name__, static_folder=str(cfg.frontend_dir), static_url_path="")
    app.config["SFS"] = cfg
    app.config["MAX_CONTENT_LENGTH"] = cfg.max_segment_size + MB
    activity.init(cfg.data_dir / "activity.db")
    app.extensions["storage"] = make_storage(cfg)
    app.register_blueprint(bp)

    @app.route("/")
    def home():
        return send_from_directory(cfg.frontend_dir, "index.html")

    # ---- local development storage (only active when STORAGE_BACKEND=local) ----
    @app.route("/local-storage/<path:key>", methods=["GET", "PUT"])
    def local_storage(key):
        s = app.extensions["storage"]
        if s.mode != "local":
            abort(404)
        if not s.verify(request.method, key, request.args.get("exp"), request.args.get("sig")):
            return Response("Invalid or expired URL", 403)
        if request.method == "PUT":
            data = request.get_data()
            if len(data) > cfg.max_segment_size + OVERHEAD:
                return Response("Too large", 413)
            s.put_object(key, data)
            return Response("", 200)
        try:
            return Response(s.get_object(key), mimetype=OCTET)
        except FileNotFoundError:
            return Response("Not found", 404)

    # ---- CORS (browser on CloudFront domain -> API) + basic security headers ----
    @app.after_request
    def headers(resp):
        origin = request.headers.get("Origin")
        if origin and ("*" in cfg.allowed_origins or origin in cfg.allowed_origins):
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
            resp.headers["Vary"] = "Origin"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "no-referrer"
        if request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.errorhandler(Exception)
    def on_error(e):
        if isinstance(e, HTTPException):
            if e.code == 404 and not request.path.startswith(("/api/", "/local-storage/")):
                return send_from_directory(cfg.frontend_dir, "error.html"), 404
            return (jsonify(error=e.description), e.code) if request.path.startswith("/api/") else e
        log.exception("Unhandled error")
        msg = "Storage error" if isinstance(e, StorageError) else f"Cloud storage error ({e.__class__.__name__}). Check AWS credentials, region and bucket name."
        return jsonify(error=msg), 502

    return app


def main():
    logging.basicConfig(level=logging.INFO)
    cfg = Settings()
    try:
        app = create_app(cfg)
    except (StorageError, ImportError) as e:
        sys.exit(f"\nStartup error: {e}\nFix your .env file (see .env.example) and try again.\n")
    import os
    host, port = os.getenv("HOST", "127.0.0.1"), int(os.getenv("PORT", "5000"))
    mode = app.extensions["storage"].mode
    print(f"\n  Secure File Cloud  |  storage: {mode.upper()}  |  http://{host}:{port}\n")
    if mode == "local":
        print("  NOTE: local mode is for development only. Files are NOT going to AWS.\n")
    try:
        from waitress import serve
        serve(app, host=host, port=port, max_request_body_size=cfg.max_segment_size + 2 * MB)
    except ImportError:
        app.run(host=host, port=port)


if __name__ == "__main__":
    main()
