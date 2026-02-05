# Trip.com Flight Scraper

A Python-based web scraper for Trip.com flight search API with advanced bot detection bypass capabilities.

## Installation

### Prerequisites

- Python 3.9+
- Google Chrome browser installed at: `C:\Program Files\Google\Chrome\Application\chrome.exe`

### Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd Trip-Flights-Scraper

# Install dependencies
pip install -r requirements.txt
```

## Usage

### Start the Server

```bash
python main.py
```

Server will run at `http://localhost:11000`

### API Endpoints

#### 1. Token Generation: `POST /sign`

Generate authentication tokens for Trip.com API requests.

**Request Body:**
```json
{
  "head": {
    "ClientID": "your-client-id",
    "extension": [
      {"name": "LowPriceSource", "value": "searchForm"},
      {"name": "vid", "value": "your-visitor-id"}
    ]
  },
  "searchCriteria": {
    "tripType": 2,
    "realGrade": 1,
    "journeyInfoTypes": [
      {
        "departCode": "JKT",
        "arriveCode": "NYC",
        "departDate": "2026-02-20",
        "departCityName": "Jakarta",
        "arriveCityName": "New York"
      },
      {
        "departCode": "NYC",
        "arriveCode": "JKT",
        "departDate": "2026-02-27"
      }
    ],
    "passengerInfoType": {
      "adultCount": 1,
      "childCount": 0,
      "infantCount": 0
    }
  }
}
```

**Response:**
```json
{
  "status": "success",
  "signature": "generated-signature-token"
}
```

#### 2. Flight Scraping: `POST /scrape`

ON PROGRESS

#### 3. Browser Interception: `POST /scrape-browser`

**The most reliable method** - Opens Trip.com URL in a real browser and intercepts FlightListSearchSSE network responses directly.

**Request Body:**
```json
{
  "url": "https://id.trip.com/flights/showfarefirst?dcity=jkt&acity=sin&ddate=2026-02-01&rdate=2026-02-03&triptype=rt&class=y&locale=en-ID&curr=IDR&quantity=1"
}
```

**Response:**
```json
{
  "status": "success",
  "url": "https://id.trip.com/restapi/soa2/27015/FlightListSearchSSE",
  "statusCode": 200,
  "events": [
    {
      "head": {"retCode": "SUCCESS"},
      "basicInfo": {
        "recordCount": 64,
        "currency": "IDR",
        "lowestPrice": {"totalPrice": 3763420}
      },
      "flightList": [...]
    }
  ],
  "eventCount": 2,
  "fullBodyLength": 754436,
  "timestamp": 1738741200000
}
```

**Features:**
- Opens Trip.com URL in real Chrome browser
- Intercepts `FlightListSearchSSE` network responses via JavaScript injection
- Captures Server-Sent Events (SSE) streaming data
- Bypasses bot detection more effectively than API calls
- No token generation required - uses actual browser session
- Automatic browser cleanup after each request
- Waits 10 seconds to collect all SSE events
- Returns parsed flight data with full response details


**Example:**
```bash
curl -X POST http://localhost:11000/scrape-browser \
  -H "Content-Type: application/json" \
  -d '{"url": "https://id.trip.com/flights/showfarefirst?dcity=jkt&acity=sin&ddate=2026-02-07&rdate=2026-02-09&triptype=rt&class=y&locale=en-ID&curr=IDR"}'
```

## Project Structure

```
Trip-Flights-Scraper/
├── main.py                 # Application entry point
├── requirements.txt        # Python dependencies
├── README.md              # This file
│
├── src/
│   ├── __init__.py
│   │
│   ├── api/               # HTTP server and API handlers
│   │   ├── __init__.py
│   │   ├── server.py      # aiohttp server setup
│   │   └── handlers.py    # Request handlers (/sign, /scrape, /scrape-browser)
│   │
│   ├── core/              # Core business logic
│   │   ├── __init__.py
│   │   ├── browser_manager.py     # Browser automation with zendriver
│   │   └── token_generator.py     # Token generation orchestration
│   │
│   ├── services/          # Service layer
│   │   ├── __init__.py
│   │   ├── url_builder.py                 # URL construction
│   │   ├── w_payload_service.py           # W payload generation
│   │   ├── x_ctx_service.py               # X-CTX header generation
│   │   ├── cookie_extractor.py            # Cookie extraction
│   │   ├── flight_scraper.py              # Flight data scraping
│   │   ├── flight_url_parser.py           # URL parsing
│   │   ├── ubt_manager.py                 # UBT management
│   │   └── browser_response_interceptor.py # Network response interception
│   │
│   ├── models/            # Data models
│   │   ├── __init__.py
│   │   ├── payload_models.py      # Main payload models
│   │   ├── w_payload_models.py    # W payload models
│   │   └── payload_schemes.py     # Validation schemas
│   │
│   ├── utils/             # Utility functions
│   │   ├── __init__.py
│   │   ├── payload_encoder.py     # Payload compression
│   │   ├── initial_cookie.py      # Cookie handling
│   │   └── ubt_vid.py             # Visitor ID generation
│   │
│   └── config/            # Configuration
│       ├── __init__.py
│       └── settings.py    # App settings
│
├── docs/                  # Documentation and examples
│   ├── response_tokengetter.txt
│   ├── response_jkt_nyc_1.txt
│   └── ...
│
└── tests/                 # Unit tests (to be implemented)
    ├── __init__.py
    ├── test_api/
    ├── test_services/
    └── test_models/
```

## Configuration

Edit [src/config/settings.py](src/config/settings.py) to customize:

- Server host and port
- Chrome browser path
- Browser arguments
- Target URLs
- Timeouts

## Trip Types

- `1` = One Way (OW)
- `2` = Round Trip (RT)
- `3` = Multi-city (MT)

## Flight Classes

- `1` = Economy (Y)
- `2` = Business (C)
- `3` = First Class (F)

## Development

### Running Tests

```bash
# To be implemented
pytest tests/
```

### Code Style

This project follows PEP 8 guidelines with:
- Clear module organization
- Comprehensive docstrings
- Type hints where applicable

## Architecture Overview

### Token Generation Flow

1. **Request Reception** Ã¢â€ â€™ API handler receives flight search parameters
2. **Browser Initialization** Ã¢â€ â€™ Fresh Chrome session with anti-detection
3. **URL Construction** Ã¢â€ â€™ Build Trip.com search URL from parameters
4. **Page Navigation** Ã¢â€ â€™ Navigate to constructed URL
5. **Token Generation**:
   - Execute `window.signature()` for main token
   - Generate W payload and MD5 hash
   - Execute `window.c_sign.toString()` for W payload source
   - Generate X-CTX header hash
6. **Response** Ã¢â€ â€™ Return all tokens as JSON

### Module Responsibilities

- **API Layer**: HTTP server and request handling
- **Core Layer**: Browser automation and token orchestration
- **Service Layer**: Business logic for URL building and token generation
- **Models**: Data structures and validation
- **Utils**: Helper functions and utilities
- **Config**: Centralized configuration management
