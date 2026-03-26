from src import db
from datetime import datetime
from sqlalchemy.dialects.postgresql import JSON

class Trip (db.Model):
    __tablename__ = "Trip"
    
    id = db.Column(db.Integer, primary_key=True)
    bus_number = db.Column(db.String, unique=True, nullable=False)
    source = db.Column(db.String, nullable=False)
    destination = db.Column(db.String, nullable=False)
    route = db.Column(JSON, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)