"""URL parser for Trip.com flight search URLs."""

from typing import Dict, Any, Optional
from urllib.parse import urlparse, parse_qs


class FlightSearchURLParser:
    """Parses Trip.com flight search URLs to extract search parameters."""
    
    @staticmethod
    def parse_url(url_string: str) -> Dict[str, Any]:
        """
        Parse Trip.com flight search URL.
        
        Args:
            url_string: Full Trip.com search URL
            
        Returns:
            Dictionary containing hostname, region, and search parameters
        """
        url = urlparse(url_string)
        hostname = url.hostname or 'id.trip.com'
        
        # Extract region from hostname (e.g., 'id' from 'id.trip.com')
        host_parts = hostname.split('.')
        region = host_parts[0] if host_parts else 'id'
        
        # Parse query parameters
        query_params = parse_qs(url.query)
        
        # Helper to get first value from query params list
        def get_param(key: str, default: Any = None) -> Any:
            values = query_params.get(key, [])
            return values[0] if values else default
        
        params = {
            'dcity': get_param('dcity', ''),
            'acity': get_param('acity', ''),
            'ddate': get_param('ddate', ''),
            'rdate': get_param('rdate'),
            'triptype': get_param('triptype', 'rt').upper(),  # RT, OW, MT
            'class': get_param('class', 'y').lower(),  # y, c, f
            'quantity': int(get_param('quantity', '1')),
            'childqty': int(get_param('childqty', '0')),
            'babyqty': int(get_param('babyqty', '0')),
            'locale': get_param('locale', f'en-{region.upper()}'),
            'curr': get_param('curr', 'IDR' if region == 'id' else 'USD'),
            'lowpricesource': get_param('lowpricesource', 'searchForm'),
            'dairport': get_param('dairport'),
            'aairport': get_param('aairport'),
            'pagesource': get_param('pagesource', 'list'),
        }
        
        return {
            'url': url_string,
            'hostname': hostname,
            'region': region,
            'params': params,
        }
    
    @staticmethod
    def build_journey_info(params: Dict[str, Any]) -> list:
        """
        Build journeyInfoTypes array from URL parameters.
        
        Args:
            params: Parsed URL parameters
            
        Returns:
            List of journey information dictionaries
        """
        journey_infos = []
        
        # Outbound journey
        journey_infos.append({
            'journeyNo': 1,
            'departDate': params['ddate'],
            'departCode': params['dcity'].upper() if not params.get('dairport') else '',
            'arriveCode': params['acity'].upper() if not params.get('aairport') else '',
            'departAirport': params.get('dairport', '').upper(),
            'arriveAirport': params.get('aairport', '').upper(),
        })
        
        # Return journey (if round trip)
        if params.get('rdate') and params['triptype'] == 'RT':
            journey_infos.append({
                'journeyNo': 2,
                'departDate': params['rdate'],
                'departCode': params['acity'].upper() if not params.get('aairport') else '',
                'arriveCode': params['dcity'].upper() if not params.get('dairport') else '',
                'departAirport': params.get('aairport', '').upper(),
                'arriveAirport': params.get('dairport', '').upper(),
            })
        
        return journey_infos
    
    @staticmethod
    def get_trip_type_code(triptype: str) -> int:
        """Convert trip type string to code."""
        triptype_map = {
            'OW': 1,  # One Way
            'RT': 2,  # Round Trip
            'MT': 3,  # Multi-city
        }
        return triptype_map.get(triptype.upper(), 2)
    
    @staticmethod
    def get_cabin_class_code(cabin_class: str) -> int:
        """Convert cabin class string to code."""
        class_map = {
            'y': 1,  # Economy
            'c': 4,  # Business
            'f': 8,  # First
        }
        return class_map.get(cabin_class.lower(), 1)
