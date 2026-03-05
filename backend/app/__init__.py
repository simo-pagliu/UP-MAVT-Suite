from flask import Flask
from flask_cors import CORS
from pymongo import MongoClient
import os

def create_app():
    app = Flask(__name__)

    cors_origins_raw = os.getenv("CORS_ORIGIN", "*")
    # Support comma-separated origins for multi-origin deployments (e.g. "https://a.com,https://b.com").
    cors_origin = [o.strip() for o in cors_origins_raw.split(",")] if "," in cors_origins_raw else cors_origins_raw
    CORS(app, origins=cors_origin)

    # Limit incoming request bodies to 10 MB to prevent denial-of-service via huge payloads.
    app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB

    # MongoDB connection
    mongo_uri = os.getenv("MONGO_URI", "mongodb://mongo:27017/elicitation")
    client = MongoClient(mongo_uri)
    db = client.elicitation
    
    # Store db in app context
    app.db = db
    
    # Register blueprints
    from app.routes import api
    app.register_blueprint(api.bp)
    
    return app
