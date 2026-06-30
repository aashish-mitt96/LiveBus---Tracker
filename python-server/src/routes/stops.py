# routes/stops.py (or wherever stops_bp is defined)
from flask import Blueprint, request, jsonify
from src.crud.stops import buffer_stop, flush_stops_to_node
import os

stops_bp = Blueprint("stops", __name__)


@stops_bp.route("/api/trips/<trip_id>/pin-stop", methods=["POST"])
def pin_stop_route(trip_id: str):
    data = request.get_json()
    lat = data.get("lat")
    lng = data.get("lng")

    print(f"[pin_stop] received: tripId={trip_id}, lat={lat}, lng={lng}")

    if lat is None or lng is None:
        return jsonify({"error": "lat and lng are required"}), 400

    # Resolve name + buffer in Redis — no DB write yet
    stop_name = buffer_stop(trip_id, lat, lng)

    return jsonify({
        "buffered": True,
        "lat": lat,
        "lng": lng,
        "stop_name": stop_name,
        "message": "Stop buffered. Will be written to DB when trip ends."
    }), 200


@stops_bp.route("/internal/process-stops/<trip_id>", methods=["POST"])
def process_stops(trip_id: str):
    """Called by Node after endTrip — flushes buffered stops to DB via Node's updateRoute."""
    print(f"[process_stops] triggered for trip {trip_id}")
    success = flush_stops_to_node(trip_id)
    if success:
        return jsonify({"success": True, "message": "Stops flushed to DB."}), 200
    else:
        return jsonify({"success": False, "message": "Some stops failed to flush."}), 500