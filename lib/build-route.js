(function () {
  var TOKEN = "pk.eyJ1Ijoic2VhbmxlZTkyIiwiYSI6ImNtZTAyeG0wbzAwamgybHE2cmwzenJtM2cifQ.DE8FeoDvc3EzuyR5uPopzA";
  var SUPABASE = "https://bkgdrfyjppjxwnwntcbc.supabase.co";
  var ANON = "sb_publishable_fMbQ-x2q2q5XA_pT4Bpf6w_ZMcbCQen";
  var MAX_MIDDLES = 150;
  var FREE_MIDDLES = 4;
  var MAX_COORDS = 25;
  var MAX_CHAIN_LEG = 280000;
  var CHAIN_THRESHOLD = 321868;
  var MAX_SEGMENT = 20000;
  var JUNCTION_DEDUPE = 50;
  var CHUNK_MANEUVER_DEDUPE = 35;
  var EARTH = 6371000;
  var STREETS = "mapbox://styles/mapbox/streets-v12";
  var SATELLITE = "mapbox://styles/mapbox/satellite-streets-v12";

  var DIR = {
    leftTurn: "Left turn",
    rightTurn: "Right turn",
    keepLeft: "Keep left",
    keepRight: "Keep right",
    sharpLeftTurn: "Sharp left turn",
    sharpRightTurn: "Sharp right turn",
    uTurn: "U-turn",
    merge: "Merge",
    mergeLeft: "Merge left",
    mergeRight: "Merge right",
    takeRamp: "Take ramp",
    takeExit: "Take exit",
    roundabout: "At roundabout",
    stayOn: "Stay on",
    followRoute: "Follow route",
    arrive: "Arrive"
  };

  function uuid() {
    var id = (crypto.randomUUID && crypto.randomUUID()) ||
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
    return id.toUpperCase();
  }

  function toRad(d) { return d * Math.PI / 180; }

  function haversine(a, b) {
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function pathMeters(pts) {
    var total = 0;
    for (var i = 0; i < pts.length - 1; i++) total += haversine(pts[i], pts[i + 1]);
    return total;
  }

  function geodesicFraction(from, to, t) {
    if (t <= 0) return from;
    if (t >= 1) return to;
    var lat1 = toRad(from.lat);
    var lng1 = toRad(from.lng);
    var lat2 = toRad(to.lat);
    var lng2 = toRad(to.lng);
    var d = 2 * Math.asin(Math.sqrt(
      Math.pow(Math.sin((lat2 - lat1) / 2), 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin((lng2 - lng1) / 2), 2)
    ));
    if (d < 1e-9) return from;
    var a = Math.sin((1 - t) * d) / Math.sin(d);
    var b = Math.sin(t * d) / Math.sin(d);
    var x = a * Math.cos(lat1) * Math.cos(lng1) + b * Math.cos(lat2) * Math.cos(lng2);
    var y = a * Math.cos(lat1) * Math.sin(lng1) + b * Math.cos(lat2) * Math.sin(lng2);
    var z = a * Math.sin(lat1) + b * Math.sin(lat2);
    return {
      lng: Math.atan2(y, x) * 180 / Math.PI,
      lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI
    };
  }

  function validCoord(p) {
    return p && isFinite(p.lat) && isFinite(p.lng) &&
      p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
  }

  function sanitize(coords) {
    var out = [];
    for (var i = 0; i < coords.length; i++) {
      var p = coords[i];
      if (!validCoord(p)) continue;
      if (out.length) {
        if (haversine(out[out.length - 1], p) > MAX_SEGMENT) continue;
      }
      out.push(p);
    }
    return out;
  }

  function encodeSigned(num) {
    var sgn = num < 0 ? (~(num << 1)) >>> 0 : (num << 1) >>> 0;
    var result = "";
    while (sgn >= 0x20) {
      result += String.fromCharCode((0x20 | (sgn & 0x1f)) + 63);
      sgn >>>= 5;
    }
    result += String.fromCharCode(sgn + 63);
    return result;
  }

  function encodePolyline6(coords) {
    var lastLat = 0;
    var lastLng = 0;
    var out = "";
    for (var i = 0; i < coords.length; i++) {
      var lat = Math.round(coords[i].lat * 1e6) | 0;
      var lng = Math.round(coords[i].lng * 1e6) | 0;
      out += encodeSigned((lat - lastLat) | 0);
      out += encodeSigned((lng - lastLng) | 0);
      lastLat = lat;
      lastLng = lng;
    }
    return out;
  }

  function decodePolyline6(encoded) {
    var coords = [];
    var index = 0;
    var lat = 0;
    var lng = 0;
    function next() {
      var result = 0;
      var shift = 0;
      var b;
      do {
        if (index >= encoded.length) return null;
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      return (result & 1) ? ~(result >> 1) : (result >> 1);
    }
    while (index < encoded.length) {
      var dLat = next();
      var dLng = next();
      if (dLat == null || dLng == null) return [];
      lat += dLat;
      lng += dLng;
      coords.push({ lat: lat / 1e6, lng: lng / 1e6 });
    }
    return sanitize(coords);
  }

  function isoDate(d) {
    return d.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  function cleanedText(raw) {
    if (raw == null) return null;
    var t = String(raw).trim();
    return t ? t : null;
  }

  function cleanedHighwayExit(raw) {
    var text = cleanedText(raw);
    if (!text) return null;
    text = text.replace(/^exit\s+/i, "").trim();
    var first = text.split(/[;,]/)[0].trim();
    if (!first) return null;
    if (!/^\d+[A-Za-z]?(?:\s*[-/]\s*\d+[A-Za-z]?)?$/.test(first)) {
      return first.length <= 12 ? first : null;
    }
    return first.replace(/\s+/g, "");
  }

  function exitNumberFromInstruction(instruction) {
    if (!instruction) return null;
    var m = String(instruction).match(/\bexit\s+(\d+[A-Za-z]?(?:\s*[-/]\s*\d+[A-Za-z]?)?)/i);
    return m ? cleanedHighwayExit(m[1]) : null;
  }

  function highwayExitNumber(step) {
    var exits = step.exits;
    var first = Array.isArray(exits) ? exits[0] : exits;
    var fromField = cleanedHighwayExit(first);
    if (fromField) return fromField;
    var banners = step.banner_instructions || [];
    for (var i = 0; i < banners.length; i++) {
      var comps = banners[i].primary && banners[i].primary.components;
      if (comps) {
        for (var j = 0; j < comps.length; j++) {
          if (comps[j].type === "exit-number") {
            var n = cleanedHighwayExit(comps[j].text);
            if (n) return n;
          }
        }
      }
      var fromText = exitNumberFromInstruction(banners[i].primary && banners[i].primary.text);
      if (fromText) return fromText;
    }
    return exitNumberFromInstruction(step.maneuver && step.maneuver.instruction);
  }

  function isHighwayExitType(t) {
    return t === "off ramp" || t === "fork" || t === "turn" || t === "end of road" || t === "notification";
  }

  function continueOrNewNamePhrase(m) {
    if (!m || m === "straight") return null;
    if (m === "slight left" || m === "left") return DIR.keepLeft;
    if (m === "slight right" || m === "right") return DIR.keepRight;
    if (m === "sharp left") return DIR.sharpLeftTurn;
    if (m === "sharp right") return DIR.sharpRightTurn;
    if (m === "uturn") return DIR.uTurn;
    return null;
  }

  function modifierBasedTurn(m) {
    if (!m) return null;
    if (m === "straight") return null;
    if (m === "slight left") return DIR.keepLeft;
    if (m === "left") return DIR.leftTurn;
    if (m === "slight right") return DIR.keepRight;
    if (m === "right") return DIR.rightTurn;
    if (m === "sharp left") return DIR.sharpLeftTurn;
    if (m === "sharp right") return DIR.sharpRightTurn;
    if (m === "uturn") return DIR.uTurn;
    return null;
  }

  function forkPhrase(m) {
    if (!m) return null;
    if (m === "straight") return DIR.stayOn;
    if (m === "left" || m === "slight left") return DIR.keepLeft;
    if (m === "right" || m === "slight right") return DIR.keepRight;
    if (m === "sharp left") return DIR.sharpLeftTurn;
    if (m === "sharp right") return DIR.sharpRightTurn;
    if (m === "uturn") return DIR.uTurn;
    return null;
  }

  function offRampPhrase(m) {
    if (!m || m === "straight") return DIR.takeExit;
    if (m === "left" || m === "slight left" || m === "sharp left") return "Take the exit on the left";
    if (m === "right" || m === "slight right" || m === "sharp right") return "Take the exit on the right";
    if (m === "uturn") return DIR.uTurn;
    return DIR.takeExit;
  }

  function rampPhrase(prefix, m) {
    if (!m || m === "straight") return prefix;
    if (m === "left" || m === "slight left" || m === "sharp left") return prefix + " left";
    if (m === "right" || m === "slight right" || m === "sharp right") return prefix + " right";
    if (m === "uturn") return DIR.uTurn;
    return prefix;
  }

  function mergePhrase(m) {
    if (!m) return DIR.merge;
    if (m === "straight") return DIR.merge;
    if (m === "left" || m === "slight left" || m === "sharp left") return DIR.mergeLeft;
    if (m === "right" || m === "slight right" || m === "sharp right") return DIR.mergeRight;
    return DIR.merge;
  }

  function directionFromMapbox(type, modifier, exit, highwayExit) {
    var t = (type || "").toLowerCase();
    var m = modifier ? modifier.toLowerCase() : null;
    if (highwayExit && isHighwayExitType(t)) return "Take exit " + highwayExit;
    if (t === "depart" || t === "notification") return null;
    if (t === "continue" || t === "new name") return continueOrNewNamePhrase(m);
    if (t === "arrive") return DIR.arrive;
    if (t === "roundabout" || t === "rotary") {
      if (exit > 0) return "Roundabout exit " + exit;
      return modifierBasedTurn(m) || DIR.roundabout;
    }
    if (t === "off ramp") return offRampPhrase(m);
    if (t === "on ramp") return rampPhrase(DIR.takeRamp, m);
    if (t === "merge") return mergePhrase(m);
    if (t === "fork") {
      if (m === "uturn") return DIR.uTurn;
      return forkPhrase(m);
    }
    if (t === "turn" || t === "end of road") {
      if (m === "uturn") return DIR.uTurn;
      return modifierBasedTurn(m);
    }
    return null;
  }

  function isExitInstruction(direction) {
    var lower = (direction || "").toLowerCase();
    return lower === DIR.takeExit.toLowerCase() ||
      lower.indexOf("take exit") === 0 ||
      lower.indexOf("take the exit") === 0;
  }

  function looksLikeNamedRoad(raw) {
    var n = raw.toLowerCase();
    return /\b(road|rd|street|st|avenue|ave|blvd|boulevard|drive|dr|pike|lane|ln|way|hwy|highway|parkway|pkwy|circle|court|ct|trail|place|pl|route)\b/.test(n);
  }

  function isGenericConnectorName(name) {
    var n = name.toLowerCase();
    return n === "ramp" || n === "exit" || n.indexOf("exit ") === 0 || n.indexOf("unnamed") !== -1;
  }

  function roadKey(name) {
    var text = cleanedText(name);
    if (!text) return null;
    text = text.toUpperCase().replace(/\./g, "").replace(/-/g, " ").replace(/\s+/g, " ");
    text = text.replace("INTERSTATE ", "I ").replace("U S ", "US ");
    [" EAST", " WEST", " NORTH", " SOUTH"].forEach(function (s) {
      if (text.slice(-s.length) === s) text = text.slice(0, -s.length);
    });
    text = text.trim();
    return text || null;
  }

  function isSameRoad(a, b) {
    if (!b) return false;
    var ka = roadKey(a);
    var kb = roadKey(b);
    return !!(ka && kb && ka === kb);
  }

  function displayRoadName(name, ref) {
    if (looksLikeNamedRoad(name)) return name;
    var r = cleanedText(ref);
    if (r && !isSameRoad(name, r) && looksLikeNamedRoad(r)) return r;
    return name;
  }

  function preferredDestinationLabel(raw) {
    var parts = raw.split("/").map(function (p) { return p.trim(); }).filter(Boolean);
    if (parts.length <= 1) return raw.trim();
    for (var i = 0; i < parts.length; i++) {
      if (looksLikeNamedRoad(parts[i])) return parts[i];
    }
    return parts[0];
  }

  function ontoRoadFromInstruction(instruction) {
    if (!instruction) return null;
    var m = String(instruction).match(/\bonto\s+(.+)$/i);
    return m ? cleanedText(m[1]) : null;
  }

  function destJoined(dest) {
    if (dest == null) return null;
    if (Array.isArray(dest)) {
      var parts = dest.map(function (x) { return String(x).trim(); }).filter(Boolean);
      return parts.length ? parts.join(";") : null;
    }
    return cleanedText(dest);
  }

  function firstRoadLikeDestination(destinations) {
    var parts = destinations.split(/[;,]/).map(function (p) { return p.trim(); }).filter(Boolean);
    for (var i = 0; i < parts.length; i++) {
      if (looksLikeNamedRoad(parts[i])) return parts[i];
    }
    return null;
  }

  function destinationRoadName(current, following) {
    var leaving = roadKey(current.name) || roadKey(current.ref);
    var onto = ontoRoadFromInstruction(current.maneuver && current.maneuver.instruction);
    if (onto && !isSameRoad(onto, leaving)) return preferredDestinationLabel(onto);
    for (var i = 0; i < Math.min(4, following.length); i++) {
      var next = following[i];
      var type = ((next.maneuver && next.maneuver.type) || "").toLowerCase();
      if (type === "arrive") break;
      if (type === "on ramp") continue;
      var name = cleanedText(next.name);
      if (name && !isGenericConnectorName(name) && !isSameRoad(name, leaving)) {
        return preferredDestinationLabel(displayRoadName(name, next.ref));
      }
      var ref = cleanedText(next.ref);
      if (ref && !isSameRoad(ref, leaving)) return preferredDestinationLabel(ref);
    }
    var destinations = destJoined(current.destinations);
    if (destinations) {
      var useful = firstRoadLikeDestination(destinations);
      if (useful && !isSameRoad(useful, leaving)) return preferredDestinationLabel(useful);
    }
    return null;
  }

  function streetNameForManeuver(step, direction, following) {
    if (isExitInstruction(direction)) return destinationRoadName(step, following);
    return cleanedText(step.name);
  }

  function parseManeuvers(legs) {
    if (!legs) return [];
    var flat = [];
    for (var li = 0; li < legs.length; li++) {
      var steps = legs[li].steps || [];
      for (var si = 0; si < steps.length; si++) {
        flat.push({
          step: steps[si],
          isLast: li === legs.length - 1 && si === steps.length - 1
        });
      }
    }
    var result = [];
    var id = 0;
    for (var i = 0; i < flat.length; i++) {
      var item = flat[i];
      var step = item.step;
      var man = step.maneuver || {};
      if ((man.type || "").toLowerCase() === "arrive" && !item.isLast) continue;
      var highwayExit = highwayExitNumber(step);
      var direction = directionFromMapbox(man.type, man.modifier, man.exit, highwayExit);
      if (!direction) continue;
      var loc = man.location || [];
      if (loc.length < 2) continue;
      var following = [];
      for (var k = i + 1; k < flat.length; k++) following.push(flat[k].step);
      var streetName = streetNameForManeuver(step, direction, following);
      if (direction === DIR.stayOn && (!streetName || !streetName.length)) continue;
      result.push({
        id: id,
        lat: loc[1],
        lng: loc[0],
        directionRaw: direction,
        streetName: streetName || null
      });
      id += 1;
    }
    return result;
  }

  function speedMps(ms) {
    if (!ms || ms.none === true || ms.unknown === true) return null;
    if (ms.speed == null) return null;
    if (ms.unit === "km/h") return ms.speed / 3.6;
    return ms.speed * 0.44704;
  }

  function buildSpeedLimits(coordinateCount, legs) {
    if (coordinateCount < 2) return [];
    var speedLimits = [];
    for (var i = 0; i < (legs || []).length; i++) {
      var leg = legs[i];
      var legSegments = Math.max(1, (leg.steps && leg.steps.length) || 1);
      var startCount = speedLimits.length;
      var maxspeeds = leg.annotation && leg.annotation.maxspeed;
      if (maxspeeds) {
        for (var j = 0; j < maxspeeds.length; j++) speedLimits.push(speedMps(maxspeeds[j]));
        var added = speedLimits.length - startCount;
        while (added < legSegments) {
          speedLimits.push(null);
          added += 1;
        }
      } else {
        for (var k = 0; k < legSegments; k++) speedLimits.push(null);
      }
    }
    var target = coordinateCount - 1;
    while (speedLimits.length < target) speedLimits.push(null);
    if (speedLimits.length > target) speedLimits = speedLimits.slice(0, target);
    return speedLimits;
  }

  function coordsFromGeometry(geometry) {
    if (!geometry) return [];
    if (geometry.type === "LineString" && geometry.coordinates) {
      return geometry.coordinates.map(function (c) { return { lng: c[0], lat: c[1] }; });
    }
    return [];
  }

  function expandLongGaps(waypoints) {
    if (waypoints.length < 2) return waypoints.slice();
    var out = [waypoints[0]];
    for (var i = 0; i < waypoints.length - 1; i++) {
      var from = waypoints[i];
      var to = waypoints[i + 1];
      var leg = haversine(from, to);
      if (leg > MAX_CHAIN_LEG) {
        var steps = Math.max(2, Math.ceil(leg / MAX_CHAIN_LEG));
        for (var s = 1; s < steps; s++) out.push(geodesicFraction(from, to, s / steps));
      }
      out.push(to);
    }
    return out;
  }

  function packChainChunks(points) {
    if (points.length < 2) return [points];
    var cap = Math.max(2, MAX_COORDS);
    var chunks = [];
    var start = 0;
    while (start < points.length - 1) {
      var end = start + 1;
      while (end < points.length - 1) {
        var next = end + 1;
        if (next - start + 1 > cap) break;
        if (pathMeters(points.slice(start, next + 1)) > MAX_CHAIN_LEG) break;
        end = next;
      }
      chunks.push(points.slice(start, end + 1));
      start = end;
    }
    return chunks;
  }

  function chunkWaypoints(waypoints) {
    var chunks = [];
    var start = 0;
    while (start < waypoints.length) {
      var end = Math.min(start + MAX_COORDS - 1, waypoints.length - 1);
      chunks.push(waypoints.slice(start, end + 1));
      if (end >= waypoints.length - 1) break;
      start = end;
    }
    return chunks;
  }

  function requestChunks(waypoints) {
    if (pathMeters(waypoints) >= CHAIN_THRESHOLD) return packChainChunks(expandLongGaps(waypoints));
    if (waypoints.length <= MAX_COORDS) return [waypoints];
    return chunkWaypoints(waypoints);
  }

  function mergeCoordinates(a, b) {
    if (!a.length) return b.slice();
    if (!b.length) return a.slice();
    var lastA = a[a.length - 1];
    var firstB = b[0];
    var meters = haversine(lastA, firstB);
    if (meters < JUNCTION_DEDUPE) return a.concat(b.slice(1));
    if (meters > MAX_SEGMENT) return null;
    return a.concat(b);
  }

  function mergeSpeedLimits(a, b, mergedCount) {
    var merged = a.slice();
    if (b.length) {
      if (!merged.length) merged = b.slice();
      else if (b.length > 1) merged = merged.concat(b);
      else if (merged.length) merged[merged.length - 1] = b[0] != null ? b[0] : merged[merged.length - 1];
    }
    var target = Math.max(0, mergedCount - 1);
    while (merged.length < target) merged.push(null);
    if (merged.length > target) merged = merged.slice(0, target);
    return merged;
  }

  function shouldSkipChunkJunction(maneuver, junction, existing) {
    if (!junction) return false;
    if (haversine(maneuver, junction) >= CHUNK_MANEUVER_DEDUPE) return false;
    var d = maneuver.directionRaw.toLowerCase();
    if (d.indexOf("continue") !== -1 || d === DIR.followRoute.toLowerCase()) return true;
    var last = existing[existing.length - 1];
    if (last && haversine(maneuver, last) < CHUNK_MANEUVER_DEDUPE && maneuver.directionRaw === last.directionRaw) {
      return true;
    }
    return false;
  }

  function mergeManeuvers(a, b, junction) {
    var result = a.filter(function (m) { return m.directionRaw !== DIR.arrive; });
    var nextId = result.length ? result[result.length - 1].id + 1 : 0;
    for (var i = 0; i < b.length; i++) {
      var m = b[i];
      if (shouldSkipChunkJunction(m, junction, result)) continue;
      result.push({
        id: nextId,
        lat: m.lat,
        lng: m.lng,
        directionRaw: m.directionRaw,
        streetName: m.streetName
      });
      nextId += 1;
    }
    return result;
  }

  function mergeResults(a, b) {
    var coords = mergeCoordinates(a.coordinates, b.coordinates);
    if (!coords) return null;
    var limits = mergeSpeedLimits(a.speedLimits, b.speedLimits, coords.length);
    var maneuvers = mergeManeuvers(a.maneuvers, b.maneuvers, b.coordinates[0]);
    var summedDistance = a.distance + b.distance;
    var summedDuration = a.duration + b.duration;
    var geometric = pathMeters(coords);
    var distance = geometric > 0 ? geometric : summedDistance;
    var duration = summedDistance > 0 && geometric > 0
      ? summedDuration * (geometric / summedDistance)
      : summedDuration;
    return {
      coordinates: coords,
      distance: distance,
      duration: duration,
      speedLimits: limits,
      maneuvers: maneuvers
    };
  }

  function fetchSegment(waypoints) {
    var path = waypoints.map(function (p) { return p.lng + "," + p.lat; }).join(";");
    var url = "https://api.mapbox.com/directions/v5/mapbox/driving/" + path +
      "?access_token=" + encodeURIComponent(TOKEN) +
      "&geometries=geojson&overview=full&steps=true&banner_instructions=true&annotations=maxspeed";
    return fetch(url).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || (data.code && String(data.code).toLowerCase() !== "ok")) {
          throw new Error(data.message || data.code || "Could not build that line.");
        }
        var route = (data.routes || [])[0];
        if (!route) throw new Error("No route");
        var coordinates = sanitize(coordsFromGeometry(route.geometry));
        if (coordinates.length < 2) throw new Error("No route");
        var speedLimits = buildSpeedLimits(coordinates.length, route.legs || []);
        var maneuvers = parseManeuvers(route.legs);
        var summedDistance = route.distance;
        var summedDuration = route.duration;
        var geometric = pathMeters(coordinates);
        var distance = geometric > 0 ? geometric : summedDistance;
        var duration = summedDistance > 0 && geometric > 0
          ? summedDuration * (geometric / summedDistance)
          : summedDuration;
        return {
          coordinates: coordinates,
          distance: distance,
          duration: duration,
          speedLimits: speedLimits,
          maneuvers: maneuvers
        };
      });
    });
  }

  function buildRoute(waypoints) {
    if (waypoints.length < 2) return Promise.reject(new Error("Need a start and an end"));
    var chunks = requestChunks(waypoints);
    var merged = null;
    var i = 0;
    function next() {
      if (i >= chunks.length) return merged;
      return fetchSegment(chunks[i]).then(function (segment) {
        if (!merged) merged = segment;
        else {
          merged = mergeResults(merged, segment);
          if (!merged || merged.coordinates.length < 2) throw new Error("Could not join the route pieces.");
        }
        i += 1;
        return next();
      });
    }
    return next();
  }

  function formatMiles(meters) {
    if (!isFinite(meters) || meters <= 0) return "0.0 mi";
    var miles = meters / 1609.34;
    if (miles >= 0.2) return miles.toFixed(1) + " mi";
    var feet = Math.max(50, Math.round((meters * 3.28084) / 50) * 50);
    return feet + " ft";
  }

  function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "—";
    var totalMinutes = Math.floor(seconds / 60);
    if (totalMinutes < 60) return totalMinutes + " min";
    var hours = Math.floor(totalMinutes / 60);
    var mins = totalMinutes % 60;
    if (mins === 0) return hours + " hr";
    return hours + " hr " + mins + " min";
  }

  function pinPayload(pin, order) {
    return {
      id: pin.id,
      latitude: pin.lat,
      longitude: pin.lng,
      order: order
    };
  }

  function exportRoute(state) {
    var name = (state.name || "Driver route").trim() || "Driver route";
    var middles = state.middles.map(function (p, i) { return pinPayload(p, i + 1); });
    var maneuvers = (state.route.maneuvers || []).map(function (m) {
      var row = {
        id: m.id,
        latitude: m.lat,
        longitude: m.lng,
        directionRaw: m.directionRaw
      };
      if (m.streetName) row.streetName = m.streetName;
      return row;
    });
    var obj = {
      dateSaved: isoDate(new Date()),
      encodedRouteGeometry: encodePolyline6(state.route.coordinates),
      endPin: pinPayload(state.end, middles.length + 1),
      formatVersion: 1,
      id: uuid(),
      isOfficialPermitRoute: false,
      name: name,
      savedDistanceMeters: state.route.distance,
      savedDurationSeconds: state.route.duration,
      savedManeuvers: maneuvers,
      startPin: pinPayload(state.start, 0),
      waypoints: middles
    };
    if (state.route.speedLimits && state.route.speedLimits.length) {
      obj.savedSpeedLimits = state.route.speedLimits;
    }
    return obj;
  }

  function fileName(name) {
    return (name || "Driver_route")
      .replace(/[/\:?<>\\|*"]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/^_+|_+$/g, "") || "Driver_route";
  }

  window.PermitPathRoute = {
    encodePolyline6: encodePolyline6,
    decodePolyline6: decodePolyline6,
    buildRoute: buildRoute,
    parseManeuvers: parseManeuvers,
    exportRoute: exportRoute
  };

  if (window.__PP_ROUTE_TEST__) return;

  var gate = document.getElementById("ppGate");
  var gateMsg = document.getElementById("ppGateMsg");
  var app = document.getElementById("ppApp");
  if (!app) return;

  function sayGate(text) {
    if (gateMsg) gateMsg.textContent = text;
  }

  function getToken() {
    try {
      return localStorage.getItem("ppFleetToken") || sessionStorage.getItem("ppFleetToken") || "";
    } catch (err) {
      return sessionStorage.getItem("ppFleetToken") || "";
    }
  }
  function clearToken() {
    sessionStorage.removeItem("ppFleetToken");
    try {
      localStorage.removeItem("ppFleetToken");
      localStorage.removeItem("ppFleetStay");
    } catch (err) {}
  }
  var token = getToken();
  if (!token) {
    window.location.replace("fleet-solutions.html#fleet-login");
    return;
  }

  function loadMapbox() {
    if (window.mapboxgl) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var done = false;
      var s = document.createElement("script");
      s.src = "https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js";
      s.onload = function () {
        if (done) return;
        done = true;
        if (window.mapboxgl) resolve();
        else reject(new Error("Could not load the map."));
      };
      s.onerror = function () {
        if (done) return;
        done = true;
        reject(new Error("Could not load the map."));
      };
      document.head.appendChild(s);
      setTimeout(function () {
        if (done) return;
        done = true;
        if (window.mapboxgl) resolve();
        else reject(new Error("The map is taking too long."));
      }, 20000);
    });
  }

  function checkSession() {
    var control = new AbortController();
    var timer = setTimeout(function () { control.abort(); }, 12000);
    return fetch(SUPABASE + "/rest/v1/rpc/fleet_portal_account", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON,
        Authorization: "Bearer " + ANON
      },
      body: JSON.stringify({ p_token: token }),
      signal: control.signal
    }).then(function (res) {
      clearTimeout(timer);
      return res.json().then(function (data) {
        if (!res.ok || !data || !data.ok) throw new Error("Sign in again.");
        return data;
      });
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  sayGate("Loading the map…");
  loadMapbox().then(function () {
    try {
      startApp();
    } catch (err) {
      sayGate((err && err.message) || "Could not open the map.");
      return;
    }
    checkSession().then(function (account) {
      if (account && account.company) {
        var nameBox = document.getElementById("ppName");
        if (nameBox && nameBox.value === "Driver route") {
          nameBox.value = account.company + " route";
        }
      }
    }).catch(function (err) {
      var timedOut = err && err.name === "AbortError";
      if (!timedOut) {
        clearToken();
        window.location.replace("fleet-solutions.html#fleet-login");
      }
    });
  }).catch(function (err) {
    sayGate((err && err.message) || "Could not load the map.");
  });

  function startApp(account) {
    gate.hidden = true;
    app.hidden = false;
    mapboxgl.accessToken = TOKEN;

    var start = null;
    var middles = [];
    var end = null;
    var route = null;
    var buildGen = 0;
    var satellite = false;
    var markers = [];
    var menu = document.getElementById("ppMenu");
    var stats = document.getElementById("ppStats");
    var note = document.getElementById("ppNote");
    var sendBtn = document.getElementById("ppSend");
    var downloadBtn = document.getElementById("ppDownload");
    var searchList = document.getElementById("ppSearchList");
    var pending = null;
    var preview = null;

    var map = new mapboxgl.Map({
      container: "ppMap",
      style: STREETS,
      center: [-97.5, 35.5],
      zoom: 5,
      attributionControl: true
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

    var pendingLine = null;

    function drawLine(coords) {
      var source = map.getSource("pp-line");
      if (!source) return false;
      source.setData({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: (coords || []).map(function (p) { return [p.lng, p.lat]; })
        }
      });
      return true;
    }

    map.on("load", function () {
      map.resize();
      if (!map.getSource("pp-line")) {
        map.addSource("pp-line", { type: "geojson", data: emptyLine() });
        map.addLayer({
          id: "pp-line",
          type: "line",
          source: "pp-line",
          paint: {
            "line-color": "#0066cc",
            "line-width": 4,
            "line-join": "round",
            "line-cap": "round"
          }
        });
      }
      if (pendingLine) drawLine(pendingLine);
    });

    function emptyLine() {
      return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } };
    }

    function allPins() {
      var list = [];
      if (start) list.push(start);
      middles.forEach(function (p) { list.push(p); });
      if (end) list.push(end);
      return list;
    }

    function setLine(coords) {
      pendingLine = coords || [];
      drawLine(pendingLine);
    }

    function renderPins() {
      markers.forEach(function (m) { m.remove(); });
      markers = [];
      function add(pin, cls, label) {
        var el = document.createElement("div");
        el.className = "pp-pin " + cls;
        el.textContent = label;
        el.addEventListener("click", function (ev) {
          ev.stopPropagation();
          openRemoveMenu(pin, el);
        });
        var mk = new mapboxgl.Marker({ element: el, anchor: "center" })
          .setLngLat([pin.lng, pin.lat])
          .addTo(map);
        markers.push(mk);
      }
      if (preview) add(preview, "pp-pin-preview", "");
      if (start) add(start, "pp-pin-s", "S");
      middles.forEach(function (p, i) { add(p, "pp-pin-m", String(i + 1)); });
      if (end) add(end, "pp-pin-e", "E");
    }

    function hideMenu() {
      menu.hidden = true;
      menu.innerHTML = "";
      pending = null;
      preview = null;
      renderPins();
    }

    function placeMenu(point) {
      var wrap = document.querySelector(".pp-map-wrap");
      var w = wrap.clientWidth;
      var h = wrap.clientHeight;
      menu.hidden = false;
      var mw = menu.offsetWidth || 280;
      var mh = menu.offsetHeight || 56;
      var x = Math.max(8, Math.min(w - mw - 8, point.x - mw / 2));
      var y = Math.max(8, Math.min(h - mh - 8, point.y - mh - 16));
      menu.style.left = x + "px";
      menu.style.top = y + "px";
    }

    function selectableNumbers() {
      if (middles.length >= MAX_MIDDLES) return [];
      var upper = Math.min(middles.length + 1, MAX_MIDDLES);
      var nums = [];
      for (var n = 1; n <= upper; n++) nums.push(n);
      return nums;
    }

    function suggestedNumber(coord) {
      var pins = allPins();
      var append = middles.length + 1;
      if (pins.length < 2) return append;
      var best = null;
      var bestD = Infinity;
      for (var i = 0; i < pins.length - 1; i++) {
        var d = distToSegment(coord, pins[i], pins[i + 1]);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best == null || bestD > 300) return append;
      var insertBefore = pins[best + 1];
      if (insertBefore === end) return append;
      var idx = middles.indexOf(insertBefore);
      if (idx < 0) return append;
      return idx + 1;
    }

    function distToSegment(p, a, b) {
      var toM = function (c) {
        return { x: (c.lng - p.lng) * 111320 * Math.cos(toRad(p.lat)), y: (c.lat - p.lat) * 110540 };
      };
      var A = toM(a);
      var B = toM(b);
      var dx = B.x - A.x;
      var dy = B.y - A.y;
      if (dx === 0 && dy === 0) return Math.sqrt(A.x * A.x + A.y * A.y);
      var t = Math.max(0, Math.min(1, (-A.x * dx + -A.y * dy) / (dx * dx + dy * dy)));
      var x = A.x + t * dx;
      var y = A.y + t * dy;
      return Math.sqrt(x * x + y * y);
    }

    function openAddMenu(lngLat, point) {
      pending = { lng: lngLat.lng, lat: lngLat.lat, id: uuid() };
      preview = pending;
      renderPins();
      var nums = selectableNumbers();
      var suggested = suggestedNumber(pending);
      menu.innerHTML =
        '<button type="button" class="pp-x" data-act="x">✕</button>' +
        '<button type="button" class="pp-pin-start" data-act="start">Start</button>' +
        '<button type="button" class="pp-pin-way" data-act="way">Waypoint</button>' +
        '<button type="button" class="pp-pin-end" data-act="end">End</button>' +
        (nums.length ? '<div class="pp-numbers" hidden>' + nums.map(function (n) {
          return '<button type="button" data-num="' + n + '"' +
            (n === suggested ? ' class="is-suggested"' : "") + ">" + n + "</button>";
        }).join("") + "</div>" : "");
      placeMenu(point);
      menu.querySelector("[data-act=x]").onclick = hideMenu;
      menu.querySelector("[data-act=start]").onclick = function () {
        start = pending;
        hideMenu();
        maybeBuild();
      };
      menu.querySelector("[data-act=end]").onclick = function () {
        end = pending;
        hideMenu();
        maybeBuild();
      };
      menu.querySelector("[data-act=way]").onclick = function () {
        var box = menu.querySelector(".pp-numbers");
        if (!box) {
          placeMiddle(suggested);
          return;
        }
        if (nums.length === 1) {
          placeMiddle(nums[0]);
          return;
        }
        box.hidden = !box.hidden;
        placeMenu(point);
      };
      menu.querySelectorAll("[data-num]").forEach(function (btn) {
        btn.onclick = function () { placeMiddle(Number(btn.getAttribute("data-num"))); };
      });
    }

    function placeMiddle(displayNumber) {
      if (!pending) return;
      if (middles.length >= MAX_MIDDLES) return;
      var append = middles.length + 1;
      var number = Math.min(Math.max(displayNumber, 1), append);
      if (number === append) middles.push(pending);
      else middles.splice(number - 1, 0, pending);
      hideMenu();
      maybeBuild();
    }

    function openRemoveMenu(pin, el) {
      pending = null;
      preview = null;
      menu.innerHTML =
        '<button type="button" class="pp-x" data-act="x">✕</button>' +
        '<button type="button" class="pp-pin-remove" data-act="remove">Remove</button>';
      var wrap = document.querySelector(".pp-map-wrap");
      var rect = wrap.getBoundingClientRect();
      var pinRect = el.getBoundingClientRect();
      placeMenu({
        x: pinRect.left - rect.left + pinRect.width / 2,
        y: pinRect.top - rect.top
      });
      menu.querySelector("[data-act=x]").onclick = hideMenu;
      menu.querySelector("[data-act=remove]").onclick = function () {
        if (start && start.id === pin.id) start = null;
        else if (end && end.id === pin.id) end = null;
        else middles = middles.filter(function (p) { return p.id !== pin.id; });
        hideMenu();
        maybeBuild();
      };
    }

    function maybeBuild() {
      renderPins();
      if (!start || !end) {
        route = null;
        setLine([]);
        sendBtn.disabled = true;
        downloadBtn.disabled = true;
        stats.textContent = "Add a start and an end";
        note.textContent = "The file stores the exact line. The driver opens that file in Permit Path, and the phone follows it. It does not build a new path.";
        note.className = "";
        return;
      }
      var pins = allPins();
      var gen = ++buildGen;
      stats.textContent = "Building the line…";
      sendBtn.disabled = true;
      downloadBtn.disabled = true;
      buildRoute(pins).then(function (result) {
        if (gen !== buildGen) return;
        route = result;
        setLine(result.coordinates);
        var miles = formatMiles(result.distance);
        var time = formatDuration(result.duration);
        stats.textContent = miles + " · " + time + " · " + pins.length + " pins";
        var warn = middles.length > FREE_MIDDLES;
        note.textContent = warn
          ? "A free phone can open up to 4 stops between start and end. A subscribed phone or a company code can open this route. Send the file, not a text link."
          : "Send the file. The driver opens it in Permit Path. The phone follows this line and does not rebuild it.";
        note.className = warn ? "pp-warn" : "";
        sendBtn.disabled = false;
        downloadBtn.disabled = false;
        var b = new mapboxgl.LngLatBounds();
        result.coordinates.forEach(function (p) { b.extend([p.lng, p.lat]); });
        map.fitBounds(b, { padding: 72, maxZoom: 12, duration: 600 });
      }).catch(function (err) {
        if (gen !== buildGen) return;
        route = null;
        setLine([]);
        stats.textContent = err.message || "Could not build that line.";
        note.textContent = "Check the pins and try again.";
        note.className = "pp-warn";
      });
    }

    function currentFile() {
      var name = document.getElementById("ppName").value;
      var json = exportRoute({
        name: name,
        start: start,
        middles: middles,
        end: end,
        route: route
      });
      var text = JSON.stringify(json, null, 2);
      var fname = fileName(name) + ".json";
      return { json: json, text: text, fname: fname, name: json.name };
    }

    function downloadFile() {
      if (!route || !start || !end) return;
      var file = currentFile();
      var blob = new Blob([file.text], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.fname;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    function sendFile() {
      if (!route || !start || !end) return;
      var file = currentFile();
      var blob = new Blob([file.text], { type: "application/json" });
      var shareFile = new File([blob], file.fname, { type: "application/json" });
      var summary = file.name + "\n\n" +
        formatMiles(route.distance) + " (" + formatDuration(route.duration) + ")\n\npermitpathnav.com\n\n" +
        "Open this file in Permit Path. The phone follows this line.";
      if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
        navigator.share({ files: [shareFile], title: file.name, text: summary }).catch(function () {
          downloadFile();
        });
        return;
      }
      downloadFile();
      note.textContent = "The route file is on your computer. Email or AirDrop that file to the driver. Open it in Permit Path.";
    }

    map.on("click", function (e) {
      if (e.originalEvent.target.closest(".pp-pin") || e.originalEvent.target.closest(".pp-pin-menu")) return;
      openAddMenu(e.lngLat, e.point);
    });

    document.getElementById("ppClear").onclick = function () {
      start = null;
      middles = [];
      end = null;
      route = null;
      hideMenu();
      maybeBuild();
    };

    var howBtn = document.getElementById("ppHow");
    var howPanel = document.getElementById("ppHowPanel");
    if (howBtn && howPanel) {
      howBtn.onclick = function () {
        var open = howPanel.hidden;
        howPanel.hidden = !open;
        howBtn.setAttribute("aria-expanded", open ? "true" : "false");
      };
    }
    document.getElementById("ppSatellite").onclick = function () {
      satellite = !satellite;
      this.classList.toggle("is-on", satellite);
      this.textContent = satellite ? "Streets" : "Satellite";
      map.setStyle(satellite ? SATELLITE : STREETS);
      map.once("style.load", function () {
        map.addSource("pp-line", {
          type: "geojson",
          data: route ? {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: route.coordinates.map(function (p) { return [p.lng, p.lat]; })
            }
          } : emptyLine()
        });
        map.addLayer({
          id: "pp-line",
          type: "line",
          source: "pp-line",
          paint: {
            "line-color": "#0066cc",
            "line-width": 4,
            "line-join": "round",
            "line-cap": "round"
          }
        });
        renderPins();
      });
    };

    var searchTimer = null;
    document.getElementById("ppSearch").addEventListener("input", function () {
      var q = this.value.trim();
      clearTimeout(searchTimer);
      if (q.length < 3) {
        searchList.hidden = true;
        return;
      }
      searchTimer = setTimeout(function () {
        var center = map.getCenter();
        var url = "https://api.mapbox.com/geocoding/v5/mapbox.places/" + encodeURIComponent(q) +
          ".json?access_token=" + encodeURIComponent(TOKEN) +
          "&country=us&limit=5&proximity=" + center.lng + "," + center.lat;
        fetch(url).then(function (r) { return r.json(); }).then(function (data) {
          var feats = data.features || [];
          if (!feats.length) {
            searchList.hidden = true;
            return;
          }
          searchList.innerHTML = feats.map(function (f, i) {
            var label = String(f.place_name || f.text || "").replace(/[&<>"']/g, function (c) {
              return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
            });
            return "<li><button type=\"button\" data-i=\"" + i + "\">" + label + "</button></li>";
          }).join("");
          searchList.hidden = false;
          searchList.querySelectorAll("button").forEach(function (btn) {
            btn.onclick = function () {
              var f = feats[Number(btn.getAttribute("data-i"))];
              var c = f.center;
              map.flyTo({ center: c, zoom: 14 });
              searchList.hidden = true;
              openAddMenu({ lng: c[0], lat: c[1] }, { x: map.getContainer().clientWidth / 2, y: map.getContainer().clientHeight / 2 });
            };
          });
        }).catch(function () {
          searchList.hidden = true;
        });
      }, 220);
    });

    sendBtn.onclick = sendFile;
    downloadBtn.onclick = downloadFile;
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") hideMenu();
    });

    requestAnimationFrame(function () { map.resize(); });
  }
})();
