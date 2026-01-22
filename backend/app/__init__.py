from flask import Flask
from flask_cors import CORS
from pymongo import MongoClient
import os

def create_app():
    app = Flask(__name__)
    CORS(app)
    
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
