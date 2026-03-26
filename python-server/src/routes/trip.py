from src.services import trip
from flask import Blueprint, jsonify, request

bp = Blueprint("trip", __name__, url_prefix="/buses")


@bp.route("/getalltrips", methods=["GET"])
def get_buses():
    trip = trip.get_all_trips()
    result = [
        {
            "id": b.id,
            "bus_number": b.bus_number,
            "source": b.source,
            "destination": b.destination,
            "route": b.route,
            "current": b.current
        }
        for b in trip
    ]
    return jsonify(result)


@bp.route("/", methods=["POST"])
def create_new_trip():
    data = request.json
    trip = trip.start_trip(data)
    return jsonify({
        "id": trip.id,
        "bus_number": trip.bus_number,
        "source": trip.source,
        "destination": trip.destination,
        "route": trip.route,
        "current": trip.current
    })