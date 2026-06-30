from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS

db = SQLAlchemy()

def create_app():
    app = Flask(__name__)
    app.config.from_object("src.config.Config")
    
    db.init_app(app)
    
    from src.routes import stops
    app.register_blueprint(stops.stops_bp)

    CORS(app)
    
    return app