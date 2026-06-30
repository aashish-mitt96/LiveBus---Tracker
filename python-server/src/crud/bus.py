# src/crud/bus.py
from src.database.trips import Trip
from src import db

def get_all_buses():
    return Trip.query.all()

def get_bus_by_id(bus_id):
    return Trip.query.get(bus_id)

def create_bus(data):
    new_bus = Trip(**data)
    db.session.add(new_bus)
    db.session.commit()
    return new_bus