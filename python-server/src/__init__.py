from flask import Flask
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

def create_app():

    app = Flask(__name__)
    app.config.from_object("src.config.Config")
    db.init_app(app)

    from src.routes import trip
    app.register_blueprint(trip.bp)
    CORS(app)
    return app