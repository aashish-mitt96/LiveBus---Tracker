from src import db
from src.database.models import Trip

def get_all_trips():
    return Trip.query.all()

def get_trip_by_id(trip_id):
    return Trip.query.get(trip_id)

def start_trip(data):
    new_trip = Trip(**data)
    db.session.add(new_trip)
    db.session.commit()
    return new_trip