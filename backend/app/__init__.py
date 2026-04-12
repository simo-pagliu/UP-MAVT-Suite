"""Application factory for the elicitation-tools Flask backend."""

import logging
import os

from flask import Flask
from flask_cors import CORS
from pymongo import MongoClient

logger = logging.getLogger(__name__)


def create_app():
    """Create and configure the Flask application.

    Reads configuration from environment variables, sets up CORS, connects to
    MongoDB, and registers all blueprints.

    Returns:
        Flask: The configured Flask application instance.
    """
    app = Flask(__name__)

    cors_origins_raw = os.getenv("CORS_ORIGIN", "*")
    # Support comma-separated origins for multi-origin deployments (e.g. "https://a.com,https://b.com").
    cors_origin = [o.strip() for o in cors_origins_raw.split(",")] if "," in cors_origins_raw else cors_origins_raw
    # supports_credentials=True is required for HTTPOnly cookie auth.  When the
    # origin is the wildcard "*" flask-cors automatically echoes the requesting
    # Origin back so the browser accepts the credentials flag.
    CORS(app, origins=cors_origin, supports_credentials=True)

    # Limit incoming request bodies to 10 MB to prevent denial-of-service via huge payloads.
    app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB

    # MongoDB connection
    mongo_uri = os.getenv("MONGO_URI", "mongodb://mongo:27017/elicitation")
    client = MongoClient(mongo_uri)
    db = client.elicitation
    
    # Store db in app context
    app.db = db
    
    # Register global error handler
    @app.errorhandler(Exception)
    def handle_general_error(e):
        error_type = type(e).__name__
        error_msg = str(e)
        logger.error("UNHANDLED ERROR: %s: %s", error_type, error_msg, exc_info=True)
        if 'mongo' in error_msg.lower() or 'connection' in error_msg.lower():
            return {'error': f'Database connection error: {error_msg}'}, 503
        return {'error': f'{error_type}: {error_msg}'}, 500
    
    # Register blueprints
    from app.routes import api
    app.register_blueprint(api.bp)
    
    return app
