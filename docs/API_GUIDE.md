# Wrocław Public Transit API — Developer Guide & Reference

A high-performance, universal edge REST API providing real-time and scheduled public transit intelligence for the city of Wrocław, Poland (MPK Wrocław).

Powered by **Cloudflare Workers** and **Cloudflare D1 SQL Database**, this API serves as a unified backend for diverse client environments — from web applications and mobile apps to smart home integrations (Home Assistant) and embedded IoT microcontrollers (ESP32 / e-paper displays).

---

## 1. Overview & Architecture

- **Base URL:** `https://wroclaw-transit.wowk-digital.workers.dev`
- **Architecture:** Serverless Edge Worker running on V8 isolates at Cloudflare edge locations worldwide.
- **Database:** Cloudflare D1 SQL Database (`wroclaw-transit`) replicated to Eastern Europe (`EEUR / WAW`), hosting all **2,491 stops** in Wrocław and GTFS static timetables.
- **Real-time Engine:** Dynamic upstream proxy to MPK Wrocław fleet telemetry (`/bus_position`) with 10-second edge caching to eliminate redundant upstream calls.
- **Timezone:** Standardized on `Europe/Warsaw` with native daylight saving time (CET / CEST) adjustments.
- **Zero-Configuration Direction Engine:** Directional filtering is 100% dynamic; the API resolves terminus stops, street names, and coordinate vectors on the fly without hardcoded city models.

---

## 2. Authentication & CORS

- **Authentication:** None required. Public REST API.
- **CORS:** Enabled by default (`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, OPTIONS`). Suitable for direct browser and frontend single-page apps (React, Vue, Svelte, iOS/Android webviews).
- **Format:** Strict JSON (`Content-Type: application/json; charset=utf-8`).

---

## 3. Core Concepts

### A. Operating Modes
When querying departures, clients specify the data source behavior via `?mode=`:

| Mode | Source | Latency | Description |
|---|---|---|---|
| `schedule` *(default)* | Cloudflare D1 SQL | **< 15 ms** | Returns official scheduled timetable departures for the current day type (weekdays, saturdays, sundays). Ideal when offline, during off-peak hours, or for deterministic schedule queries. |
| `live` | MPK GPS Telemetry | **150–400 ms** | Fetches live vehicle locations within a 4.5 km radius of the stop. Computes real-time line-of-sight distance (`dist_m`) and estimated arrival time (`min`). |
| `hybrid` | GPS + D1 Timetable | **150–400 ms** | **Recommended for general apps.** First fetches active live vehicles. If fewer vehicles than the requested `limit` are found in transit, the worker automatically fills the remaining departure slots with scheduled timetable data. |

### B. Platform Clustering
Many transit hubs share physical platform locations between trams and buses (e.g. Tatra/TAT dedicated corridors). In the official GTFS spec, these have distinct stop codes (e.g. tram `12020` and bus `112020` at Budziszyńska). 

The API automatically clusters sibling platforms sharing the same physical location (`< 150m`), aggregating all lines passing through that physical hub in a single query.

### C. Dynamic Direction Filtering (Zero Hardcoding)
Vehicles in MPK's real-time feed report only their line number and raw GPS coordinates (`lat`, `lon`), omitting headsigns. To differentiate between vehicles travelling toward your destination versus away from it, you can provide an optional direction anchor:

1. **By Terminus / Stop Name:** `?dir=Kowale`, `?dir=Leśnica`, `?dir=Dominikańska`, `?dir=Rynek`. The worker queries the D1 database to find the destination's coordinates.
2. **By Stop Code:** `?dir=10123` or `?dir_stop=18201`.
3. **By Coordinates:** `?dir_lat=51.1097&dir_lon=17.0326` (vector target).
4. **Omitted:** If `dir` is omitted, the API returns **all** active vehicles within range for the requested lines, including each vehicle's `lat` and `lon`, allowing the client to execute its own custom spatial logic.

---

## 4. API Endpoints Reference

### 1. Departures Endpoint

#### `GET /departures` or `GET /`

Retrieves upcoming transit departures for a designated stop platform.

#### Query Parameters:

| Parameter | Type | Required | Default | Description | Example |
|---|---|:---:|:---:|---|---|
| `stop` *(or `code`)* | `string` / `integer` | **Yes** | — | Stop identifier code | `12020` |
| `lines` *(or `line`)* | `string` | Optional | *(all)* | Comma-separated line filter | `13,23` or `249` |
| `mode` | `string` | Optional | `schedule` | Query mode: `schedule`, `live`, or `hybrid` | `hybrid` |
| `dir` | `string` | Optional | `null` | Terminus name or stop code to filter travel direction | `Leśnica`, `Kowale` |
| `dir_lat` | `float` | Optional | `null` | Target latitude for vector calculation | `51.1097` |
| `dir_lon` | `float` | Optional | `null` | Target longitude for vector calculation | `17.0326` |
| `limit` | `integer` | Optional | `5` | Maximum number of results to return (1 to 20) | `10` |

#### Request Example:
```http
GET https://wroclaw-transit.wowk-digital.workers.dev/departures?stop=12020&lines=249&mode=live&dir=lesnica&limit=3 HTTP/1.1
Host: wroclaw-transit.wowk-digital.workers.dev
```

#### Response Example (`200 OK`):
```json
{
  "stop": "Budziszyńska",
  "stop_code": "12020",
  "platforms": [
    "112020",
    "12020",
    "112019",
    "12019"
  ],
  "lat": 51.112496,
  "lon": 16.949841,
  "mode": "live",
  "direction_target": {
    "name": "LEŚNICA",
    "lat": 51.14465236,
    "lon": 16.87170532
  },
  "departures": [
    {
      "line": "249",
      "dir": "LEŚNICA",
      "dist_m": 761,
      "lat": 51.1123,
      "lon": 16.960741,
      "min": "2",
      "type": "live"
    }
  ]
}
```

#### Response Fields:

- **`stop`** (`string`): Official stop name.
- **`stop_code`** (`string`): Primary queried stop code.
- **`platforms`** (`string[]`): All platform codes grouped into this physical stop.
- **`lat`**, **`lon`** (`number`): Physical stop GPS coordinates.
- **`mode`** (`string`): Operating mode used (`schedule`, `live`, or `hybrid`).
- **`direction_target`** (`object | null`): Resolved coordinates of the direction anchor.
- **`departures`** (`array`): Ordered list of upcoming departures.
  - **`line`** (`string`): Route designation (e.g. `"13"`, `"249"`).
  - **`dir`** (`string`): Destination headsign or target name.
  - **`min`** (`string`): Minutes until departure (or `"<1"` if imminent).
  - **`type`** (`"live" | "schedule"`): Source indicator for this departure item.
  - **`time`** (`string`, optional): Scheduled departure time (`HH:MM`, present when `type === "schedule"`).
  - **`dist_m`** (`number`, optional): Distance in meters between vehicle and stop (present when `type === "live"`).
  - **`lat`**, **`lon`** (`number`, optional): Current vehicle coordinates (present when `type === "live"`).

---

### 2. Stop Search Endpoint

#### `GET /search`

Searches the entire directory of 2,491 stops in Wrocław by name.

- **Fuzzy & Diacritic Insensitive:** Matches both `lesnica` and `Leśnica`, `swidnicka` and `Świdnicka`.
- **Ranked:** Results are ordered by shortest match first, followed by alphabetical order.

#### Query Parameters:

| Parameter | Type | Required | Description | Example |
|---|---|:---:|---|---|
| `q` | `string` | **Yes** | Search term (minimum 2 characters) | `dominik` |

#### Request Example:
```http
GET https://wroclaw-transit.wowk-digital.workers.dev/search?q=lesnica HTTP/1.1
```

#### Response Example (`200 OK`):
```json
[
  {
    "stop_code": "18201",
    "name": "LEŚNICA",
    "lat": 51.14465236,
    "lon": 16.87170532
  },
  {
    "stop_code": "18386",
    "name": "LEŚNICA",
    "lat": 51.14478929,
    "lon": 16.87181353
  },
  {
    "stop_code": "18342",
    "name": "Leśnica - Hermes",
    "lat": 51.14587115,
    "lon": 16.8663056
  }
]
```

---

### 3. Stop Metadata & Routes Endpoint

#### `GET /stop`

Returns metadata for a specific stop code, including its coordinates and the lines serving this stop.

#### Query Parameters:

| Parameter | Type | Required | Description | Example |
|---|---|:---:|---|---|
| `code` *(or `stop`)* | `string` / `integer` | **Yes** | Stop platform code | `12020` |

#### Request Example:
```http
GET https://wroclaw-transit.wowk-digital.workers.dev/stop?code=12020 HTTP/1.1
```

#### Response Example (`200 OK`):
```json
{
  "stop_code": "12020",
  "name": "Budziszyńska",
  "lat": 51.112496,
  "lon": 16.949841,
  "lines": [
    "13",
    "23"
  ]
}
```

---

## 5. Integration Code Examples

### A. JavaScript / TypeScript (Fetch / Browser / Node.js)

```typescript
interface Departure {
  line: string;
  dir: string;
  min: string;
  type: "live" | "schedule";
  dist_m?: number;
  lat?: number;
  lon?: number;
}

interface TransitResponse {
  stop: string;
  stop_code: string;
  mode: string;
  departures: Departure[];
}

async function fetchDepartures(
  stopCode: string, 
  lines: string[], 
  direction?: string
): Promise<Departure[]> {
  const params = new URLSearchParams({
    stop: stopCode,
    lines: lines.join(","),
    mode: "hybrid",
    limit: "5"
  });

  if (direction) {
    params.set("dir", direction);
  }

  const res = await fetch(`https://wroclaw-transit.wowk-digital.workers.dev/departures?${params}`);
  if (!res.ok) throw new Error(`Transit API Error: ${res.statusText}`);

  const data: TransitResponse = await res.json();
  return data.departures;
}

// Usage:
fetchDepartures("12020", ["13", "23"], "Kowale")
  .then(departures => console.log(departures))
  .catch(console.error);
```

---

### B. Python (Requests / Home Assistant Automation)

```python
import requests

def get_next_transit(stop_code: str, lines: list[str], direction: str = None, mode: str = "hybrid") -> dict:
    url = "https://wroclaw-transit.wowk-digital.workers.dev/departures"
    params = {
        "stop": stop_code,
        "lines": ",".join(lines),
        "mode": mode,
        "limit": 5
    }
    if direction:
        params["dir"] = direction

    response = requests.get(url, params=params, timeout=5.0)
    response.raise_for_status()
    return response.json()

# Example: Check line 249 towards Leśnica
if __name__ == "__main__":
    result = get_next_transit(stop_code="12020", lines=["249"], direction="Leśnica", mode="live")
    print(f"Stop: {result['stop']}")
    for dep in result.get("departures", []):
        print(f"Line {dep['line']} -> {dep['dir']}: in {dep['min']} min ({dep['type']})")
```

---

### C. Embedded C / C++ (ESP32 Arduino / ArduinoJson)

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* endpoint = "https://wroclaw-transit.wowk-digital.workers.dev/departures?stop=12020&lines=13,23&mode=hybrid&limit=2";

void updateTransitDisplay() {
  HTTPClient http;
  http.begin(endpoint);
  int httpCode = http.GET();

  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
    
    StaticJsonDocument<1024> doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (!error) {
      JsonArray departures = doc["departures"];
      for (JsonObject dep : departures) {
        const char* line = dep["line"];
        const char* dir = dep["dir"];
        const char* min = dep["min"];
        
        Serial.printf("[%s] %s -> %s min\n", line, dir, min);
      }
    }
  }
  http.end();
}
```

---

## 6. Error Handling

All error responses return standard HTTP status codes accompanied by a descriptive JSON payload:

```json
{
  "error": "Error description message"
}
```

### Standard Status Codes:

| Status Code | Description | Typical Cause |
|---|---|---|
| `200 OK` | Success | Valid query executed. |
| `400 Bad Request` | Missing/Invalid Parameters | Required parameter `?stop=` omitted, min characters for search not met, or unknown `mode`. |
| `404 Not Found` | Resource Not Found | Queried `stop_code` does not exist in Wrocław directory. |
| `500 Server Error` | Execution Exception | Upstream connectivity issue or internal execution failure. |

---

## 7. Performance & Caching Guidelines

1. **Client Polling Intervals:**
   - **`mode=schedule`:** Cache for **5 to 15 minutes** (timetables rarely change intra-day).
   - **`mode=live` or `mode=hybrid`:** Poll every **15 to 30 seconds**. Polling faster than every 10 seconds is unnecessary as the edge proxy caches MPK upstream responses for 10 seconds.
2. **Bandwidth Efficiency:**
   - Use the `?limit=` parameter to request only the exact number of entries needed by your UI (e.g. `?limit=2` for small microcontrollers or OLED screens) to reduce JSON parsing memory.
