"""URL construction service for Trip.com flight searches."""

import colorama
from urllib.parse import urlencode

from src.config import TARGET_URL


def build_flight_url(data: dict) -> str:
    """
    Build Trip.com flight search URL from request data.
    
    Args:
        data: Request payload containing search criteria
        
    Returns:
        Complete URL with query parameters
    """
    try:
        search_criteria = data.get('searchCriteria', {})
        passenger_info = search_criteria.get('passengerInfoType', {})
        journey_infos = search_criteria.get('journeyInfoTypes', [])
        
        # Extract extensions
        head_data = data.get('head', {})
        extensions_list = head_data.get('extension', [])
        extensions = {ext.get('name'): ext.get('value', '') for ext in extensions_list}
        
        # Map trip types
        trip_type_map = {1: 'OW', 2: 'RT', 3: 'MT'}
        trip_type = trip_type_map.get(search_criteria.get('tripType', 2), 'RT')
        
        # Map cabin classes
        class_map = {1: 'Y', 2: 'C', 3: 'F'}
        flight_class = class_map.get(search_criteria.get('realGrade', 1), 'Y')
        
        # Passenger counts
        adult_count = passenger_info.get('adultCount', 1)
        child_count = passenger_info.get('childCount', 0)
        infant_count = passenger_info.get('infantCount', 0)
        
        # Journey information
        dcity, acity, ddate, rdate = "", "", "", ""
        dcity_name, acity_name = "", ""
        dairport, aairport = "", ""
        
        if len(journey_infos) > 0:
            first_journey = journey_infos[0]
            dcity = first_journey.get('departCode', '').lower()
            acity = first_journey.get('arriveCode', '').lower()
            ddate = first_journey.get('departDate', '')
            dairport = first_journey.get('departAirport', '')
            aairport = first_journey.get('arriveAirport', '')
            dcity_name = first_journey.get('departCityName', '')
            acity_name = first_journey.get('arriveCityName', '')
        
        # Return date for round trip
        if len(journey_infos) > 1:
            rdate = journey_infos[1].get('departDate', '')
        
        # Low price source
        low_price_source = extensions.get('LowPriceSource', 'searchForm')
        
        # Build query parameters
        params = {
            'pagesource': 'list',
            'lowpricesource': low_price_source,
            'triptype': trip_type,
            'class': flight_class,
            'quantity': str(adult_count),
            'childqty': str(child_count),
            'babyqty': str(infant_count),
            'dcity': dcity,
            'acity': acity,
            'ddate': ddate,
            'locale': 'en-ID',
            'curr': 'IDR'
        }
        
        # Add optional parameters
        if dairport:
            params['dairport'] = dairport
        if aairport:
            params['aairport'] = aairport
        if dcity_name:
            params['dcityName'] = dcity_name
        if acity_name:
            params['acityName'] = acity_name
        if rdate:
            params['rdate'] = rdate
        
        # Airline filter (empty default)
        params['airline'] = ''
        
        # Build URL
        query_string = '&'.join([f"{k}={v}" for k, v in params.items()])
        full_url = f"{TARGET_URL}/showfarefirst?{query_string}"
        
        return full_url
        
    except Exception as e:
        import traceback
        print(f"{colorama.Fore.RED}[!] Error building URL: {e}{colorama.Fore.WHITE}")
        print(traceback.format_exc())
        raise
