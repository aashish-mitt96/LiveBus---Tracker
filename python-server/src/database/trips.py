from src import db
from sqlalchemy.dialects.postgresql import JSON
from datetime import datetime


class Bus(db.Model):
    __tablename__ = "trip"

    tripId      = db.Column(db.String, primary_key=True)
    bus_number  = db.Column(db.String, nullable=False)
    source      = db.Column(db.String, nullable=False)
    destination = db.Column(db.String, nullable=False)
    route       = db.Column(JSON, nullable=False, default=list)  # stores [{"lat": ..., "lng": ...}, ...]
    current     = db.Column(db.Boolean, default=False, nullable=False)
    status      = db.Column(db.String, default="active", nullable=False)
    ended_at    = db.Column(db.DateTime, nullable=True)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at  = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)